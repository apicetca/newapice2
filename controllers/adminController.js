const db = require("../database/db");
const { computeMatch } = require("../services/matchCalculator");
const { setUserPlan, getPlanCodesBulk } = require("../services/subscriptionService");
const { plansForType } = require("../config/plans");

// Identifica o GitHub de uma conta dev, para achar outras contas da mesma
// pessoa: o login do GitHub cria uma conta pelo e-mail que o GitHub
// informa (ou <login>@users.noreply.github.com), separada de uma conta de
// e-mail e senha que a pessoa já tenha. O github_login das contas de
// e-mail é digitado pelo usuário, então isso indica "provavelmente a mesma
// pessoa" — o painel só avisa e deixa o admin decidir.
function githubKey(row) {
  const noreply = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i.exec(row.email ?? "");
  const login = row.github_login || noreply?.[1] || "";
  return login.trim().toLowerCase() || null;
}

const adminController = {
  getDashboard: async (req, res) => {
    try {
      const [[stats]] = await db.query(`
        SELECT
          (SELECT COUNT(*) FROM users WHERE type = 'dev')             AS totalDevs,
          (SELECT COUNT(*) FROM users WHERE type = 'empresa')         AS totalEmpresas,
          (SELECT COUNT(*) FROM jobs WHERE active = 1)                AS vagasAtivas,
          (SELECT COUNT(*) FROM jobs)                                 AS totalVagas,
          (SELECT COUNT(*) FROM job_applications)                     AS totalCandidaturas,
          (SELECT COUNT(*) FROM company_match_actions WHERE action = 'aceito') AS matchsAceitos
      `);

      const [devsRecentes] = await db.query(`
        SELECT u.id, u.email, u.created_at, p.nome, p.sobrenome
        FROM users u LEFT JOIN user_dev_profiles p ON p.user_id = u.id
        WHERE u.type = 'dev' ORDER BY u.created_at DESC LIMIT 5
      `);

      const [empresasRecentes] = await db.query(`
        SELECT u.id, u.email, u.created_at, p.nome_fantasia, p.razao_social
        FROM users u LEFT JOIN user_company_profiles p ON p.user_id = u.id
        WHERE u.type = 'empresa' ORDER BY u.created_at DESC LIMIT 5
      `);

      res.json({
        stats: {
          totalDevs:        Number(stats.totalDevs),
          totalEmpresas:    Number(stats.totalEmpresas),
          vagasAtivas:      Number(stats.vagasAtivas),
          totalVagas:       Number(stats.totalVagas),
          totalCandidaturas: Number(stats.totalCandidaturas),
          matchsAceitos:    Number(stats.matchsAceitos),
        },
        devsRecentes,
        empresasRecentes,
      });
    } catch (err) {
      console.error("[GET /api/admin/dashboard]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getUsers: async (req, res) => {
    try {
      const [rows] = await db.query(`
        SELECT u.id, u.email, u.active, u.created_at, (u.password_hash IS NOT NULL) AS tem_senha,
               p.nome, p.sobrenome, p.nivel, p.github_login, p.github_id
        FROM users u
        LEFT JOIN user_dev_profiles p ON p.user_id = u.id
        WHERE u.type = 'dev'
        ORDER BY u.created_at DESC
      `);
      const planCodes = await getPlanCodesBulk(rows.map(r => r.id), "dev");

      const porGithub = {};
      for (const r of rows) {
        const key = githubKey(r);
        if (key) (porGithub[key] ??= []).push(r);
      }

      res.json(rows.map(({ tem_senha, github_id, ...r }) => {
        const key = githubKey(r);
        const outras = key ? porGithub[key].filter(o => o.id !== r.id) : [];
        return {
          ...r,
          active:       Boolean(r.active),
          plan_code:    planCodes[r.id],
          login_github: github_id != null, // github_id só é gravado pelo login com GitHub
          login_email:  Boolean(tem_senha),
          outras_contas: outras.map(o => ({
            id: o.id, email: o.email, login_github: o.github_id != null, plan_code: planCodes[o.id],
          })),
        };
      }));
    } catch (err) {
      console.error("[GET /api/admin/users]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  updateUserStatus: async (req, res) => {
    const userId = Number(req.params.id);
    const { active } = req.body;
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "ID inválido." });

    try {
      const [result] = await db.query(
        "UPDATE users SET active = ? WHERE id = ? AND type = 'dev'",
        [active ? 1 : 0, userId]
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: "Desenvolvedor não encontrado." });
      res.json({ success: true });
    } catch (err) {
      console.error("[PATCH /api/admin/users/:id]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  updateUserPlan: async (req, res) => {
    const userId = Number(req.params.id);
    const { plan_code } = req.body;
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "ID inválido." });

    const validCodes = plansForType("dev").map(p => p.code);
    if (!validCodes.includes(plan_code)) {
      return res.status(400).json({ error: `Plano inválido. Use: ${validCodes.join(", ")}.` });
    }

    try {
      const [rows] = await db.query("SELECT id FROM users WHERE id = ? AND type = 'dev'", [userId]);
      if (!rows.length) return res.status(404).json({ error: "Desenvolvedor não encontrado." });

      await setUserPlan(userId, plan_code);
      res.json({ success: true });
    } catch (err) {
      console.error("[PATCH /api/admin/users/:id/plan]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getEmpresas: async (req, res) => {
    try {
      const [rows] = await db.query(`
        SELECT u.id, u.email, u.active, u.created_at,
               p.nome_fantasia, p.razao_social, p.cnpj, p.setor, p.tamanho,
               (SELECT COUNT(*) FROM jobs j WHERE j.company_id = u.id)                AS total_vagas,
               (SELECT COUNT(*) FROM jobs j WHERE j.company_id = u.id AND j.active=1) AS vagas_ativas
        FROM users u
        LEFT JOIN user_company_profiles p ON p.user_id = u.id
        WHERE u.type = 'empresa'
        ORDER BY u.created_at DESC
      `);
      const planCodes = await getPlanCodesBulk(rows.map(r => r.id), "empresa");
      res.json(rows.map(r => ({
        ...r,
        active: Boolean(r.active),
        total_vagas:  Number(r.total_vagas),
        vagas_ativas: Number(r.vagas_ativas),
        plan_code: planCodes[r.id],
      })));
    } catch (err) {
      console.error("[GET /api/admin/empresas]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  updateEmpresaStatus: async (req, res) => {
    const userId = Number(req.params.id);
    const { active } = req.body;
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "ID inválido." });

    try {
      const [result] = await db.query(
        "UPDATE users SET active = ? WHERE id = ? AND type = 'empresa'",
        [active ? 1 : 0, userId]
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: "Empresa não encontrada." });
      res.json({ success: true });
    } catch (err) {
      console.error("[PATCH /api/admin/empresas/:id]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  updateEmpresaPlan: async (req, res) => {
    const userId = Number(req.params.id);
    const { plan_code } = req.body;
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "ID inválido." });

    const validCodes = plansForType("empresa").map(p => p.code);
    if (!validCodes.includes(plan_code)) {
      return res.status(400).json({ error: `Plano inválido. Use: ${validCodes.join(", ")}.` });
    }

    try {
      const [rows] = await db.query("SELECT id FROM users WHERE id = ? AND type = 'empresa'", [userId]);
      if (!rows.length) return res.status(404).json({ error: "Empresa não encontrada." });

      await setUserPlan(userId, plan_code);
      res.json({ success: true });
    } catch (err) {
      console.error("[PATCH /api/admin/empresas/:id/plan]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getJobs: async (req, res) => {
    try {
      const [rows] = await db.query(`
        SELECT j.id, j.title, j.company, j.company_id, j.level, j.active, j.created_at,
               (SELECT COUNT(*) FROM job_applications ja WHERE ja.job_id = j.id) AS total_candidaturas
        FROM jobs j
        ORDER BY j.created_at DESC
      `);
      res.json(rows.map(r => ({ ...r, active: Boolean(r.active), total_candidaturas: Number(r.total_candidaturas) })));
    } catch (err) {
      console.error("[GET /api/admin/jobs]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  updateJobStatus: async (req, res) => {
    const jobId = Number(req.params.id);
    const { active } = req.body;
    if (!Number.isInteger(jobId) || jobId <= 0) return res.status(400).json({ error: "ID inválido." });

    try {
      const [result] = await db.query("UPDATE jobs SET active = ? WHERE id = ?", [active ? 1 : 0, jobId]);
      if (result.affectedRows === 0) return res.status(404).json({ error: "Vaga não encontrada." });
      res.json({ success: true });
    } catch (err) {
      console.error("[PATCH /api/admin/jobs/:id]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getMatches: async (req, res) => {
    try {
      const [[actionStats]] = await db.query(`
        SELECT
          SUM(action = 'aceito')   AS aceitos,
          SUM(action = 'recusado') AS recusados,
          COUNT(*)                 AS total
        FROM company_match_actions
      `);

      const [jobs] = await db.query("SELECT id, title, company, level FROM jobs WHERE active = 1");
      const [jobSkillRows] = await db.query(
        "SELECT job_id, skill_id, importance FROM job_skills"
      );
      const jobSkillMap = {};
      for (const r of jobSkillRows) {
        if (!jobSkillMap[r.job_id]) jobSkillMap[r.job_id] = [];
        jobSkillMap[r.job_id].push({ skill_id: r.skill_id, importance: r.importance });
      }

      const [devs] = await db.query(
        "SELECT user_id AS id, github_id, nome, github_login, nivel FROM user_dev_profiles WHERE github_id IS NOT NULL"
      );
      const devGithubIds = devs.map(d => d.github_id);

      let topMatches = [];
      if (devs.length && jobs.length) {
        const [skillRows] = await db.query(
          "SELECT github_id, skill_id, confidence FROM user_skills WHERE github_id IN (?)",
          [devGithubIds]
        );
        const devSkillMap = {};
        for (const s of skillRows) {
          if (!devSkillMap[s.github_id]) devSkillMap[s.github_id] = {};
          devSkillMap[s.github_id][s.skill_id] = s.confidence;
        }

        for (const dev of devs) {
          const devSkills = devSkillMap[dev.github_id] ?? {};
          for (const job of jobs) {
            const jobSkills = jobSkillMap[job.id] ?? [];
            if (!jobSkills.length) continue;
            const score = computeMatch(devSkills, jobSkills, dev.nivel, job.level);
            if (score < 70) continue;
            topMatches.push({
              dev: dev.nome, github: dev.github_login,
              job: job.title, company: job.company, score,
            });
          }
        }
        topMatches.sort((a, b) => b.score - a.score);
        topMatches = topMatches.slice(0, 20);
      }

      res.json({
        actions: {
          aceitos:   Number(actionStats.aceitos   ?? 0),
          recusados: Number(actionStats.recusados ?? 0),
          total:     Number(actionStats.total     ?? 0),
        },
        topMatches,
      });
    } catch (err) {
      console.error("[GET /api/admin/matches]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getReports: async (req, res) => {
    try {
      const [cadastrosPorSemana] = await db.query(`
        SELECT DATE_FORMAT(created_at, '%x-%v') AS semana, type, COUNT(*) AS total
        FROM users
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 8 WEEK)
        GROUP BY semana, type
        ORDER BY semana ASC
      `);

      const [skillsPopulares] = await db.query(`
        SELECT s.name, COUNT(*) AS total
        FROM user_skills us JOIN skills s ON s.id = us.skill_id
        GROUP BY s.id, s.name
        ORDER BY total DESC LIMIT 10
      `);

      const [vagasPorNivel] = await db.query(`
        SELECT level, COUNT(*) AS total FROM jobs WHERE active = 1 GROUP BY level
      `);

      const [candidaturasPorVaga] = await db.query(`
        SELECT j.id, j.title, COUNT(ja.id) AS total
        FROM jobs j LEFT JOIN job_applications ja ON ja.job_id = j.id
        WHERE j.active = 1
        GROUP BY j.id, j.title
        ORDER BY total DESC LIMIT 10
      `);

      res.json({
        cadastrosPorSemana,
        skillsPopulares: skillsPopulares.map(s => ({ ...s, total: Number(s.total) })),
        vagasPorNivel:   vagasPorNivel.map(v => ({ ...v, total: Number(v.total) })),
        candidaturasPorVaga: candidaturasPorVaga.map(c => ({ ...c, total: Number(c.total) })),
      });
    } catch (err) {
      console.error("[GET /api/admin/reports]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  // ── Configurações Gerais: catálogo de skills ──────────────
  getSkills: async (req, res) => {
    try {
      const [rows] = await db.query(`
        SELECT s.id, s.name, s.type, s.category, s.github_signals,
               (SELECT COUNT(*) FROM skill_resources r WHERE r.skill_id = s.id) AS total_resources
        FROM skills s
        ORDER BY s.type, s.category, s.name
      `);
      res.json(rows.map(r => ({ ...r, total_resources: Number(r.total_resources) })));
    } catch (err) {
      console.error("[GET /api/admin/skills]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  createSkill: async (req, res) => {
    const { name, type, category, github_signals } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Nome é obrigatório." });
    if (!["hard", "soft"].includes(type)) return res.status(400).json({ error: "Tipo inválido. Use 'hard' ou 'soft'." });

    try {
      const [result] = await db.query(
        "INSERT INTO skills (name, type, category, github_signals) VALUES (?, ?, ?, ?)",
        [name.trim(), type, category?.trim() || null, github_signals?.trim() || null]
      );
      res.status(201).json({ success: true, id: result.insertId });
    } catch (err) {
      console.error("[POST /api/admin/skills]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  updateSkill: async (req, res) => {
    const skillId = Number(req.params.id);
    if (!Number.isInteger(skillId) || skillId <= 0) return res.status(400).json({ error: "ID inválido." });

    const { name, type, category, github_signals } = req.body;
    if (type !== undefined && !["hard", "soft"].includes(type)) {
      return res.status(400).json({ error: "Tipo inválido. Use 'hard' ou 'soft'." });
    }

    const fields = [];
    const values = [];
    if (name            !== undefined) { fields.push("name = ?");            values.push(name.trim()); }
    if (type            !== undefined) { fields.push("type = ?");            values.push(type); }
    if (category         !== undefined) { fields.push("category = ?");        values.push(category?.trim() || null); }
    if (github_signals  !== undefined) { fields.push("github_signals = ?");  values.push(github_signals?.trim() || null); }
    if (!fields.length) return res.status(400).json({ error: "Nenhum campo para atualizar." });

    try {
      values.push(skillId);
      const [result] = await db.query(`UPDATE skills SET ${fields.join(", ")} WHERE id = ?`, values);
      if (result.affectedRows === 0) return res.status(404).json({ error: "Skill não encontrada." });
      res.json({ success: true });
    } catch (err) {
      console.error("[PATCH /api/admin/skills/:id]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  deleteSkill: async (req, res) => {
    const skillId = Number(req.params.id);
    if (!Number.isInteger(skillId) || skillId <= 0) return res.status(400).json({ error: "ID inválido." });

    try {
      const [result] = await db.query("DELETE FROM skills WHERE id = ?", [skillId]);
      if (result.affectedRows === 0) return res.status(404).json({ error: "Skill não encontrada." });
      res.json({ success: true });
    } catch (err) {
      console.error("[DELETE /api/admin/skills/:id]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getSkillResources: async (req, res) => {
    const skillId = Number(req.params.id);
    if (!Number.isInteger(skillId) || skillId <= 0) return res.status(400).json({ error: "ID inválido." });

    try {
      const [rows] = await db.query(
        "SELECT id, type, title, url, is_free, duration FROM skill_resources WHERE skill_id = ? ORDER BY type",
        [skillId]
      );
      res.json(rows.map(r => ({ ...r, is_free: Boolean(r.is_free) })));
    } catch (err) {
      console.error("[GET /api/admin/skills/:id/resources]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  addSkillResource: async (req, res) => {
    const skillId = Number(req.params.id);
    if (!Number.isInteger(skillId) || skillId <= 0) return res.status(400).json({ error: "ID inválido." });

    const { type, title, url, is_free, duration } = req.body;
    const validTypes = ["curso", "video", "documentacao", "projeto"];
    if (!validTypes.includes(type)) return res.status(400).json({ error: `Tipo inválido. Use: ${validTypes.join(", ")}.` });
    if (!title?.trim()) return res.status(400).json({ error: "Título é obrigatório." });

    try {
      const [result] = await db.query(
        "INSERT INTO skill_resources (skill_id, type, title, url, is_free, duration) VALUES (?, ?, ?, ?, ?, ?)",
        [skillId, type, title.trim(), url?.trim() || null, is_free !== false ? 1 : 0, duration?.trim() || null]
      );
      res.status(201).json({ success: true, id: result.insertId });
    } catch (err) {
      console.error("[POST /api/admin/skills/:id/resources]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  deleteSkillResource: async (req, res) => {
    const resourceId = Number(req.params.resourceId);
    if (!Number.isInteger(resourceId) || resourceId <= 0) return res.status(400).json({ error: "ID inválido." });

    try {
      const [result] = await db.query("DELETE FROM skill_resources WHERE id = ? AND skill_id = ?", [resourceId, req.params.id]);
      if (result.affectedRows === 0) return res.status(404).json({ error: "Recurso não encontrado." });
      res.json({ success: true });
    } catch (err) {
      console.error("[DELETE /api/admin/skills/:id/resources/:resourceId]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },
};

module.exports = adminController;
