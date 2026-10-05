// ============================================
// controllers/trilhaController.js
// Sistema de Roadmap novo (fases/etapas via IA — docs/roadmap-spec.md),
// montado em /trilha pra não colidir com o roadmap antigo (gap de skills
// por vaga, já em produção em /roadmap e routes/roadmap.js — ver
// docs/roadmap-diagnostico.md).
//
// Views são placeholder nesta etapa (texto simples, sem .ejs) — a
// próxima etapa troca por telas de verdade.
// ============================================
const db = require("../database/db");
const { gerarRoadmap, regenerarRoadmap } = require("../services/roadmapService");

const STATUS_ETAPA_VALIDOS = ["pendente", "em_andamento", "concluida"];

/**
 * Carrega o roadmap do :id da rota, já filtrado pelo usuário logado — uma
 * linha não encontrada (não existe OU é de outro usuário) vira 404 sem
 * distinção, pra não revelar a um usuário que o id pertence a outra conta.
 * Middleware: usado em toda rota com :id; deixa o roadmap em req.roadmap.
 */
async function carregarRoadmap(req, res, next) {
  const roadmapId = Number(req.params.id);
  if (!Number.isInteger(roadmapId) || roadmapId <= 0) {
    return res.status(404).type("text/plain").send("Roadmap não encontrado.");
  }

  try {
    const [rows] = await db.query(
      "SELECT * FROM roadmaps WHERE id = ? AND usuario_id = ?",
      [roadmapId, req.session.user.id]
    );
    if (!rows.length) {
      return res.status(404).type("text/plain").send("Roadmap não encontrado.");
    }
    req.roadmap = rows[0];
    next();
  } catch (err) {
    console.error("[carregarRoadmap]", err.message);
    res.status(500).json({ error: "Erro interno. Tente novamente." });
  }
}

/** GET /trilha — lista os roadmaps do usuário logado. */
async function listar(req, res) {
  try {
    const [roadmaps] = await db.query(
      `SELECT id, tipo_objetivo, vaga_id, area, horas_semana, status, versao, origem, gerado_em
       FROM roadmaps WHERE usuario_id = ? ORDER BY gerado_em DESC`,
      [req.session.user.id]
    );

    if (!roadmaps.length) {
      return res.type("text/plain").send(
        "Você ainda não tem nenhum roadmap. Acesse /trilha/novo para criar o primeiro."
      );
    }

    const linhas = roadmaps.map(r =>
      `#${r.id} — ${r.tipo_objetivo === "area" ? `área: ${r.area}` : `vaga #${r.vaga_id}`} `
      + `— ${r.status} — versão ${r.versao} — origem: ${r.origem} — gerado em ${r.gerado_em.toISOString()}`
    );
    res.type("text/plain").send(`Seus roadmaps:\n\n${linhas.join("\n")}`);
  } catch (err) {
    console.error("[GET /trilha]", err.message);
    res.status(500).json({ error: "Erro interno. Tente novamente." });
  }
}

/** GET /trilha/novo — formulário (placeholder). */
async function formularioNovo(req, res) {
  try {
    const [[perfil]] = await db.query(
      "SELECT id FROM perfil_tecnico_ia WHERE user_id = ?",
      [req.session.user.id]
    );

    const avisoPerfil = perfil
      ? "Seu perfil técnico já foi analisado — o gap será calculado a partir dele."
      : "Você ainda não tem perfil técnico analisado. Faça o autodiagnóstico (marque as tecnologias "
      + "que já usa e o nível de cada uma) antes de gerar o roadmap, ou importe/analise seus repositórios.";

    res.type("text/plain").send(
      "Novo roadmap (formulário placeholder)\n\n"
      + `${avisoPerfil}\n\n`
      + "Campos: objetivo (área: front-end | back-end | full-stack | dados, OU vaga: id da vaga), "
      + "horas por semana (5, 10 ou 20+ — padrão 10).\n\n"
      + "Envie um POST /trilha com { tipo, area|vagaId, horasSemana } para gerar."
    );
  } catch (err) {
    console.error("[GET /trilha/novo]", err.message);
    res.status(500).json({ error: "Erro interno. Tente novamente." });
  }
}

/** POST /trilha — gera um roadmap novo. */
async function criar(req, res) {
  const { tipo, area, vagaId, horasSemana } = req.body ?? {};

  if (tipo !== "area" && tipo !== "vaga") {
    return res.status(400).type("text/plain").send("Campo 'tipo' deve ser 'area' ou 'vaga'.");
  }

  const objetivo = tipo === "area"
    ? { tipo: "area", area }
    : { tipo: "vaga", vagaId: Number(vagaId) };
  const horas = Number(horasSemana) || 10;

  try {
    const resultado = await gerarRoadmap(req.session.user.id, objetivo, horas);
    res.redirect(`/trilha/${resultado.roadmapId}`);
  } catch (err) {
    console.error("[POST /trilha]", err.message);
    res.status(400).type("text/plain").send(`Não foi possível gerar o roadmap: ${err.message}`);
  }
}

/** GET /trilha/:id — detalhe (placeholder). Espera req.roadmap (carregarRoadmap). */
async function detalhe(req, res) {
  const roadmap = req.roadmap;
  try {
    const [fases] = await db.query(
      "SELECT * FROM roadmap_fases WHERE roadmap_id = ? ORDER BY ordem",
      [roadmap.id]
    );
    const [etapas] = await db.query(
      `SELECT re.* FROM roadmap_etapas re
       JOIN roadmap_fases rf ON rf.id = re.fase_id
       WHERE rf.roadmap_id = ? ORDER BY rf.ordem, re.ordem`,
      [roadmap.id]
    );

    const etapasPorFase = {};
    for (const e of etapas) (etapasPorFase[e.fase_id] ??= []).push(e);

    const linhas = fases.map(f => {
      const etapasTexto = (etapasPorFase[f.id] ?? [])
        .map(e => `    - [${e.status}] ${e.titulo} (${e.habilidade}, ~${e.horas_estimadas}h)`)
        .join("\n");
      return `Fase ${f.ordem}: ${f.nome}\n  Objetivo: ${f.objetivo}\n  Projeto: ${f.projeto_enunciado ?? "—"} (status: ${f.projeto_status})\n${etapasTexto}`;
    });

    res.type("text/plain").send(
      `Roadmap #${roadmap.id} — ${roadmap.status} — versão ${roadmap.versao} — origem: ${roadmap.origem}\n\n`
      + linhas.join("\n\n")
    );
  } catch (err) {
    console.error("[GET /trilha/:id]", err.message);
    res.status(500).json({ error: "Erro interno. Tente novamente." });
  }
}

/** POST /trilha/:id/etapas/:etapaId — muda o status de uma etapa (responde JSON). */
async function atualizarEtapa(req, res) {
  const roadmap = req.roadmap;
  const etapaId = Number(req.params.etapaId);
  const { status } = req.body ?? {};

  if (!Number.isInteger(etapaId) || etapaId <= 0) {
    return res.status(404).json({ error: "Etapa não encontrada." });
  }
  if (!STATUS_ETAPA_VALIDOS.includes(status)) {
    return res.status(400).json({ error: `Status inválido. Use: ${STATUS_ETAPA_VALIDOS.join(", ")}.` });
  }

  try {
    const concluidaEm = status === "concluida" ? new Date() : null;
    const [result] = await db.query(
      `UPDATE roadmap_etapas re
       JOIN roadmap_fases rf ON rf.id = re.fase_id
       SET re.status = ?, re.concluida_em = ?
       WHERE re.id = ? AND rf.roadmap_id = ?`,
      [status, concluidaEm, etapaId, roadmap.id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: "Etapa não encontrada neste roadmap." });
    }
    res.json({ success: true, status, concluida_em: concluidaEm });
  } catch (err) {
    console.error("[POST /trilha/:id/etapas/:etapaId]", err.message);
    res.status(500).json({ error: "Erro interno. Tente novamente." });
  }
}

/** POST /trilha/:id/regenerar — espera req.roadmap (carregarRoadmap) + limite já checado. */
async function regenerar(req, res) {
  const roadmap = req.roadmap;
  try {
    await regenerarRoadmap(roadmap.id);
    res.redirect(`/trilha/${roadmap.id}`);
  } catch (err) {
    console.error("[POST /trilha/:id/regenerar]", err.message);
    res.status(400).type("text/plain").send(`Não foi possível regenerar o roadmap: ${err.message}`);
  }
}

/** POST /trilha/:id/arquivar — espera req.roadmap (carregarRoadmap). */
async function arquivar(req, res) {
  const roadmap = req.roadmap;
  try {
    await db.query("UPDATE roadmaps SET status = 'arquivado' WHERE id = ?", [roadmap.id]);
    res.redirect("/trilha");
  } catch (err) {
    console.error("[POST /trilha/:id/arquivar]", err.message);
    res.status(500).json({ error: "Erro interno. Tente novamente." });
  }
}

module.exports = {
  carregarRoadmap,
  listar,
  formularioNovo,
  criar,
  detalhe,
  atualizarEtapa,
  regenerar,
  arquivar,
};
