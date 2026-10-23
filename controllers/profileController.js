const path  = require("path");

const fs    = require("fs");
const axios = require("axios");
const multer = require("multer");
const db    = require("../database/db");
const { analisarGitHub } = require("../services/githubAnalyzer");
const { MENSAGEM_GITHUB_INDISPONIVEL, ehFalhaDeLeitura, registrarFalha } = require("../services/githubErrors");
const { getUserPlan } = require("../services/subscriptionService");
const {
  CONFIANCA_POR_NIVEL, NIVEIS_DECLARADOS, combinar, detectadaDe,
} = require("../services/skillOrigem");

// ── Avatar upload (multer) ────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, "../public/uploads/avatars");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Extensão é derivada do mimetype validado, NUNCA do nome de arquivo
// enviado pelo cliente — filename e mimetype de multipart são ambos
// controláveis pelo atacante, então usar o originalname para decidir
// a extensão salva permitia gravar ex. ".html" em /public/uploads/
// (servido estaticamente) e obter execução de script no mesmo domínio.
const MIME_TO_EXT = {
  "image/jpeg": ".jpg",
  "image/png":  ".png",
  "image/webp": ".webp",
  "image/gif":  ".gif",
};

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req,  file,  cb) => {
    const ext = MIME_TO_EXT[file.mimetype] || ".jpg";
    cb(null, `${req.session.user.id}${ext}`);
  },
});

const uploadAvatar = multer({
  storage:  avatarStorage,
  limits:   { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (MIME_TO_EXT[file.mimetype]) cb(null, true);
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

      // "Por quê?" de cada skill detectada: de quais repositórios vieram os
      // pontos. Sem a tabela (migração ainda não rodada), segue sem evidências.
      let evidencias = [];
      try {
        [evidencias] = await db.query(
          `SELECT skill_id, repo_full_name, tipo, pontos
           FROM user_skill_evidencias
           WHERE github_id = ?
           ORDER BY pontos DESC, repo_full_name ASC`,
          [githubId]
        );
      } catch (err) {
        if (err.code !== "ER_NO_SUCH_TABLE") throw err;
      }
      const evidenciasPorSkill = {};
      for (const ev of evidencias) {
        (evidenciasPorSkill[ev.skill_id] ??= []).push({ repo: ev.repo_full_name, tipo: ev.tipo, pontos: ev.pontos });
      }
      for (const sk of skills) sk.evidencias = evidenciasPorSkill[sk.skill_id] ?? [];

      // Nível declarado no autodiagnóstico (Etapa 7), quando houver.
      let declaracoes = [];
      try {
        [declaracoes] = await db.query(
          "SELECT skill_id, nivel FROM user_skill_declaracoes WHERE github_id = ?",
          [githubId]
        );
      } catch (err) {
        if (err.code !== "ER_NO_SUCH_TABLE") throw err;
      }
      const nivelPorSkill = Object.fromEntries(declaracoes.map(d => [d.skill_id, d.nivel]));
      for (const sk of skills) sk.nivel_declarado = nivelPorSkill[sk.skill_id] ?? null;

      const plan = await getUserPlan(userId, "dev");

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
        plan: { code: plan.code, name: plan.name, price_cents: plan.price_cents, features: plan.features },
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
    const { accessToken, github_id } = req.session.user;

    if (!accessToken) {
      return res.status(400).json({
        error: "Re-análise disponível apenas para contas conectadas ao GitHub.",
      });
    }

    try {
      const { data: repos } = await axios.get(
        "https://api.github.com/user/repos?sort=updated&per_page=50&affiliation=owner",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      const { status, skills: detected } = await analisarGitHub(
        accessToken,
        github_id ?? req.session.user.id,
        repos,
        { userId: req.session.user.id } // repositórios importados em /repositorios, se houver
      );

      // Falha ao ler o GitHub não é "nenhuma skill": nada foi alterado.
      if (status === "indisponivel") {
        return res.status(503).json({ error: MENSAGEM_GITHUB_INDISPONIVEL });
      }

      res.json({
        success:  true,
        message:  `Análise concluída. ${detected.length} skill(s) detectada(s).`,
        detected: detected.length,
      });
    } catch (err) {
      // Token inválido/expirado, limite de uso ou GitHub fora do ar ao listar os
      // repositórios: mesma mensagem amigável (e nada é alterado).
      if (err.isAxiosError && ehFalhaDeLeitura(err)) {
        registrarFalha("lista de repositórios", "/user/repos", err);
        return res.status(503).json({ error: MENSAGEM_GITHUB_INDISPONIVEL });
      }
      console.error("Erro na re-análise:", err.message);
      res.status(500).json({ error: "Erro ao re-analisar repositórios." });
    }
  },

  // Autodiagnóstico (Etapa 7): o dev declara o nível da skill — iniciante
  // (30), intermediário (60) ou avançado (85). A declaração fica em
  // user_skill_declaracoes e serve de piso: em user_skills vale a maior entre
  // ela e a confiança detectada no GitHub, com `source` = origem desse valor.
  addSkill: async (req, res) => {
    const { skill_id, nivel = "intermediario" } = req.body ?? {};
    const githubId = getUserId(req);

    if (!skill_id) return res.status(400).json({ error: "skill_id é obrigatório." });
    if (!NIVEIS_DECLARADOS.includes(nivel)) {
      return res.status(400).json({ error: `nivel deve ser um de: ${NIVEIS_DECLARADOS.join(", ")}.` });
    }

    let conn;
    try {
      const [skills] = await db.query("SELECT id, name FROM skills WHERE id = ?", [skill_id]);
      if (!skills.length) return res.status(404).json({ error: "Skill não encontrada." });

      const declarada = CONFIANCA_POR_NIVEL[nivel];
      conn = await db.getConnection();
      await conn.beginTransaction();

      try {
        await conn.query(`
          INSERT INTO user_skill_declaracoes (github_id, skill_id, nivel, confidence)
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE nivel = VALUES(nivel), confidence = VALUES(confidence)
        `, [githubId, skill_id, nivel, declarada]);
      } catch (err) {
        if (err.code !== "ER_NO_SUCH_TABLE") throw err;
        console.error("[addSkill] tabela user_skill_declaracoes não existe — rode `npm run migrate:analise-perfil`.");
      }

      const [[atual]] = await conn.query(
        "SELECT source, confidence FROM user_skills WHERE github_id = ? AND skill_id = ?",
        [githubId, skill_id]
      );
      const detectada = await detectadaDe(conn, githubId, skill_id, atual);
      const final = combinar(detectada, declarada);

      await conn.query(`
        INSERT INTO user_skills (github_id, skill_id, source, confidence)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE source = VALUES(source), confidence = VALUES(confidence)
      `, [githubId, skill_id, final.source, final.confidence]);

      await conn.commit();
      res.json({ success: true, skill: skills[0], nivel, confidence: final.confidence, source: final.source });
    } catch (err) {
      if (conn) await conn.rollback().catch(() => {});
      console.error("Erro ao adicionar skill:", err.message);
      res.status(500).json({ error: "Erro interno." });
    } finally {
      if (conn) conn.release();
    }
  },

  // Remove a DECLARAÇÃO do dev. Se o GitHub também detectou a skill, ela
  // continua no perfil com a confiança detectada (source 'github').
  removeSkill: async (req, res) => {
    const githubId = getUserId(req);
    const skillId  = req.params.skillId;

    let conn;
    try {
      conn = await db.getConnection();
      await conn.beginTransaction();

      let tinhaDeclaracao = false;
      try {
        const [r] = await conn.query(
          "DELETE FROM user_skill_declaracoes WHERE github_id = ? AND skill_id = ?",
          [githubId, skillId]
        );
        tinhaDeclaracao = r.affectedRows > 0;
      } catch (err) {
        if (err.code !== "ER_NO_SUCH_TABLE") throw err;
      }

      const [[atual]] = await conn.query(
        "SELECT source, confidence FROM user_skills WHERE github_id = ? AND skill_id = ?",
        [githubId, skillId]
      );

      // Só dá para remover o que o dev declarou (ou uma skill manual antiga).
      if (!tinhaDeclaracao && atual?.source !== "manual") {
        await conn.rollback();
        return res.status(400).json({ error: "Só é possível remover habilidades declaradas por você." });
      }

      let restante = null;
      if (atual) {
        const detectada = await detectadaDe(conn, githubId, skillId, atual);
        if (detectada > 0) {
          await conn.query(
            "UPDATE user_skills SET source = 'github', confidence = ? WHERE github_id = ? AND skill_id = ?",
            [detectada, githubId, skillId]
          );
          restante = { source: "github", confidence: detectada };
        } else {
          await conn.query("DELETE FROM user_skills WHERE github_id = ? AND skill_id = ?", [githubId, skillId]);
        }
      }

      await conn.commit();
      res.json({ success: true, restante });
    } catch (err) {
      if (conn) await conn.rollback().catch(() => {});
      console.error("Erro ao remover skill:", err.message);
      res.status(500).json({ error: "Erro interno." });
    } finally {
      if (conn) conn.release();
    }
  },

  getSkillsCatalog: async (req, res) => {
    try {
      const page     = Math.max(1, parseInt(req.query.page)     || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 200));
      const offset   = (page - 1) * pageSize;
      const [[{ total }]] = await db.query("SELECT COUNT(*) AS total FROM skills");
      const [skills] = await db.query(
        "SELECT id, name, type, category FROM skills ORDER BY type, category, name LIMIT ? OFFSET ?",
        [pageSize, offset]
      );
      res.json({ data: skills, total, page, pageSize, pages: Math.ceil(total / pageSize) });
    } catch (err) {
      res.status(500).json({ error: "Erro interno." });
    }
  },
};

module.exports = profileController;
