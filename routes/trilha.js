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

router.use(requireDev);

router.get("/",     trilhaController.listar);
router.get("/novo", trilhaController.formularioNovo);
router.post("/",    limiteRoadmapsAtivos, trilhaController.criar);

router.get("/:id",                    trilhaController.carregarRoadmap, trilhaController.detalhe);
router.post("/:id/etapas/:etapaId",   trilhaController.carregarRoadmap, trilhaController.atualizarEtapa);
router.post("/:id/regenerar",         trilhaController.carregarRoadmap, limiteRegeneracao, trilhaController.regenerar);
router.post("/:id/arquivar",          trilhaController.carregarRoadmap, trilhaController.arquivar);

module.exports = router;
