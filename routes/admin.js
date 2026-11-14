const express         = require("express");
const router          = express.Router();
const adminController = require("../controllers/adminController");
const { isAdmin }     = require("../middlewares/auth");

router.use(isAdmin);
router.use(require("../middlewares/adminAudit").auditarAdmin); // histórico de atividades

router.get("/dashboard", adminController.getDashboard);

router.get("/users",             adminController.getUsers);
router.get("/users/:id",         adminController.getUserDetail);
router.patch("/users/:id",       adminController.updateUserStatus);
router.delete("/users/:id",      adminController.deleteUser);
router.patch("/users/:id/plan",  adminController.updateUserPlan);
router.post("/users/:id/skills",           adminController.addUserSkill);
router.delete("/users/:id/skills/:skillId", adminController.removeUserSkill);

router.get("/empresas",             adminController.getEmpresas);
router.get("/empresas/:id",         adminController.getEmpresaDetail);
router.patch("/empresas/:id",       adminController.updateEmpresaStatus);
router.delete("/empresas/:id",     adminController.deleteEmpresa);
router.patch("/empresas/:id/plan",  adminController.updateEmpresaPlan);

router.get("/jobs",            adminController.getJobs);
router.patch("/jobs/:id",      adminController.updateJobStatus);
router.delete("/jobs/:id",     adminController.deleteJob);

router.get("/reports",         adminController.getReports);
router.get("/reports/crescimento-de-usuarios",     adminController.getRelatorioCrescimento);
router.get("/reports/crescimento-de-usuarios.:formato", adminController.exportRelatorio(require("../services/relatorioCrescimento")));
router.get("/reports/desempenho-das-vagas",         adminController.getRelatorioDesempenho);
router.get("/reports/desempenho-das-vagas.:formato", adminController.exportRelatorio(require("../services/relatorioDesempenho")));
router.get("/reports/compatibilidade-de-matchs",          adminController.getRelatorioMatchs);
router.get("/reports/compatibilidade-de-matchs.:formato", adminController.exportRelatorio(require("../services/relatorioMatchs")));
router.get("/reports/atividade-das-empresas",          adminController.getRelatorioEmpresas);
router.get("/reports/atividade-das-empresas.:formato", adminController.exportRelatorio(require("../services/relatorioEmpresas")));
router.get("/reports/uso-da-plataforma",          adminController.getRelatorioUso);
router.get("/reports/uso-da-plataforma.:formato", adminController.exportRelatorio(require("../services/relatorioUso")));
router.get("/reports/planos-e-assinaturas",          adminController.getRelatorioPlanos);
router.get("/reports/planos-e-assinaturas.:formato", adminController.exportRelatorio(require("../services/relatorioPlanos")));

router.get("/admins",                adminController.listAdmins);
router.delete("/admins/:id",         adminController.removeAdmin);
router.get("/audit-log",             adminController.listAuditLog);

router.get("/job-categories",        adminController.listJobCategories);
router.post("/job-categories",       adminController.createJobCategory);
router.patch("/job-categories/:id",  adminController.updateJobCategory);
router.get("/job-options",           adminController.getJobOptions);

router.get("/skills",                       adminController.getSkills);
router.post("/skills",                      adminController.createSkill);
router.patch("/skills/:id",                 adminController.updateSkill);
router.delete("/skills/:id",                adminController.deleteSkill);
router.get("/skills/:id/resources",         adminController.getSkillResources);
router.post("/skills/:id/resources",        adminController.addSkillResource);
router.delete("/skills/:id/resources/:resourceId", adminController.deleteSkillResource);

module.exports = router;
