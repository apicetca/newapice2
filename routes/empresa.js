const express            = require("express");
const router             = express.Router();
const empresaController  = require("../controllers/empresaController");
const { isEmpresa }      = require("../middlewares/auth");
const { validateCreateJob, validateUpdateJob } = require("../validators/job.vlidator");

router.get("/dashboard",          isEmpresa, empresaController.getDashboard);
router.get("/skills",             isEmpresa, empresaController.getSkills);
router.post("/jobs",              isEmpresa, validateCreateJob, empresaController.createJob);
router.patch("/jobs/:id",         isEmpresa, validateUpdateJob, empresaController.updateJob);
router.delete("/jobs/:id",        isEmpresa, empresaController.deleteJob);
router.get("/jobs/:id/skills",    isEmpresa, empresaController.getJobSkills);
router.put("/jobs/:id/skills",    isEmpresa, empresaController.updateJobSkills);
router.get("/profile",            isEmpresa, empresaController.getProfile);
router.patch("/profile",          isEmpresa, empresaController.updateProfile);
router.get("/dev/:id/perfil",     isEmpresa, empresaController.getDevProfile);

module.exports = router;
