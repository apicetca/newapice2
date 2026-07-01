const path  = require("path");

const fs    = require("fs");
const axios = require("axios");
const multer = require("multer");
const db    = require("../database/db");
const { matchSkillsFromGitHub } = require("../services/githubAnalyzer");
const { getTokenStore } = require("./authController");

// ── Avatar upload (multer) ────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, "../public/uploads/avatars");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req,  file,  cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${req.session.user.id}${ext}`);
  },
});

const uploadAvatar = multer({
  storage:  avatarStorage,
  limits:   { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Formato inválido. Use JPEG, PNG, WebP ou GIF."));
  },
});

// Retorna o github_id da sessão ou o user_id como fallback
function getUserId(req) {
  return req.session.user.github_id ?? req.session.user.id;
}

const profileController = {
  getProfile: async (req, res) => {
    const userId = req.session.user.id;

    try {
      const [users] = await db.query(
        "SELECT id, email, type, created_at FROM users WHERE id = ?",
        [userId]
      );

      const userRow = users[0] ?? {
        id:         userId,
        email:      req.session.user.email ?? "",
        type:       req.session.user.type  ?? "dev",
        created_at: null,
      };

      const [profiles] = await db.query(
        "SELECT * FROM user_dev_profiles WHERE user_id = ?",
        [userId]
      );
      const profile = profiles[0] ?? {};

      const githubId = getUserId(req);
      const [skills] = await db.query(`
        SELECT us.skill_id, us.source, us.confidence,
               s.name, s.type, s.category
        FROM user_skills us
        JOIN skills s ON s.id = us.skill_id
        WHERE us.github_id = ?
        ORDER BY us.confidence DESC, s.name ASC
      `, [githubId]);

      res.json({
        id:           userRow.id,
        email:        userRow.email,
        type:         userRow.type,
        created_at:   userRow.created_at,
        nome:         profile.nome         ?? "",
        sobrenome:    profile.sobrenome     ?? "",
        github_login: profile.github_login  ?? req.session.user.login ?? "",
        nivel:        profile.nivel         ?? "iniciante",
        avatar:       profile.avatar_url   ?? req.session.user.avatar ?? null,
        skills,
      });
    } catch (err) {
      console.error("Erro ao buscar perfil:", err.message);
      res.status(500).json({ error: "Erro interno." });
    }
  },

  // Middleware que processa o upload antes do handler
  handleAvatarUpload: (req, res, next) => {
    uploadAvatar.single("avatar")(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Arquivo muito grande. Máximo 2 MB." });
      }
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },

  saveAvatar: async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });

    const userId    = req.session.user.id;
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    try {
      const exts = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
      for (const ext of exts) {
        const old = path.join(UPLOAD_DIR, `${userId}${ext}`);
        if (old !== path.join(UPLOAD_DIR, req.file.filename) && fs.existsSync(old)) {
          fs.unlinkSync(old);
        }
      }

      await db.query(
        "UPDATE user_dev_profiles SET avatar_url = ? WHERE user_id = ?",
        [avatarUrl, userId]
      );

      req.session.user.avatar = avatarUrl;
      res.json({ success: true, avatar: avatarUrl });
    } catch (err) {
      console.error("[POST /api/user/avatar]", err.message);
      res.status(500).json({ error: "Erro ao salvar foto." });
    }
  },

  updateProfile: async (req, res) => {
    const userId = req.session.user.id;
    const { nome, sobrenome, github_login, nivel } = req.body;

    if (nome !== undefined && nome.trim() === "") {
      return res.status(400).json({ error: "Nome não pode ser vazio." });
    }

    const nivelsValidos = ["iniciante", "intermediario", "avancado"];
    if (nivel && !nivelsValidos.includes(nivel)) {
      return res.status(400).json({ error: "Nível inválido." });
    }

    if (github_login && !/^[a-zA-Z0-9-]+$/.test(github_login.trim())) {
      return res.status(400).json({ error: "Usuário GitHub inválido." });
    }

    try {
      const [existing] = await db.query(
        "SELECT id FROM user_dev_profiles WHERE user_id = ?",
        [userId]
      );

      if (existing.length > 0) {
        const fields = [];
        const values = [];

        if (nome         !== undefined) { fields.push("nome = ?");         values.push(nome.trim()); }
        if (sobrenome    !== undefined) { fields.push("sobrenome = ?");     values.push(sobrenome.trim() || null); }
        if (github_login !== undefined) { fields.push("github_login = ?");  values.push(github_login.trim() || null); }
        if (nivel        !== undefined) { fields.push("nivel = ?");         values.push(nivel); }

        if (fields.length > 0) {
          values.push(userId);
          await db.query(
            `UPDATE user_dev_profiles SET ${fields.join(", ")} WHERE user_id = ?`,
            values
          );
        }
      } else {
        await db.query(
          `INSERT INTO user_dev_profiles (user_id, nome, sobrenome, github_login, nivel)
           VALUES (?, ?, ?, ?, ?)`,
          [
            userId,
            nome?.trim()         ?? "",
            sobrenome?.trim()    ?? null,
            github_login?.trim() ?? null,
            nivel                ?? "iniciante",
          ]
        );
      }

      if (nome)         req.session.user.name         = `${nome.trim()} ${sobrenome?.trim() ?? ""}`.trim();
      if (github_login) req.session.user.github_login = github_login.trim();
      if (nivel)        req.session.user.nivel        = nivel;

      res.json({ success: true, message: "Perfil atualizado com sucesso." });
    } catch (err) {
      console.error("Erro ao atualizar perfil:", err.message);
      res.status(500).json({ error: "Erro interno." });
    }
  },

  reanalyze: async (req, res) => {
    const { github_id } = req.session.user;
    const accessToken   = getTokenStore().get(req.session.id);

    if (!accessToken) {
      return res.status(400).json({
        error: "Re-análise disponível apenas para contas conectadas ao GitHub.",
      });
    }

    try {
      const { data: repos } = await axios.get(
        "https://api.github.com/user/repos?sort=updated&per_page=50",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      const detected = await matchSkillsFromGitHub(
        accessToken,
        github_id ?? req.session.user.id,
        repos
      );

      res.json({
        success:  true,
        message:  `Análise concluída. ${detected.length} skill(s) detectada(s).`,
        detected: detected.length,
      });
    } catch (err) {
      console.error("Erro na re-análise:", err.message);
      res.status(500).json({ error: "Erro ao re-analisar repositórios." });
    }
  },

  addSkill: async (req, res) => {
    const { skill_id } = req.body;
    const githubId     = getUserId(req);

    if (!skill_id) return res.status(400).json({ error: "skill_id é obrigatório." });

    try {
      const [skills] = await db.query("SELECT id, name FROM skills WHERE id = ?", [skill_id]);
      if (!skills.length) return res.status(404).json({ error: "Skill não encontrada." });

      await db.query(`
        INSERT INTO user_skills (github_id, skill_id, source, confidence)
        VALUES (?, ?, 'manual', 70)
        ON DUPLICATE KEY UPDATE source = 'manual', confidence = GREATEST(confidence, 70)
      `, [githubId, skill_id]);

      res.json({ success: true, skill: skills[0] });
    } catch (err) {
      console.error("Erro ao adicionar skill:", err.message);
      res.status(500).json({ error: "Erro interno." });
    }
  },

  removeSkill: async (req, res) => {
    const githubId = getUserId(req);
    const skillId  = req.params.skillId;

    try {
      await db.query(
        "DELETE FROM user_skills WHERE github_id = ? AND skill_id = ? AND source = 'manual'",
        [githubId, skillId]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Erro ao remover skill:", err.message);
      res.status(500).json({ error: "Erro interno." });
    }
  },

  getSkillsCatalog: async (req, res) => {
    try {
      const [skills] = await db.query(
        "SELECT id, name, type, category FROM skills ORDER BY type, category, name"
      );
      res.json(skills);
    } catch (err) {
      res.status(500).json({ error: "Erro interno." });
    }
  },
};

module.exports = profileController;
