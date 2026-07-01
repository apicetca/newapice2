const express          = require("express");
const router           = express.Router();
const rateLimit        = require("express-rate-limit");
const usersController  = require("../controllers/usersController");
const { validateRegister, validateLogin } = require("../validators/auth.validator");

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." },
});

router.post("/register", authLimiter, validateRegister, usersController.register);
router.post("/login",    authLimiter, validateLogin,    usersController.login);

module.exports = router;
