// ============================================
// routes/trilha.js
// Sistema de Roadmap novo (fases/etapas via IA) — montado em /trilha, não
// em /roadmap, pra não colidir com o roadmap antigo (gap de skills por
// vaga) já em produção. Ver docs/roadmap-diagnostico.md.
//
// requireDev (redireciona pra /login se não autenticado, ou pro painel
// certo se autenticado como outro tipo de conta) — mesmo padrão das
// páginas autenticadas definidas em server.js (/dashboard, /roadmap,
// /meu-progresso...), já que este router não é uma API JSON pura: a
// maioria das rotas renderiza texto/HTML, só a de etapa responde JSON.
// ============================================
const express = require("express");
const router  = express.Router();

const { requireDev } = require("../middlewares/auth");
const { limiteRoadmapsAtivos, limiteRegeneracao } = require("../middlewares/roadmapLimites");
const trilhaController = require("../controllers/trilhaController");

// Sem isto, req.body fica vazio no <form method="POST"> de novo.ejs (o
// navegador manda application/x-www-form-urlencoded, não JSON) — sempre
// caía no "Escolha um objetivo" porque tipo/area/horasSemana chegavam
// undefined. Escopado a este router (não em server.js) porque só as
// rotas de /trilha recebem POST de formulário HTML puro no projeto.
router.use(express.urlencoded({ extended: false }));

router.use(requireDev);

router.get("/",     trilhaController.listar);
router.get("/novo", trilhaController.formularioNovo);
router.post("/",    limiteRoadmapsAtivos, trilhaController.criar);

router.get("/:id",                    trilhaController.carregarRoadmap, trilhaController.detalhe);
router.post("/:id/etapas/:etapaId",   trilhaController.carregarRoadmap, trilhaController.atualizarEtapa);
router.post("/:id/fases/:faseId/projeto", trilhaController.carregarRoadmap, trilhaController.enviarProjeto);
router.post("/:id/regenerar",         trilhaController.carregarRoadmap, limiteRegeneracao, trilhaController.regenerar);
router.post("/:id/arquivar",          trilhaController.carregarRoadmap, trilhaController.arquivar);

module.exports = router;
