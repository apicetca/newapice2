const express = require("express");
const multer  = require("multer");
const router  = express.Router();
const { param, body } = require("express-validator");
const { isAuth } = require("../middlewares/auth");
const { handleValidation } = require("../validators/handle-validation");
const { hasFeature } = require("../services/subscriptionService");
const { getCachedProfile, analyzeUserProfile } = require("../services/aiProfileAnalyzer");
const { getMatchExplanation } = require("../services/matchCalculator");
const { getHistory, sendMessage } = require("../services/mentorChat");
const { gerarPergunta, avaliarResposta } = require("../services/interviewSimulator");
const { getInsightsFreshOrCached } = require("../services/marketInsights");
const { askGeminiJSON, MODEL } = require("../services/geminiClient");
const { extractText, SUPPORTED_MIME_TYPES } = require("../services/fileTextExtractor");

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

// Mentor de carreira e simulador de entrevista são recursos exclusivos de
// conta dev — hoje isso só é garantido "por acidente" (planos de empresa
// não têm `features`), então checamos o tipo de conta explicitamente,
// igual as rotas de página equivalentes já fazem em server.js.
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
    res.json({ status: "ok", model: MODEL, respondeu: Boolean(result) });
  } catch (err) {
    console.error("[GET /api/ai/health]", err.message);
    res.status(502).json({ status: "erro", model: MODEL, motivo: err.message });
  }
});

// GET /api/ai/perfil-tecnico — análise de repositórios via IA
// (proficiência estimada, boas práticas, pontos de melhoria).
// Usa cache em perfil_tecnico_ia; só chama a IA se ainda não existir,
// a menos que ?reanalisar=1 seja passado (botão "Reanalisar" na tela).
router.get("/perfil-tecnico", isAuth, async (req, res) => {
  const userId = req.session.user.id;
  const forceReanalyze = req.query.reanalisar === "1";

  try {
    if (!forceReanalyze) {
      const cached = await getCachedProfile(userId);
      if (cached) return res.json(cached);
    }

    const accessToken = req.session.user?.accessToken;
    if (!accessToken) {
      return res.status(400).json({ error: "Conta GitHub não vinculada. Faça login com o GitHub para gerar a análise." });
    }

    const profile = await analyzeUserProfile(userId, accessToken);
    res.json(profile);
  } catch (err) {
    console.error("[GET /api/ai/perfil-tecnico]", err.message);
    if (err.message.includes("repositórios importados")) {
      return res.status(400).json({ error: "Importe ao menos um repositório antes de gerar a análise." });
    }
    res.status(502).json({ error: "Erro ao gerar análise com IA. Tente novamente em instantes." });
  }
});

// GET /api/ai/jobs/:id/match-explicacao — compatibilidade semântica
// (percentual + explicação textual) entre o usuário logado e a vaga.
// Cacheado por par candidato-vaga em match_ia_cache.
router.get("/jobs/:id/match-explicacao", isAuth, ...intParam("id"), async (req, res) => {
  const githubId = getUserId(req);
  const jobId    = req.params.id;

  try {
    const explanation = await getMatchExplanation(githubId, jobId);
    res.json(explanation);
  } catch (err) {
    console.error("[GET /api/ai/jobs/:id/match-explicacao]", err.message);
    res.status(502).json({ error: "Erro ao gerar explicação com IA. Tente novamente em instantes." });
  }
});

// ── Mentor de carreira (chat) — exclusivo plano PRO ──────────
const MENTOR_GATE_MSG = "O mentor de carreira é exclusivo do plano PRO. Faça upgrade para conversar com o mentor.";

router.get("/mentor/historico", isAuth, requireDevType, requireFeature("mentor_carreira", MENTOR_GATE_MSG), async (req, res) => {
  try {
    const history = await getHistory(req.session.user.id);
    res.json(history);
  } catch (err) {
    console.error("[GET /api/ai/mentor/historico]", err.message);
    res.status(500).json({ error: "Erro interno. Tente novamente." });
  }
});

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
  handleValidation,
  async (req, res) => {
    const userId   = req.session.user.id;
    const githubId = req.session.user.github_id ?? userId;
    const nivel    = req.session.user.nivel;

    try {
      let anexoTexto;
      if (req.file) {
        anexoTexto = await extractText(req.file.buffer, req.file.mimetype);
      }

      const resposta = await sendMessage(userId, githubId, nivel, req.body.mensagem, anexoTexto);
      res.status(201).json({ resposta });
    } catch (err) {
      console.error("[POST /api/ai/mentor/mensagem]", err.message);
      if (err.message.includes("Formato de arquivo não suportado") || err.message.includes("extrair texto")) {
        return res.status(400).json({ error: err.message });
      }
      res.status(502).json({ error: "Erro ao falar com o mentor. Tente novamente em instantes." });
    }
  }
);

// ── Simulador de entrevista técnica — exclusivo plano PRO ────
const ENTREVISTA_GATE_MSG = "O simulador de entrevista técnica é exclusivo do plano PRO. Faça upgrade para praticar.";

router.post(
  "/entrevista/iniciar",
  isAuth,
  requireDevType,
  requireFeature("simulador_entrevista", ENTREVISTA_GATE_MSG),
  body("job_id").optional({ nullable: true }).isInt({ min: 1 }).withMessage("job_id deve ser inteiro positivo.").toInt(),
  handleValidation,
  async (req, res) => {
    const userId   = req.session.user.id;
    const githubId = req.session.user.github_id ?? userId;
    const nivel    = req.session.user.nivel;
    const jobId    = req.body.job_id ?? null;

    try {
      const simulacao = await gerarPergunta(userId, githubId, nivel, jobId);
      res.status(201).json(simulacao);
    } catch (err) {
      console.error("[POST /api/ai/entrevista/iniciar]", err.message);
      res.status(502).json({ error: "Erro ao gerar pergunta com IA. Tente novamente em instantes." });
    }
  }
);

router.post(
  "/entrevista/:id/responder",
  isAuth,
  requireDevType,
  requireFeature("simulador_entrevista", ENTREVISTA_GATE_MSG),
  ...intParam("id"),
  body("resposta").trim().isLength({ min: 1, max: 4000 }).withMessage("Resposta deve ter entre 1 e 4000 caracteres."),
  handleValidation,
  async (req, res) => {
    try {
      const resultado = await avaliarResposta(req.session.user.id, req.params.id, req.body.resposta);
      res.json(resultado);
    } catch (err) {
      console.error("[POST /api/ai/entrevista/:id/responder]", err.message);
      if (err.message === "Simulação não encontrada.") {
        return res.status(404).json({ error: err.message });
      }
      res.status(502).json({ error: "Erro ao avaliar resposta com IA. Tente novamente em instantes." });
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
    console.error("[GET /api/ai/insights-mercado]", err.message);
    if (err.message.includes("Nenhuma vaga")) {
      return res.status(404).json({ error: "Ainda não há dados suficientes de vagas pra gerar insights." });
    }
    res.status(502).json({ error: "Erro ao gerar insights com IA. Tente novamente em instantes." });
  }
});

module.exports = router;
