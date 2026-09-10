const db = require("../database/db");

const { generateRoadmap }   = require("../services/roadmapGenerator");
const { calculateJobMatch } = require("../services/matchCalculator");
const { hasFeature }        = require("../services/subscriptionService");

// GitHub users têm github_id; email-only users usam o id interno.
function getUserId(req) {
  return req.session.user.github_id ?? req.session.user.id;
}

const roadmapController = {
  listJobs: async (req, res) => {
    try {
      const page     = Math.max(1, parseInt(req.query.page)     || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 50));
      const offset   = (page - 1) * pageSize;
      const [[{ total }]] = await db.query("SELECT COUNT(*) AS total FROM jobs WHERE active = 1");
      const [jobs] = await Promise.race([
        db.query("SELECT id, title, company, description, level FROM jobs WHERE active = 1 ORDER BY id LIMIT ? OFFSET ?", [pageSize, offset]),
        new Promise((_, reject) => setTimeout(() => reject(new Error("DB timeout")), 8000)),
      ]);
      res.json({ data: jobs, total, page, pageSize, pages: Math.ceil(total / pageSize) });
    } catch (err) {
      console.error("[GET /api/jobs]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  listJobsWithDetails: async (req, res) => {
    try {
      const page     = Math.max(1, parseInt(req.query.page)     || 1);
      const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize) || 500));
      const offset   = (page - 1) * pageSize;
      const [[{ total }]] = await db.query("SELECT COUNT(*) AS total FROM jobs WHERE active = 1");
      const [jobs] = await db.query(
        "SELECT id, title, company, description, level FROM jobs WHERE active = 1 ORDER BY id LIMIT ? OFFSET ?",
        [pageSize, offset]
      );

      const [jobSkills] = await db.query(`
        SELECT js.job_id, js.importance, s.id AS skill_id, s.name, s.type, s.category
        FROM job_skills js
        JOIN skills s ON s.id = js.skill_id
        ORDER BY js.job_id, js.importance DESC, js.learn_order
      `);

      const skillsByJob = {};
      for (const row of jobSkills) {
        if (!skillsByJob[row.job_id]) skillsByJob[row.job_id] = [];
        skillsByJob[row.job_id].push({
          id:         row.skill_id,
          name:       row.name,
          type:       row.type,
          category:   row.category,
          importance: row.importance,
        });
      }

      res.json({ data: jobs.map(job => ({ ...job, skills: skillsByJob[job.id] ?? [] })), total, page, pageSize, pages: Math.ceil(total / pageSize) });
    } catch (err) {
      console.error("[GET /api/jobs/details]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getRoadmap: async (req, res) => {
    try {
      const githubId = req.session.user.github_id;
      if (!githubId) {
        return res.status(400).json({ error: "Conecte seu GitHub para acessar o roadmap." });
      }
      const unlocked = await hasFeature(req.session.user.id, "roadmap_personalizado");
      const roadmap = await generateRoadmap(githubId, req.params.jobId, { unlocked });
      res.json(roadmap);
    } catch (err) {
      console.error("[GET /api/roadmap/:jobId]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  updateSkillStatus: async (req, res) => {
    const { status } = req.body;
    const validStatus = ["nao_iniciado", "em_progresso", "concluido"];

    if (!validStatus.includes(status)) {
      return res.status(400).json({ error: "Status inválido" });
    }

    try {
      const userId = getUserId(req);
      await db.query(`
        INSERT INTO user_roadmap_progress (github_id, job_id, skill_id, status, completed_at)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          status       = VALUES(status),
          completed_at = VALUES(completed_at)
      `, [
        userId,
        req.params.jobId,
        req.params.skillId,
        status,
        status === "concluido" ? new Date() : null,
      ]);

      const match = await calculateJobMatch(userId, req.params.jobId);
      res.json({ success: true, newMatch: match.match });
    } catch (err) {
      console.error("[PATCH /api/roadmap/:jobId/skills/:skillId]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getPublicJob: async (req, res) => {
    const jobId = req.params.id;
    try {
      const [jobs] = await db.query("SELECT * FROM jobs WHERE id = ?", [jobId]);
      if (!jobs.length) return res.status(404).json({ error: "Vaga não encontrada." });
      const job = jobs[0];

      const [jobSkills] = await db.query(`
        SELECT js.skill_id, js.importance, js.learn_order, s.name, s.type, s.category
        FROM job_skills js JOIN skills s ON s.id = js.skill_id
        WHERE js.job_id = ? ORDER BY js.importance DESC, js.learn_order
      `, [jobId]);

      let match   = null;
      let applied = false;
      if (req.session?.user) {
        const uid = getUserId(req);
        const profileData = {
          nivel:    req.session.user.nivel,
          jobLevel: job.level,
        };
        match = await calculateJobMatch(uid, jobId, profileData);

        const [appliedRows] = await db.query(
          "SELECT id FROM job_applications WHERE job_id = ? AND dev_github_id = ?",
          [jobId, uid]
        );
        applied = appliedRows.length > 0;
      }

      res.json({ ...job, skills: jobSkills, match, applied });
    } catch (err) {
      console.error("[GET /api/jobs/:id]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  applyToJob: async (req, res) => {
    const jobId = req.params.id;
    try {
      if (req.session.user.type !== "dev") {
        return res.status(403).json({ error: "Apenas desenvolvedores podem se candidatar." });
      }

      const [jobs] = await db.query("SELECT id FROM jobs WHERE id = ? AND active = 1", [jobId]);
      if (!jobs.length) return res.status(404).json({ error: "Vaga não encontrada." });

      const userId = getUserId(req);
      await db.query(
        "INSERT IGNORE INTO job_applications (job_id, dev_github_id) VALUES (?, ?)",
        [jobId, userId]
      );

      res.json({ success: true, applied: true });
    } catch (err) {
      console.error("[POST /api/vagas/:id/candidatar]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  // Distribuição de linguagens do perfil, calculada a partir dos
  // repositórios importados (user_repositories.language) — % de repos
  // que usam cada linguagem, igual ao gráfico de linguagens do GitHub.
  getLanguageDistribution: async (req, res) => {
    try {
      const userId = req.session.user.id;
      const [rows] = await db.query(`
        SELECT language, COUNT(*) AS total
        FROM user_repositories
        WHERE user_id = ? AND language IS NOT NULL AND language != ''
        GROUP BY language
        ORDER BY total DESC
      `, [userId]);

      const totalRepos = rows.reduce((sum, r) => sum + r.total, 0);
      const languages = rows.map(r => ({
        language: r.language,
        count: r.total,
        percent: totalRepos > 0 ? Math.round((r.total / totalRepos) * 100) : 0,
      }));

      res.json({ totalRepos, languages });
    } catch (err) {
      console.error("[GET /api/user/languages]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getDashboard: async (req, res) => {
    try {
      const userId = getUserId(req);
      const [rows] = await db.query(`
        SELECT
          j.id,
          j.title,
          j.company,
          j.level,
          COUNT(DISTINCT js.skill_id)                                               AS total_skills,
          SUM(urp.status = 'concluido')                                             AS concluded,
          SUM(urp.status = 'em_progresso')                                          AS in_progress,
          ROUND(SUM(urp.status = 'concluido') / COUNT(DISTINCT js.skill_id) * 100) AS progress_percent
        FROM jobs j
        JOIN job_skills js ON js.job_id = j.id
        LEFT JOIN user_roadmap_progress urp
          ON urp.job_id    = j.id
          AND urp.skill_id = js.skill_id
          AND urp.github_id = ?
        GROUP BY j.id
        HAVING COUNT(urp.github_id) > 0
        ORDER BY progress_percent DESC, j.id
      `, [userId]);

      res.json(rows);
    } catch (err) {
      console.error("[GET /api/user/dashboard]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },
};

module.exports = roadmapController;
