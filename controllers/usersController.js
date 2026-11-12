const bcrypt = require("bcrypt");
const crypto = require("crypto");
const db     = require("../database/db");
const User   = require("../models/User");
const { sendPasswordResetEmail } = require("../services/emailService");
const {
  validateRegister, validateLogin,
  validateForgotPassword, validateResetPassword,
} = require("../validators/auth.validator");


const SALT_ROUNDS = 10;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

function buildSession(userId, email, type, extra = {}) {
  return { id: userId, email: email.toLowerCase().trim(), type, ...extra };
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const usersController = {
  validationRules: { validateRegister, validateLogin, validateForgotPassword, validateResetPassword },

  register: async (req, res) => {
    const { type, email, password } = req.body;

    try {
      const existing = await User.findByEmail(email);
      if (existing) {
        return res.status(409).json({ error: "Este e-mail já está cadastrado." });
      }

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      const userId       = await User.create({ email, passwordHash, type });

      if (type === "dev") {
        const { nome, sobrenome, github_login, nivel } = req.body;
        await User.createDevProfile({
          userId,
          nome,
          sobrenome:   sobrenome   ?? null,
          githubLogin: github_login ?? null,
          nivel:       nivel        ?? "iniciante",
        });
        req.session.user = buildSession(userId, email, type, {
          name:         `${nome} ${sobrenome ?? ""}`.trim(),
          github_login: github_login ?? null,
          nivel:        nivel ?? "iniciante",
        });
      } else {
        const { razao_social, nome_fantasia, cnpj, setor, tamanho, site } = req.body;
        const cnpjDigits = cnpj.replace(/\D/g, "");

        if (await User.cnpjExists(cnpjDigits)) {
          return res.status(409).json({ error: "Este CNPJ já está cadastrado." });
        }

        await User.createCompanyProfile({
          userId,
          razaoSocial:  razao_social,
          nomeFantasia: nome_fantasia ?? null,
          cnpj:         cnpjDigits,
          setor:        setor    ?? null,
          tamanho:      tamanho  ?? null,
          site:         site     ?? null,
        });
        req.session.user = buildSession(userId, email, type, {
          name: nome_fantasia || razao_social,
        });
      }

      return res.status(201).json({
        success:  true,
        redirect: type === "dev" ? "/dashboard" : "/empresa/dashboard",
      });
    } catch (err) {
      console.error("[POST /api/auth/register]", err.message);
      return res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  login: async (req, res) => {
    const { email, password, next } = req.body;
    const INVALID = "E-mail ou senha incorretos.";

    try {
      const user = await User.findByEmail(email);
      if (!user || !user.password_hash) return res.status(401).json({ error: INVALID });

      if (!(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: INVALID });
      }

      if (!user.active) {
        return res.status(403).json({ error: "Esta conta está suspensa. Entre em contato com o suporte." });
      }

      req.session.user = buildSession(user.id, user.email, user.type);

      if (user.type === "dev") {
        const profile = await User.findDevProfile(user.id);
        if (profile) {
          req.session.user.name         = `${profile.nome} ${profile.sobrenome ?? ""}`.trim();
          req.session.user.github_login = profile.github_login;
          req.session.user.nivel        = profile.nivel;
        }
      } else if (user.type === "empresa") {
        const profile = await User.findCompanyProfile(user.id);
        if (profile) {
          req.session.user.name         = profile.nome_fantasia ?? profile.razao_social;
          req.session.user.razao_social = profile.razao_social;
        }
      } else if (user.type === "admin") {
        const profile = await User.findAdminProfile(user.id);
        if (profile) req.session.user.name = profile.nome;
      }

      const REDIRECT_BY_TYPE = { dev: "/dashboard", empresa: "/empresa/dashboard", admin: "/admin/dashboard" };
      // `next` só é aceito se for um path interno (evita virar um redirect aberto).
      const isSafeNext = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.includes("://");
      return res.json({
        success:  true,
        redirect: isSafeNext ? next : (REDIRECT_BY_TYPE[user.type] ?? "/dashboard"),
      });
    } catch (err) {
      console.error("[POST /api/auth/login]", err.message);
      return res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  // Resposta sempre genérica — não revela se o e-mail está cadastrado
  // ou se a conta usa login por GitHub (sem senha).
  forgotPassword: async (req, res) => {
    const { email } = req.body;
    const GENERIC = { success: true, message: "Se este e-mail estiver cadastrado, enviamos um link de redefinição." };

    try {
      const user = await User.findByEmail(email);

      if (user && user.password_hash) {
        const token      = crypto.randomBytes(32).toString("hex");
        const tokenHash  = hashResetToken(token);
        const expiresAt  = new Date(Date.now() + RESET_TOKEN_TTL_MS);

        await db.query(
          "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
          [user.id, tokenHash, expiresAt]
        );

        const resetUrl = `${process.env.APP_URL}/redefinir-senha?token=${token}`;

        try {
          await sendPasswordResetEmail(user.email, resetUrl);
        } catch (mailErr) {
          // Não falha a requisição por causa disso — só loga para o time notar
          // que o SMTP não está configurado / falhou.
          console.error("[POST /api/auth/forgot-password] envio de e-mail falhou:", mailErr.message);
        }
      }

      return res.json(GENERIC);
    } catch (err) {
      console.error("[POST /api/auth/forgot-password]", err.message);
      return res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  resetPassword: async (req, res) => {
    const { token, password } = req.body;
    const tokenHash = hashResetToken(token);

    try {
      const [rows] = await db.query(
        "SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ? LIMIT 1",
        [tokenHash]
      );
      const record = rows[0];

      if (!record || record.used_at || new Date(record.expires_at) < new Date()) {
        return res.status(400).json({ error: "Link inválido ou expirado. Solicite um novo." });
      }

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      await db.query("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, record.user_id]);

      // Marca esse token (e qualquer outro pendente do mesmo usuário) como usado.
      await db.query(
        "UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL",
        [record.user_id]
      );

      return res.json({ success: true, message: "Senha redefinida com sucesso. Faça login." });
    } catch (err) {
      console.error("[POST /api/auth/reset-password]", err.message);
      return res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },
};

module.exports = usersController;
