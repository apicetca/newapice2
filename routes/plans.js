const express         = require("express");
const router          = express.Router();
const plansController = require("../controllers/plansController");
const { isAuth }      = require("../middlewares/auth");

router.get("/",          isAuth, plansController.getPlans);
router.post("/subscribe", isAuth, plansController.subscribe);

module.exports = router;
