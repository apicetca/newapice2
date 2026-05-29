// ============================================
// routes/users.js
// Cadastro e login por email/senha.
// Usa: User model + express-validator.
// ============================================
const express = require("express");
const bcrypt  = require("bcrypt");
const router  = express.Router();

const User = require("../models/User");
const { validateRegister, validateLogin } = require("../validators/auth.validator");

const SALT_ROUNDS = 10;

function buildSession(userId, email, type, extra = {}) {
  return { id: userId, email: email.toLowerCase().trim(), type, ...extra };
}

// ──────────────────────────────────────────────────────────
// POST /api/auth/register
// ──────────────────────────────────────────────────────────
router.post("/register", validateRegister, async (req, res) => {
  const { type, email, password } = req.body;

  try {
    const existing = await User.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "Este e-mail já está cadastrado." });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const userId       = await User.create({ email, passwordHash, type });

    if (type === "dev") {
      const { nome, sobrenome, github_login, nivel, cpf, telefone, rg } = req.body;
      await User.createDevProfile({
        userId, nome,
        sobrenome:   sobrenome    ?? null,
        githubLogin: github_login ?? null,
        nivel:       nivel        ?? "iniciante",
        cpf:         cpf          ? cpf.replace(/\D/g, "") : null,
        telefone:    telefone     ? telefone.replace(/\D/g, "") : null,
        rg:          rg           ?? null,
      });
      req.session.user = buildSession(userId, email, type, {
        name: `${nome} ${sobrenome ?? ""}`.trim(),
        github_login: github_login ?? null,
        nivel: nivel ?? "iniciante",
      });
    } else {
      const { razao_social, nome_fantasia, cnpj, setor, tamanho, site } = req.body;
      const cnpjDigits = cnpj.replace(/\D/g, "");

      if (await User.cnpjExists(cnpjDigits)) {
        return res.status(409).json({ error: "Este CNPJ já está cadastrado." });
      }

      await User.createCompanyProfile({ userId, razaoSocial: razao_social, nomeFantasia: nome_fantasia ?? null, cnpj: cnpjDigits, setor: setor ?? null, tamanho: tamanho ?? null, site: site ?? null });
      req.session.user = buildSession(userId, email, type, { name: nome_fantasia || razao_social });
    }

    return res.status(201).json({ success: true, redirect: type === "dev" ? "/dashboard" : "/empresa/dashboard" });
  } catch (err) {
    console.error("[POST /api/auth/register]", err.message);
    return res.status(500).json({ error: "Erro interno. Tente novamente." });
  }
});

// ──────────────────────────────────────────────────────────
// POST /api/auth/login
// ──────────────────────────────────────────────────────────
router.post("/login", validateLogin, async (req, res) => {
  const { email, password } = req.body;
  const INVALID = "E-mail ou senha incorretos.";

  try {
    const user = await User.findByEmail(email);
    if (!user || !user.password_hash) return res.status(401).json({ error: INVALID });

    if (!(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: INVALID });
    }

    req.session.user = buildSession(user.id, user.email, user.type);

    if (user.type === "dev") {
      const profile = await User.findDevProfile(user.id);
      if (profile) {
        req.session.user.name         = `${profile.nome} ${profile.sobrenome ?? ""}`.trim();
        req.session.user.github_login = profile.github_login;
        req.session.user.nivel        = profile.nivel;
      }
    } else {
      const profile = await User.findCompanyProfile(user.id);
      if (profile) {
        req.session.user.name         = profile.nome_fantasia ?? profile.razao_social;
        req.session.user.razao_social = profile.razao_social;
      }
    }

    return res.json({ success: true, redirect: user.type === "dev" ? "/dashboard" : "/empresa/dashboard" });
  } catch (err) {
    console.error("[POST /api/auth/login]", err.message);
    return res.status(500).json({ error: "Erro interno. Tente novamente." });
  }
});

module.exports = router;