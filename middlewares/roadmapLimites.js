// ============================================
// middlewares/roadmapLimites.js
// Limites de plano do sistema de Roadmap (docs/roadmap-spec.md, seção
// "Planos Free e PRO"): quantos roadmaps ativos e quantas regenerações
// num período. Ao bloquear, nunca renderiza a tela de erro genérica
// (404.ejs/500.ejs) — sempre uma mensagem amigável com a data da próxima
// regeneração (quando aplicável) e um link de upgrade.
//
// Nota sobre a sessão: a spec pede "o plano que já está na sessão", mas
// isso não existe hoje — req.session.user não carrega plano nenhum
// (confirmado em docs/roadmap-diagnostico.md, seção 5; é por isso que
// services/subscriptionService.js existe como única fonte de verdade,
// consultando user_subscriptions a cada chamada). Este middleware usa
// subscriptionService em vez de inventar um campo de sessão que o resto
// do app não popula.
// ============================================
const db = require("../database/db");
const { getUserPlan } = require("../services/subscriptionService");
const { PLANS } = require("../config/plans");

const LIMITE_PADRAO = PLANS.dev_free.roadmap;

function formatarData(data) {
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Responde o bloqueio de forma amigável — nunca com a tela de erro
// genérica. 402 (Payment Required) é o mesmo status já usado em
// routes/ai.js (requireFeature) e empresaController.createJob pra esse
// tipo de bloqueio por plano, mantido aqui por consistência.
function responderBloqueio(req, res, { mensagem, proximaRegeneracaoEm }) {
  const upgradeUrl = "/planos";

  if (req.xhr || req.headers.accept?.includes("application/json") || req.is("application/json")) {
    return res.status(402).json({
      bloqueado: true,
      mensagem,
      proxima_regeneracao_em: proximaRegeneracaoEm ? proximaRegeneracaoEm.toISOString() : null,
      upgrade_url: upgradeUrl,
    });
  }

  return res.status(402).send(
    `<p>${mensagem}</p><p><a href="${upgradeUrl}">Fazer upgrade de plano</a></p>`
  );
}

/** Bloqueia a criação de um novo roadmap quando o limite de ativos do plano já foi atingido. */
async function limiteRoadmapsAtivos(req, res, next) {
  try {
    const plano     = await getUserPlan(req.session.user.id, "dev");
    const maxAtivos = plano?.roadmap?.max_ativos ?? LIMITE_PADRAO.max_ativos;

    const [[{ total }]] = await db.query(
      "SELECT COUNT(*) AS total FROM roadmaps WHERE usuario_id = ? AND status = 'ativo'",
      [req.session.user.id]
    );

    if (total >= maxAtivos) {
      return responderBloqueio(req, res, {
        mensagem: `Você atingiu o limite de ${maxAtivos} roadmap${maxAtivos > 1 ? "s" : ""} ativo${maxAtivos > 1 ? "s" : ""} do seu plano. `
                 + `Arquive um roadmap existente para liberar espaço, ou faça upgrade para ter até 5 roadmaps ativos ao mesmo tempo.`,
      });
    }
    next();
  } catch (err) {
    console.error("[limiteRoadmapsAtivos]", err.message);
    res.status(500).json({ error: "Erro interno. Tente novamente." });
  }
}

/**
 * Bloqueia a regeneração quando o intervalo do plano (30 dias no Free, 7 no
 * PRO) ainda não passou desde a última regeneração bem-sucedida via IA.
 * Espera que um middleware anterior já tenha carregado `req.roadmap`
 * (ownership já verificada — ver controllers/trilhaController.js).
 *
 * Roadmap cuja origem atual é 'modelo' (fallback — a última tentativa de
 * gerar/regenerar caiu no roadmap-modelo estático, não gastou a IA de
 * verdade) nunca conta pro limite: libera a regeneração imediatamente,
 * sem checar data.
 */
async function limiteRegeneracao(req, res, next) {
  try {
    const roadmap = req.roadmap;
    if (roadmap.origem === "modelo") return next();

    const plano         = await getUserPlan(req.session.user.id, "dev");
    const intervaloDias = plano?.roadmap?.regen_intervalo_dias ?? LIMITE_PADRAO.regen_intervalo_dias;

    const proximaRegeneracaoEm = new Date(roadmap.gerado_em);
    proximaRegeneracaoEm.setDate(proximaRegeneracaoEm.getDate() + intervaloDias);

    if (proximaRegeneracaoEm > new Date()) {
      return responderBloqueio(req, res, {
        mensagem: `Você já regenerou este roadmap recentemente. A próxima regeneração estará `
                 + `disponível em ${formatarData(proximaRegeneracaoEm)}.`,
        proximaRegeneracaoEm,
      });
    }
    next();
  } catch (err) {
    console.error("[limiteRegeneracao]", err.message);
    res.status(500).json({ error: "Erro interno. Tente novamente." });
  }
}

module.exports = { limiteRoadmapsAtivos, limiteRegeneracao };
