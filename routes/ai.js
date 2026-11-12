const express = require("express");
const multer  = require("multer");
const router  = express.Router();
const { param, body, query } = require("express-validator");
const { isAuth } = require("../middlewares/auth");
const { handleValidation } = require("../validators/handle-validation");
const { hasFeature } = require("../services/subscriptionService");
const { getMatchExplanation } = require("../services/matchCalculator");
const { listConversas, getHistory, sendMessage } = require("../services/mentorChat");
const { getInsightsFreshOrCached } = require("../services/marketInsights");
const { askGeminiJSON, configuracaoIA, MODEL } = require("../services/geminiClient");
const { extractText, SUPPORTED_MIME_TYPES } = require("../services/fileTextExtractor");
const { statusHttpDaIA, resumoDoErro } = require("../services/iaErros");

// Erros das rotas de IA: 503 quando a IA está indisponível agora (fora do
// ar, sem cota, tempo esgotado, chave ausente/inválida), 502 quando ela
// respondeu algo inutilizável e 500 para falhas internas (banco etc.).

// Anexo do mentor: mantido só em memória (nunca gravado em disco) —
// extraímos o texto e descartamos o buffer, então não precisa de
// diretório de upload nem de limpeza posterior.
const uploadMentorAnexo = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (SUPPORTED_MIME_TYPES[file.mimetype]) cb(null, true);
    else cb(new Error("Formato inválido. Envie PDF, .txt ou .md."));
  },
});

// Gate de plano PRO — mesmo padrão 402 usado em empresaController.createJob
// quando o plano do usuário não permite a funcionalidade.
function requireFeature(featureKey, mensagem) {
  return async (req, res, next) => {
    try {
      const allowed = await hasFeature(req.session.user.id, featureKey);
      if (!allowed) return res.status(402).json({ error: mensagem });
      next();
    } catch (err) {
      console.error("[requireFeature]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  };
}

function getUserId(req) {
  return req.session.user.github_id ?? req.session.user.id;
}

// O mentor de carreira (que também conduz a simulação de entrevista) é
// recurso exclusivo de conta dev — hoje isso só é garantido "por
// acidente" (planos de empresa não têm `features`), então checamos o
// tipo de conta explicitamente, igual as rotas de página equivalentes
// já fazem em server.js.
function requireDevType(req, res, next) {
  if (req.session.user.type !== "dev") {
    return res.status(403).json({ error: "Recurso exclusivo de contas de desenvolvedor." });
  }
  next();
}

const intParam = name => [
  param(name).isInt({ min: 1 }).withMessage(`${name} deve ser inteiro positivo.`).toInt(),
  handleValidation,
];

// GET /api/ai/health — checagem mínima de que a chave/modelo do Gemini
// estão configurados corretamente. Protegida por sessão (não pública)
// pra não virar um jeito barato de terceiros gastarem nossa cota de IA;
// pensada pra ser chamada manualmente após configurar o Render, não em
// loop/monitoramento automático.
router.get("/health", isAuth, async (req, res) => {
  try {
    const result = await askGeminiJSON({
      system: 'Responda SEMPRE em JSON puro no formato exato: { "ok": true }',
      prompt: "ping",
      maxTokens: 256,
    });
    // __provider só existe se a resposta veio do fallback (Groq/Cerebras/
    // Mistral/OpenRouter) — ausente significa que o Gemini respondeu.
    res.json({
      status: "ok",
      model: result.__provider ? `${result.__provider}/${result.__model}` : MODEL,
      fallback: Boolean(result.__provider),
      respondeu: Boolean(result),
      configuracao: configuracaoIA(),
    });
  } catch (err) {
    console.error("[GET /api/ai/health]", resumoDoErro(err));
    res.status(statusHttpDaIA(err)).json({ status: "erro", model: MODEL, motivo: err.message, configuracao: configuracaoIA() });
  }
});

// GET /api/ai/jobs/:id/match-explicacao — compatibilidade semântica
// (percentual + explicação textual) entre o usuário logado e a vaga.
// Cacheado por par candidato-vaga em match_ia_cache.
router.get("/jobs/:id/match-explicacao", isAuth, ...intParam("id"), async (req, res) => {
  const githubId = getUserId(req);
  const jobId    = req.params.id;

  try {
    // Mesmo profileData da página da vaga (nível do dev), para o percentual
    // explicado ser o mesmo que o dev vê — e o cache comparar com ele.
    const explanation = await getMatchExplanation(githubId, jobId, { nivel: req.session.user.nivel });
    res.json(explanation);
  } catch (err) {
    console.error("[GET /api/ai/jobs/:id/match-explicacao]", resumoDoErro(err));
    res.status(statusHttpDaIA(err, 500)).json({ error: "Erro ao gerar explicação com IA. Tente novamente em instantes." });
  }
});

// ── Mentor de carreira (chat) — exclusivo plano PRO ──────────
const MENTOR_GATE_MSG = "O mentor de carreira é exclusivo do plano PRO. Faça upgrade para conversar com o mentor.";

// Conversa que não existe ou é de outro usuário (services/mentorChat.js).
const conversaNaoEncontrada = err => err?.name === "ConversaNaoEncontrada";

// GET /api/ai/mentor/conversas — histórico da barra lateral: as conversas
// do usuário (salvas entre logins), a mais recente primeiro.
router.get("/mentor/conversas", isAuth, requireDevType, requireFeature("mentor_carreira", MENTOR_GATE_MSG), async (req, res) => {
  try {
    res.json(await listConversas(req.session.user.id));
  } catch (err) {
    console.error("[GET /api/ai/mentor/conversas]", resumoDoErro(err));
    res.status(500).json({ error: "Erro ao carregar as conversas. Tente novamente." });
  }
});

// GET /api/ai/mentor/historico?conversa=ID — mensagens de uma conversa
// (sem ?conversa, da mais recente): { conversa: { id, titulo } | null, mensagens }.
router.get(
  "/mentor/historico",
  isAuth,
  requireDevType,
  requireFeature("mentor_carreira", MENTOR_GATE_MSG),
  query("conversa").optional({ values: "falsy" }).isInt({ min: 1 }).withMessage("Conversa inválida."),
  handleValidation,
  async (req, res) => {
    try {
      const conversaId = req.query.conversa ? Number(req.query.conversa) : null;
      res.json(await getHistory(req.session.user.id, conversaId));
    } catch (err) {
      if (conversaNaoEncontrada(err)) return res.status(404).json({ error: err.message });
      console.error("[GET /api/ai/mentor/historico]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  }
);

router.post(
  "/mentor/mensagem",
  isAuth,
  requireDevType,
  requireFeature("mentor_carreira", MENTOR_GATE_MSG),
  (req, res, next) => {
    uploadMentorAnexo.single("anexo")(req, res, err => {
      if (!err) return next();
      const msg = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
        ? "Arquivo muito grande. Envie até 2MB."
        : err.message || "Erro ao processar o arquivo.";
      res.status(400).json({ error: msg });
    });
  },
  body("mensagem").trim().isLength({ min: 1, max: 2000 }).withMessage("Mensagem deve ter entre 1 e 2000 caracteres."),
  // conversa: a conversa aberta na tela; sem ela, a pergunta começa uma nova.
  body("conversa").optional({ values: "falsy" }).isInt({ min: 1 }).withMessage("Conversa inválida."),
  handleValidation,
  async (req, res) => {
    const userId   = req.session.user.id;
    const githubId = req.session.user.github_id ?? userId;
    const nivel    = req.session.user.nivel;
    const conversaId = req.body.conversa ? Number(req.body.conversa) : null;

    try {
      let anexoTexto;
      if (req.file) {
        anexoTexto = await extractText(req.file.buffer, req.file.mimetype);
      }

      const { texto, conversa } = await sendMessage(userId, githubId, nivel, req.body.mensagem, anexoTexto, conversaId);
      res.status(201).json({ resposta: texto, conversa });
    } catch (err) {
      if (conversaNaoEncontrada(err)) return res.status(404).json({ error: err.message });
      console.error("[POST /api/ai/mentor/mensagem]", resumoDoErro(err));
      if (err.message.includes("Formato de arquivo não suportado") || err.message.includes("extrair texto")) {
        return res.status(400).json({ error: err.message });
      }
      res.status(statusHttpDaIA(err, 500)).json({ error: "Erro ao falar com o mentor. Tente novamente em instantes." });
    }
  }
);

// ── Insights de mercado — página pública, sem gate de plano ──
// Sem cron separado: regenera sob demanda quando o cache passa de 24h
// (getInsightsFreshOrCached), então o "atualizado periodicamente" da
// UI é real, sem depender de um processo agendado à parte.
router.get("/insights-mercado", async (req, res) => {
  try {
    const insights = await getInsightsFreshOrCached();
    res.json(insights);
  } catch (err) {
    console.error("[GET /api/ai/insights-mercado]", resumoDoErro(err));
    if (err.message.includes("Nenhuma vaga")) {
      return res.status(404).json({ error: "Ainda não há dados suficientes de vagas pra gerar insights." });
    }
    res.status(statusHttpDaIA(err, 500)).json({ error: "Erro ao gerar insights com IA. Tente novamente em instantes." });
  }
});

module.exports = router;
