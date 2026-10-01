const express             = require("express");
const router              = express.Router();
const { param }           = require("express-validator");
const roadmapController   = require("../controllers/roadmapController");
const { isAuth }          = require("../middlewares/auth");
const { handleValidation } = require("../validators/handle-validation");
const { validateUpdateProgress } = require("../validators/roadmap.validator");

const intParam = name => [
  param(name).isInt({ min: 1 }).withMessage(`${name} deve ser inteiro positivo.`).toInt(),
  handleValidation,
];

router.get("/jobs",                           roadmapController.listJobs);
router.get("/jobs/detalhes",                  roadmapController.listJobsWithDetails);
router.get("/vagas/:id",                      ...intParam("id"),    roadmapController.getPublicJob);
router.post("/vagas/:id/candidatar",   isAuth, ...intParam("id"),    roadmapController.applyToJob);
router.get("/roadmap/:jobId",          isAuth, ...intParam("jobId"), roadmapController.getRoadmap);
router.patch("/roadmap/:jobId/skill/:skillId", isAuth, validateUpdateProgress, roadmapController.updateSkillStatus);
router.get("/dashboard",               isAuth, roadmapController.getDashboard);
router.get("/user/languages",          isAuth, roadmapController.getLanguageDistribution);

module.exports = router;
