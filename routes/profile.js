// ============================================
// routes/profile.js
// Rotas de perfil do desenvolvedor
// PATCH /api/user/profile  — atualiza dados
// POST  /api/user/reanalyze — re-analisa GitHub
// GET   /api/user/profile  — retorna perfil completo
// POST  /api/user/skills   — adiciona skill manual
// DELETE /api/user/skills/:skillId — remove skill manual
// ============================================
const express  = require("express");
const axios    = require("axios");
const bcrypt   = require("bcrypt");
const router   = express.Router();
const db       = require("../database/db");
const { matchSkillsFromGitHub } = require("../services/githubAnalyzer");

// ── Middleware de autenticação ────────────────
function isAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Não autenticado." });
  next();
}

// ── Helpers ───────────────────────────────────
// Retorna o github_id da sessão (usuários OAuth)
// ou o user_id como fallback (usuários de email/senha)
function getUserId(req) {
  return req.session.user.github_id ?? req.session.user.id;
}

// ============================================
// GET /api/user/profile
// Retorna perfil completo do dev logado
// ============================================
router.get("/profile", isAuth, async (req, res) => {
  const userId = req.session.user.id;

  try {
    // Dados base do usuário
    const [users] = await db.query(
      "SELECT id, email, type, created_at FROM users WHERE id = ?",
      [userId]
    );

    if (!users.length) return res.status(404).json({ error: "Usuário não encontrado." });

    // Perfil do desenvolvedor
    const [profiles] = await db.query(
      "SELECT * FROM user_dev_profiles WHERE user_id = ?",
      [userId]
    );

    const profile = profiles[0] ?? {};

    // Skills do usuário (detectadas + manuais)
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
      id:           userId,
      email:        users[0].email,
      type:         users[0].type,
      created_at:   users[0].created_at,
      nome:         profile.nome         ?? "",
      sobrenome:    profile.sobrenome     ?? "",
      github_login: profile.github_login  ?? req.session.user.login ?? "",
      nivel:        profile.nivel         ?? "iniciante",
      avatar:       req.session.user.avatar ?? null,
      skills,
    });

  } catch (err) {
    console.error("Erro ao buscar perfil:", err.message);
    res.status(500).json({ error: "Erro interno." });
  }
});

// ============================================
// PATCH /api/user/profile
// Atualiza dados do perfil do dev
// Body: { nome, sobrenome, github_login, nivel }
// ============================================
router.patch("/profile", isAuth, async (req, res) => {
  const userId = req.session.user.id;
  const { nome, sobrenome, github_login, nivel } = req.body;

  // Validações básicas no servidor
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
    // Verifica se o perfil já existe para fazer INSERT ou UPDATE
    const [existing] = await db.query(
      "SELECT id FROM user_dev_profiles WHERE user_id = ?",
      [userId]
    );

    if (existing.length > 0) {
      // Monta UPDATE dinâmico — só atualiza campos enviados
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
      // Cria o perfil se não existir ainda
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

    // Atualiza a sessão com os novos dados
    if (nome)         req.session.user.name         = `${nome.trim()} ${sobrenome?.trim() ?? ""}`.trim();
    if (github_login) req.session.user.github_login = github_login.trim();
    if (nivel)        req.session.user.nivel        = nivel;

    res.json({ success: true, message: "Perfil atualizado com sucesso." });

  } catch (err) {
    console.error("Erro ao atualizar perfil:", err.message);
    res.status(500).json({ error: "Erro interno." });
  }
});

// ============================================
// POST /api/user/reanalyze
// Força re-análise dos repos do GitHub
// Requer que o usuário tenha logado via GitHub
// (pois precisa do accessToken na sessão)
// ============================================
router.post("/reanalyze", isAuth, async (req, res) => {
  const { accessToken, github_id } = req.session.user;

  if (!accessToken) {
    return res.status(400).json({
      error: "Re-análise disponível apenas para contas conectadas ao GitHub.",
    });
  }

  try {
    // Busca os repositórios atuais do usuário no GitHub
    const { data: repos } = await axios.get(
      "https://api.github.com/user/repos?sort=updated&per_page=50",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    // Re-executa a análise e salva no banco
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
});

// ============================================
// POST /api/user/skills
// Adiciona uma skill manualmente ao perfil
// Body: { skill_id }
// ============================================
router.post("/skills", isAuth, async (req, res) => {
  const { skill_id } = req.body;
  const githubId     = getUserId(req);

  if (!skill_id) return res.status(400).json({ error: "skill_id é obrigatório." });

  try {
    // Verifica se a skill existe no catálogo
    const [skills] = await db.query("SELECT id, name FROM skills WHERE id = ?", [skill_id]);
    if (!skills.length) return res.status(404).json({ error: "Skill não encontrada." });

    // Insere com source 'manual' e confidence 70 (declarada pelo usuário)
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
});

router.delete("/skills/:skillId", isAuth, async (req, res) => {
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
});

router.get("/skills/catalog", isAuth, async (req, res) => {
  try {
    const [skills] = await db.query(
      "SELECT id, name, type, category FROM skills ORDER BY type, category, name"
    );
    res.json(skills);
  } catch (err) {
    res.status(500).json({ error: "Erro interno." });
  }
});

// ============================================
// GET /api/user/account
// Metadados da conta (email, tipo, data, se tem senha)
// ============================================
router.get("/account", isAuth, async (req, res) => {
  const userId = req.session.user.id;
  try {
    const [rows] = await db.query(
      "SELECT email, type, created_at, (password_hash IS NOT NULL) AS is_email_account FROM users WHERE id = ?",
      [userId]
    );
    if (!rows.length) return res.status(404).json({ error: "Usuário não encontrado." });
    res.json({
      email:            rows[0].email,
      type:             rows[0].type,
      created_at:       rows[0].created_at,
      is_email_account: Boolean(rows[0].is_email_account),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PATCH /api/user/password
// Altera a senha (somente contas com email/senha)
// Body: { current_password, new_password }
// ============================================
router.patch("/password", isAuth, async (req, res) => {
  const { current_password, new_password } = req.body;
  const userId = req.session.user.id;

  if (!current_password || !new_password)
    return res.status(400).json({ error: "Campos obrigatórios ausentes." });
  if (new_password.length < 8)
    return res.status(400).json({ error: "Nova senha deve ter no mínimo 8 caracteres." });
  if (new_password.length > 128)
    return res.status(400).json({ error: "Nova senha deve ter no máximo 128 caracteres." });
  if (/^\s|\s$/.test(new_password))
    return res.status(400).json({ error: "A senha não pode começar ou terminar com espaços." });

  try {
    const [rows] = await db.query("SELECT password_hash FROM users WHERE id = ?", [userId]);
    if (!rows.length || !rows[0].password_hash)
      return res.status(400).json({ error: "Esta conta usa login pelo GitHub e não possui senha." });

    if (!(await bcrypt.compare(current_password, rows[0].password_hash)))
      return res.status(401).json({ error: "Senha atual incorreta." });

    const newHash = await bcrypt.hash(new_password, 10);
    await db.query("UPDATE users SET password_hash = ? WHERE id = ?", [newHash, userId]);
    res.json({ success: true, message: "Senha alterada com sucesso." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// DELETE /api/user/account
// Exclui a conta permanentemente
// Body: { confirm: "EXCLUIR" }
// ============================================
router.delete("/account", isAuth, async (req, res) => {
  const { confirm } = req.body;
  const userId = req.session.user.id;

  if (confirm !== "EXCLUIR")
    return res.status(400).json({ error: "Digite EXCLUIR para confirmar." });

  try {
    await db.query("DELETE FROM users WHERE id = ?", [userId]);
    req.session.destroy(() => {
      res.json({ success: true, redirect: "/" });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// GET /api/user/saved-jobs
// Lista vagas salvas do usuário com skills
// ============================================
router.get("/saved-jobs", isAuth, async (req, res) => {
  const userId = req.session.user.id;
  try {
    const [jobs] = await db.query(`
      SELECT j.id, j.title, j.company, j.description, j.level
      FROM user_saved_jobs usj
      JOIN jobs j ON j.id = usj.job_id
      WHERE usj.user_id = ?
      ORDER BY usj.saved_at DESC
    `, [userId]);

    if (!jobs.length) return res.json([]);

    const jobIds = jobs.map(j => j.id);
    const [jobSkills] = await db.query(`
      SELECT js.job_id, js.importance, s.id AS skill_id, s.name, s.type, s.category
      FROM job_skills js
      JOIN skills s ON s.id = js.skill_id
      WHERE js.job_id IN (?)
      ORDER BY js.importance DESC, js.learn_order
    `, [jobIds]);

    const skillsByJob = {};
    for (const row of jobSkills) {
      if (!skillsByJob[row.job_id]) skillsByJob[row.job_id] = [];
      skillsByJob[row.job_id].push({
        id: row.skill_id, name: row.name, type: row.type,
        category: row.category, importance: row.importance,
      });
    }

    res.json(jobs.map(j => ({ ...j, skills: skillsByJob[j.id] ?? [] })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// GET /api/user/saved-job-ids
// Retorna IDs das vagas salvas (para marcar na listagem)
// ============================================
router.get("/saved-job-ids", isAuth, async (req, res) => {
  const userId = req.session.user.id;
  try {
    const [rows] = await db.query(
      "SELECT job_id FROM user_saved_jobs WHERE user_id = ?",
      [userId]
    );
    res.json(rows.map(r => r.job_id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// POST /api/user/saved-jobs/:jobId
// Salva uma vaga
// ============================================
router.post("/saved-jobs/:jobId", isAuth, async (req, res) => {
  const userId = req.session.user.id;
  const jobId  = parseInt(req.params.jobId, 10);
  if (!jobId) return res.status(400).json({ error: "jobId inválido." });
  try {
    await db.query(
      "INSERT IGNORE INTO user_saved_jobs (user_id, job_id) VALUES (?, ?)",
      [userId, jobId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// DELETE /api/user/saved-jobs/:jobId
// Remove vaga salva
// ============================================
router.delete("/saved-jobs/:jobId", isAuth, async (req, res) => {
  const userId = req.session.user.id;
  const jobId  = parseInt(req.params.jobId, 10);
  try {
    await db.query(
      "DELETE FROM user_saved_jobs WHERE user_id = ? AND job_id = ?",
      [userId, jobId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;