const express            = require("express");
const router             = express.Router();
const profileController  = require("../controllers/profileController");
const { isAuth }         = require("../middlewares/auth");

router.get("/profile",          isAuth, profileController.getProfile);
router.patch("/profile",        isAuth, profileController.updateProfile);
router.post("/avatar",          isAuth, profileController.handleAvatarUpload, profileController.saveAvatar);
router.post("/reanalyze",       isAuth, profileController.reanalyze);
router.post("/skills",          isAuth, profileController.addSkill);
router.delete("/skills/:skillId", isAuth, profileController.removeSkill);
router.get("/skills/catalog",   isAuth, profileController.getSkillsCatalog);
router.post("/plano",           isAuth, profileController.setPlan);

module.exports = router;
