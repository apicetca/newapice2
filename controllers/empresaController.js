const db = require("../database/db");
const { computeMatch } = require("../services/matchCalculator");
const { canCreateJob, getUserPlan, getPlanCodesBulk } = require("../services/subscriptionService");
const { getOrGenerateSummary } = require("../services/candidateSummarizer");
const { inferirAreaPorHabilidades } = require("../services/areaDaVaga");
const { plansForType } = require("../config/plans");
const { statusHttpDaIA, resumoDoErro } = require("../services/iaErros");

const NIVEL_MAP = { iniciante: "estagio", intermediario: "junior", avancado: "pleno" };

// Conta quantas skills da vaga o dev já possui (sem calcular o % —
// isso é só para exibir "3 de 5 skills"). O % de match em si vem de
// computeMatch(), a mesma função usada na visão do dev, para que o
// score nunca divirja entre as duas telas.
function countSkillsMatch(devSkills, jobSkills) {
  let skillsMatch = 0;
  for (const js of jobSkills) {
    if ((devSkills[js.skill_id] ?? 0) > 0) skillsMatch++;
  }
  return { skillsMatch, totalSkills: jobSkills.length };
}

// Configurações da empresa: valores aceitos nos campos de seleção.
const MODELOS_TRABALHO = ["remoto", "hibrido", "presencial"];
const MATURIDADES      = ["startup", "crescimento", "consolidada"];
const EMAIL_VALIDO     = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mesmo corte de "pronto para a vaga" (readyFor) do matchCalculator.
const ALTA_COMPATIBILIDADE = 70;

// Categoria de vaga existe e está ativa (Admin → Configurações → Categorias e vagas).
async function categoriaValida(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return false;
  const [rows] = await db.query("SELECT id FROM job_categories WHERE id = ? AND active = 1", [n]);
  return rows.length > 0;
}

// Blocos auxiliares do dashboard: se um falhar, o painel segue sem ele.
async function seguro(fn, fallback, rotulo) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[GET /api/empresa/dashboard] ${rotulo}:`, err.message);
    return fallback;
  }
}

// Área de cada vaga, inferida pelas skills dela (vaga sem skills fica de fora).
// Devolve { [jobId]: "front-end" | "back-end" | "full-stack" | "dados" }.
async function areasInferidasDasVagas(jobIds) {
  if (!jobIds.length) return {};
  const [rows] = await db.query(
    `SELECT js.job_id, s.name AS habilidade
     FROM job_skills js JOIN skills s ON s.id = js.skill_id
     WHERE js.job_id IN (?)`,
    [jobIds]
  );
  const habilidades = {};
  for (const r of rows) (habilidades[r.job_id] ??= []).push(r.habilidade);
  return Object.fromEntries(
    Object.entries(habilidades).map(([id, lista]) => [id, inferirAreaPorHabilidades(lista)])
  );
}

const CANDIDATOS_POR_VAGA = 12; // tamanho do carrossel de cada vaga
const MATCHES_DESTAQUE   = 6;  // "Matches" em destaque na página de matchs
const MATCHES_POR_VAGA   = 12; // devs mostrados por vaga em "Matches vagas"

// Matches (dev × vaga ativa da empresa), do melhor para o pior score — base
// de GET /api/empresa/matchs e dos "Matches Destaque" do dashboard.
async function listarMatchs(companyId) {
  const [jobs] = await db.query(
    "SELECT id, title, level FROM jobs WHERE company_id = ? AND active = 1",
    [companyId]
  );
  if (!jobs.length) return [];

  const jobIds = jobs.map(j => j.id);

  const [jobSkillRows] = await db.query(
    "SELECT job_id, skill_id, importance FROM job_skills WHERE job_id IN (?)",
    [jobIds]
  );
  const jobSkillMap = {};
  for (const r of jobSkillRows) {
    if (!jobSkillMap[r.job_id]) jobSkillMap[r.job_id] = [];
    jobSkillMap[r.job_id].push({ skill_id: r.skill_id, importance: r.importance });
  }

  const [devs] = await db.query(
    "SELECT user_id AS id, github_id, nome, github_login, nivel FROM user_dev_profiles WHERE github_id IS NOT NULL"
  );
  if (!devs.length) return [];

  const devGithubIds = devs.map(d => d.github_id);

  const [skillRows] = await db.query(
    "SELECT github_id, skill_id, confidence FROM user_skills WHERE github_id IN (?)",
    [devGithubIds]
  );
  const devSkillMap = {};
  for (const s of skillRows) {
    if (!devSkillMap[s.github_id]) devSkillMap[s.github_id] = {};
    devSkillMap[s.github_id][s.skill_id] = s.confidence;
  }

  const [actions] = await db.query(
    "SELECT dev_github_id, job_id, action FROM company_match_actions WHERE company_id = ?",
    [companyId]
  );
  const actionMap = {};
  for (const a of actions) actionMap[`${a.dev_github_id}-${a.job_id}`] = a.action;

  const matchs = [];
  for (const dev of devs) {
    const devSkills = devSkillMap[dev.github_id] ?? {};
    for (const job of jobs) {
      const jobSkills = jobSkillMap[job.id] ?? [];
      if (!jobSkills.length) continue;
      const { skillsMatch, totalSkills } = countSkillsMatch(devSkills, jobSkills);
      if (skillsMatch === 0) continue;
      const score = computeMatch(devSkills, jobSkills, dev.nivel, job.level);
      const key = `${dev.github_id}-${job.id}`;
      matchs.push({
        id:           key,
        dev_id:       dev.id,
        dev_github_id: dev.github_id,
        dev:          dev.nome,
        github:       dev.github_login,
        level:        NIVEL_MAP[dev.nivel] ?? "estagio",
        job_id:       job.id,
        job:          job.title,
        score,
        skills_match: skillsMatch,
        total_skills: totalSkills,
        status:       actionMap[key] ?? "novo",
      });
    }
  }

  matchs.sort((a, b) => b.score - a.score);
  return matchs;
}

// Plano pago que a empresa gratuita pode assinar (vem de config/plans.js); null se já é pago.
function planoDeUpgrade(planoAtual) {
  if (planoAtual.price_cents > 0) return null;
  const pago = plansForType("empresa").find(p => p.price_cents > 0);
  return pago
    ? { code: pago.code, name: pago.name, price_cents: pago.price_cents, benefits: pago.benefits ?? [] }
    : null;
}

const empresaController = {
  // Vagas ATIVAS da empresa com a contagem de conversas (empresa <-> candidato)
  // de cada uma — alimenta a página "Chats de vagas" (/empresa/mensagens/vagas).
  getJobChats: async (req, res) => {
    try {
      const [rows] = await db.query(`
        SELECT
          j.id, j.title, j.active, j.created_at,
          (SELECT COUNT(*) FROM conversations c
            WHERE c.job_id = j.id AND c.company_id = j.company_id) AS total_conversas
        FROM jobs j
        WHERE j.company_id = ? AND j.active = 1
        ORDER BY j.created_at DESC
      `, [req.session.user.id]);

      res.json(rows.map(j => ({
        id:              j.id,
        title:           j.title,
        active:          Boolean(j.active),
        created_at:      j.created_at,
        total_conversas: Number(j.total_conversas ?? 0),
      })));
    } catch (err) {
      console.error("[GET /api/empresa/jobs/chats]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  // Página "Desenvolvedores" > aba "Dev em Vagas": cada vaga da empresa com os
  // candidatos (quem se candidatou), ordenados por compatibilidade.
  getJobsComCandidatos: async (req, res) => {
    const companyId = req.session.user.id;

    try {
      const [jobs] = await db.query(`
        SELECT
          j.id, j.title, j.level, j.active, j.area, j.created_at,
          (SELECT COUNT(*) FROM job_applications ja WHERE ja.job_id = j.id) AS total_candidaturas,
          (SELECT COUNT(DISTINCT udp.user_id)
             FROM job_skills js2
             JOIN user_skills us ON us.skill_id = js2.skill_id AND us.confidence > 0
             JOIN user_dev_profiles udp ON udp.github_id = us.github_id
            WHERE js2.job_id = j.id) AS total_matches
        FROM jobs j
        WHERE j.company_id = ?
        ORDER BY j.active DESC, j.created_at DESC
      `, [companyId]);

      if (!jobs.length) return res.json([]);
      const jobIds = jobs.map(j => j.id);

      const areaPorVaga = await seguro(() => areasInferidasDasVagas(jobIds), {}, "áreas");

      const [jobSkillRows] = await db.query(
        "SELECT job_id, skill_id, importance FROM job_skills WHERE job_id IN (?)",
        [jobIds]
      );
      const jobSkillMap = {};
      for (const r of jobSkillRows) {
        (jobSkillMap[r.job_id] ??= []).push({ skill_id: r.skill_id, importance: r.importance });
      }

      const [applications] = await db.query(`
        SELECT ja.job_id, ja.dev_github_id, ja.created_at,
               udp.user_id AS dev_id, udp.nome, udp.sobrenome, udp.github_login, udp.nivel
        FROM job_applications ja
        JOIN user_dev_profiles udp ON udp.github_id = ja.dev_github_id
        WHERE ja.job_id IN (?)
        ORDER BY ja.created_at DESC
      `, [jobIds]);

      const githubIds = [...new Set(applications.map(a => a.dev_github_id))];
      const skillsDoDev = {}; // github_id → { skill_id: { name, confidence } }
      let planCodes = {};
      let acaoPorChave = {};

      if (githubIds.length) {
        const [skillRows] = await db.query(`
          SELECT us.github_id, us.skill_id, us.confidence, s.name
          FROM user_skills us JOIN skills s ON s.id = us.skill_id
          WHERE us.github_id IN (?)
        `, [githubIds]);
        for (const r of skillRows) {
          (skillsDoDev[r.github_id] ??= {})[r.skill_id] = { name: r.name, confidence: r.confidence };
        }

        const [actions] = await db.query(
          "SELECT dev_github_id, job_id, action FROM company_match_actions WHERE company_id = ?",
          [companyId]
        );
        for (const a of actions) acaoPorChave[`${a.dev_github_id}-${a.job_id}`] = a.action;

        planCodes = await getPlanCodesBulk([...new Set(applications.map(a => a.dev_id))], "dev");
      }

      const candidatosPorVaga = {};
      for (const a of applications) {
        const job = jobs.find(j => j.id === a.job_id);
        if (!job) continue;

        const meusSkills = skillsDoDev[a.dev_github_id] ?? {};
        const confiancas = Object.fromEntries(Object.entries(meusSkills).map(([id, v]) => [id, v.confidence]));
        const pedidas    = new Set((jobSkillMap[a.job_id] ?? []).map(s => s.skill_id));

        // Skills que a vaga pede primeiro; dentro de cada grupo, as de maior confiança.
        const ordenadas = Object.entries(meusSkills)
          .map(([id, v]) => ({ id: Number(id), name: v.name, confidence: v.confidence }))
          .sort((x, y) => (pedidas.has(y.id) - pedidas.has(x.id)) || (y.confidence - x.confidence));

        const acao = acaoPorChave[`${a.dev_github_id}-${a.job_id}`];

        (candidatosPorVaga[a.job_id] ??= []).push({
          id:           a.dev_id,
          name:         [a.nome, a.sobrenome].filter(Boolean).join(" "),
          github:       a.github_login,
          level:        NIVEL_MAP[a.nivel] ?? "estagio",
          isPro:        planCodes[a.dev_id] === "dev_pro",
          skills:       ordenadas.slice(0, 4).map(s => s.name),
          skills_extra: Math.max(0, ordenadas.length - 4),
          score:        computeMatch(confiancas, jobSkillMap[a.job_id] ?? [], a.nivel, job.level),
          match_status: acao === "aceito" ? "realizado" : acao === "recusado" ? "recusado" : "nao_realizado",
          applied_at:   a.created_at,
        });
      }

      res.json(jobs.map(j => ({
        id:                 j.id,
        title:              j.title,
        level:              j.level,
        active:             Boolean(j.active),
        area:               j.area ?? areaPorVaga[j.id] ?? null,
        created_at:         j.created_at,
        total_candidaturas: Number(j.total_candidaturas ?? 0),
        total_matches:      Number(j.total_matches ?? 0),
        candidatos: (candidatosPorVaga[j.id] ?? [])
          .sort((x, y) => y.score - x.score)
          .slice(0, CANDIDATOS_POR_VAGA),
      })));
    } catch (err) {
      console.error("[GET /api/empresa/jobs/candidatos]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getDashboard: async (req, res) => {
    const companyId = req.session.user.id;

    try {
      const [profileRows] = await db.query(
        "SELECT * FROM user_company_profiles WHERE user_id = ?",
        [companyId]
      );
      const profile = profileRows[0] ?? null;

      const [jobs] = await db.query(`
        SELECT
          j.id,
          j.title,
          j.level,
          j.description,
          j.active,
          j.area,
          j.created_at,
          COUNT(DISTINCT js.skill_id)                           AS total_skills,
          COUNT(DISTINCT urp.github_id)                         AS total_candidatos,
          SUM(urp.status = 'concluido') / COUNT(DISTINCT CASE WHEN urp.github_id IS NOT NULL THEN js.skill_id END) * 100 AS avg_progress,
          (SELECT COUNT(*) FROM job_applications ja WHERE ja.job_id = j.id) AS total_candidaturas,
          (SELECT COUNT(DISTINCT udp.user_id)
             FROM job_skills js2
             JOIN user_skills us ON us.skill_id = js2.skill_id AND us.confidence > 0
             JOIN user_dev_profiles udp ON udp.github_id = us.github_id
            WHERE js2.job_id = j.id)                            AS total_matches
        FROM jobs j
        LEFT JOIN job_skills js         ON js.job_id = j.id
        LEFT JOIN user_roadmap_progress urp ON urp.job_id = j.id
        WHERE j.company_id = ?
        GROUP BY j.id
        ORDER BY j.created_at DESC
      `, [companyId]);

      const totalVagas      = jobs.length;
      const vagasAtivas     = jobs.filter(j => j.active).length;
      const totalCandidatos = jobs.reduce((acc, j) => acc + Number(j.total_candidatos ?? 0), 0);
      const totalSkills     = jobs.reduce((acc, j) => acc + Number(j.total_skills ?? 0), 0);

      // Área da vaga: inferida pelas skills (vaga sem skills fica sem área).
      const areaPorVaga = await seguro(() => areasInferidasDasVagas(jobs.map(j => j.id)), {}, "áreas");

      const conversasAbertas = await seguro(async () => {
        const [[{ total }]] = await db.query(
          "SELECT COUNT(*) AS total FROM conversations WHERE company_id = ?",
          [companyId]
        );
        return Number(total ?? 0);
      }, 0, "conversas");

      const matchs = await seguro(() => listarMatchs(companyId), [], "matches");
      const matchesAltos = matchs.filter(m => m.score >= ALTA_COMPATIBILIDADE).length;

      // Matches Destaque: o melhor match de cada dev, do maior para o menor.
      const jaListados = new Set();
      const matchesDestaque = [];
      for (const m of matchs) {
        if (jaListados.has(m.dev_id)) continue;
        jaListados.add(m.dev_id);
        matchesDestaque.push({
          dev_id: m.dev_id, dev: m.dev, github: m.github, level: m.level,
          job_id: m.job_id, job: m.job, score: m.score,
          skills_match: m.skills_match, total_skills: m.total_skills,
        });
        if (matchesDestaque.length === 5) break;
      }

      // Devs cujo perfil esta empresa abriu por último (company_dev_views).
      const devsRecentes = await seguro(async () => {
        const [rows] = await db.query(
          `SELECT udp.user_id AS id, udp.nome, udp.sobrenome, udp.github_login, udp.nivel, udp.avatar_url, v.viewed_at
           FROM company_dev_views v
           JOIN user_dev_profiles udp ON udp.user_id = v.dev_user_id
           WHERE v.company_id = ?
           ORDER BY v.viewed_at DESC
           LIMIT 6`,
          [companyId]
        );
        const planCodes = rows.length ? await getPlanCodesBulk(rows.map(r => r.id), "dev") : {};
        return rows.map(r => ({
          id:         r.id,
          name:       [r.nome, r.sobrenome].filter(Boolean).join(" "),
          github:     r.github_login,
          level:      NIVEL_MAP[r.nivel] ?? "estagio",
          avatar_url: r.avatar_url ?? null,
          isPro:      planCodes[r.id] === "dev_pro",
          viewed_at:  r.viewed_at,
        }));
      }, [], "devs recentes");

      res.json({
        profile,
        jobs: jobs.map(j => ({
          ...j,
          active:             Boolean(j.active),
          area:               j.area ?? areaPorVaga[j.id] ?? null, // a escolhida no formulário vence a inferida pelas skills
          total_skills:       Number(j.total_skills       ?? 0),
          total_candidatos:   Number(j.total_candidatos   ?? 0),
          total_candidaturas: Number(j.total_candidaturas ?? 0),
          total_matches:      Number(j.total_matches      ?? 0),
          avg_progress:       Math.round(Number(j.avg_progress ?? 0)),
        })),
        stats: { totalVagas, vagasAtivas, totalCandidatos, totalSkills, conversasAbertas, matchesAltos },
        matchesDestaque,
        devsRecentes,
      });
    } catch (err) {
      console.error("[GET /api/empresa/dashboard]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  createJob: async (req, res) => {
    const {
      title, level, description, modality, contract_type,
      salary_min, salary_max, location, years_experience,
      english_level, responsibilities, benefits, max_candidates,
      tags, active, area, foreign_language, foreign_level, category_id,
    } = req.body;
    const companyId = req.session.user.id;

    if (!title?.trim()) return res.status(400).json({ error: "Título é obrigatório." });
    if (!["estagio","junior","pleno"].includes(level))
      return res.status(400).json({ error: "Nível inválido." });

    try {
      if (category_id && !(await categoriaValida(category_id))) {
        return res.status(400).json({ error: "Categoria inválida ou desativada." });
      }

      const willBeActive = active !== undefined ? Boolean(active) : true;
      if (willBeActive && !(await canCreateJob(companyId))) {
        const plan = await getUserPlan(companyId, "empresa");
        return res.status(402).json({
          error: `Seu plano (${plan.name}) permite até ${plan.max_active_jobs} vaga(s) ativa(s) simultaneamente. Desative outra vaga ou faça upgrade para publicar mais.`,
        });
      }

      const [profileRows] = await db.query(
        "SELECT nome_fantasia, razao_social FROM user_company_profiles WHERE user_id = ?",
        [companyId]
      );
      const companyName = profileRows[0]?.nome_fantasia ?? profileRows[0]?.razao_social ?? "Empresa";

      const [result] = await db.query(`
        INSERT INTO jobs
          (title, company, company_id, description, level, modality, contract_type,
           salary_min, salary_max, location, years_experience, english_level,
           responsibilities, benefits, max_candidates, tags, active,
           area, foreign_language, foreign_level, category_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        title.trim(), companyName, companyId,
        description   || null,
        level,
        modality      || "remoto",
        contract_type || "estagio",
        salary_min    ? Number(salary_min)    : null,
        salary_max    ? Number(salary_max)    : null,
        location      || null,
        years_experience ? Number(years_experience) : 0,
        english_level || "nenhum",
        responsibilities || null,
        benefits         || null,
        max_candidates   ? Number(max_candidates) : 100,
        tags             || null,
        active !== undefined ? (active ? 1 : 0) : 1,
        area             || null,
        foreign_language || null,
        foreign_level    || null,
        category_id ? Number(category_id) : null,
      ]);
      res.status(201).json({ success: true, id: result.insertId });
    } catch (err) {
      console.error("[POST /api/empresa/jobs]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  updateJob: async (req, res) => {
    const companyId = req.session.user.id;
    const jobId     = req.params.id;

    try {
      const [rows] = await db.query(
        "SELECT id, active, category_id FROM jobs WHERE id = ? AND company_id = ?",
        [jobId, companyId]
      );
      if (!rows.length) return res.status(404).json({ error: "Vaga não encontrada." });

      // Manter a categoria atual é sempre permitido (mesmo desativada); trocar exige uma ativa.
      const novaCategoria = req.body.category_id;
      if (novaCategoria && Number(novaCategoria) !== rows[0].category_id && !(await categoriaValida(novaCategoria))) {
        return res.status(400).json({ error: "Categoria inválida ou desativada." });
      }

      const reactivating = req.body.active === true && !rows[0].active;
      if (reactivating && !(await canCreateJob(companyId))) {
        const plan = await getUserPlan(companyId, "empresa");
        return res.status(402).json({
          error: `Seu plano (${plan.name}) permite até ${plan.max_active_jobs} vaga(s) ativa(s) simultaneamente. Desative outra vaga ou faça upgrade para reativar esta.`,
        });
      }

      const allowed = [
        "title","level","description","modality","contract_type",
        "salary_min","salary_max","location","years_experience",
        "english_level","responsibilities","benefits","max_candidates",
        "tags","active","area","foreign_language","foreign_level","category_id",
      ];

      const updates = [];
      const values  = [];

      for (const field of allowed) {
        if (req.body[field] !== undefined) {
          updates.push(`${field} = ?`);
          if (field === "active") {
            values.push(req.body[field] ? 1 : 0);
            // registra quando a vaga saiu do ar (relatório "Desempenho das vagas")
            updates.push(req.body[field] ? "closed_at = NULL" : "closed_at = COALESCE(closed_at, NOW())");
          } else if (field === "category_id") {
            values.push(req.body[field] ? Number(req.body[field]) : null);
          } else values.push(req.body[field] ?? null);
        }
      }

      if (!updates.length) return res.status(400).json({ error: "Nenhum campo para atualizar." });

      await db.query(
        `UPDATE jobs SET ${updates.join(", ")} WHERE id = ?`,
        [...values, jobId]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("[PATCH /api/empresa/jobs/:id]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  deleteJob: async (req, res) => {
    const companyId = req.session.user.id;
    const jobId     = req.params.id;

    try {
      const [rows] = await db.query(
        "SELECT id FROM jobs WHERE id = ? AND company_id = ?",
        [jobId, companyId]
      );
      if (!rows.length) return res.status(404).json({ error: "Vaga não encontrada." });

      await db.query("DELETE FROM jobs WHERE id = ?", [jobId]);
      res.json({ success: true });
    } catch (err) {
      console.error("[DELETE /api/empresa/jobs/:id]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getSkills: async (req, res) => {
    try {
      const [skills] = await db.query(
        "SELECT id, name, type, category FROM skills ORDER BY type, category, name"
      );
      res.json(skills);
    } catch (err) {
      console.error("[GET /api/empresa/skills]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getJobSkills: async (req, res) => {
    const companyId = req.session.user.id;
    const jobId     = req.params.id;
    try {
      const [rows] = await db.query(
        "SELECT id FROM jobs WHERE id = ? AND company_id = ?",
        [jobId, companyId]
      );
      if (!rows.length) return res.status(404).json({ error: "Vaga não encontrada." });

      const [skills] = await db.query(
        "SELECT skill_id, importance, learn_order FROM job_skills WHERE job_id = ? ORDER BY learn_order",
        [jobId]
      );
      res.json(skills);
    } catch (err) {
      console.error("[GET /api/empresa/jobs/:id/skills]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  updateJobSkills: async (req, res) => {
    const companyId = req.session.user.id;
    const jobId     = req.params.id;
    const { skills } = req.body;

    try {
      const [rows] = await db.query(
        "SELECT id FROM jobs WHERE id = ? AND company_id = ?",
        [jobId, companyId]
      );
      if (!rows.length) return res.status(404).json({ error: "Vaga não encontrada." });

      await db.query("DELETE FROM job_skills WHERE job_id = ?", [jobId]);

      if (Array.isArray(skills) && skills.length > 0) {
        const values = skills.map((s, i) => [jobId, s.skill_id, s.importance, i + 1]);
        await db.query(
          "INSERT INTO job_skills (job_id, skill_id, importance, learn_order) VALUES ?",
          [values]
        );
      }

      res.json({ success: true });
    } catch (err) {
      console.error("[PUT /api/empresa/jobs/:id/skills]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getMatchs: async (req, res) => {
    try {
      res.json(await listarMatchs(req.session.user.id));
    } catch (err) {
      console.error("[GET /api/empresa/matchs]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  // Página de Matchs: estatísticas, "Matches" em destaque e "Matches vagas" (por vaga
  // ativa). Match de candidatura = o dev se candidatou à vaga; orgânico = não se candidatou.
  // Matches já recusados pela empresa não entram.
  getPainelMatchs: async (req, res) => {
    const companyId = req.session.user.id;
    try {
      const [jobs] = await db.query(`
        SELECT j.id, j.title, j.active, j.area, j.created_at,
               (SELECT COUNT(*) FROM job_applications ja WHERE ja.job_id = j.id) AS total_candidaturas
        FROM jobs j
        WHERE j.company_id = ? AND j.active = 1
        ORDER BY j.created_at DESC
      `, [companyId]);

      if (!jobs.length) {
        return res.json({ stats: { total: 0, candidaturas: 0, organicos: 0 }, destaque: [], vagas: [] });
      }

      const matchs = (await listarMatchs(companyId)).filter(m => m.status !== "recusado");

      const [aplicacoes] = await db.query(
        "SELECT job_id, dev_github_id FROM job_applications WHERE job_id IN (?)",
        [jobs.map(j => j.id)]
      );
      const candidatou = new Set(aplicacoes.map(a => `${a.dev_github_id}-${a.job_id}`));
      const areaPorVaga = await seguro(() => areasInferidasDasVagas(jobs.map(j => j.id)), {}, "áreas dos matches");

      const porVaga = {};
      for (const m of matchs) (porVaga[m.job_id] ??= []).push(m);

      const destaque = matchs.slice(0, MATCHES_DESTAQUE);
      const gruposMostrados = jobs.map(j => (porVaga[j.id] ?? []).slice(0, MATCHES_POR_VAGA));
      const devsMostrados = [...new Set([...destaque, ...gruposMostrados.flat()].map(m => m.dev_id))];
      const planCodes = devsMostrados.length ? await getPlanCodesBulk(devsMostrados, "dev") : {};

      const par = (m) => ({
        dev_id:        m.dev_id,
        dev_github_id: m.dev_github_id,
        dev:           m.dev,
        github:        m.github,
        level:         m.level,
        isPro:         planCodes[m.dev_id] === "dev_pro",
        job_id:        m.job_id,
        job:           m.job,
        score:         m.score,
        status:        m.status,
        candidatou:    candidatou.has(`${m.dev_github_id}-${m.job_id}`),
      });

      const totalCandidaturas = matchs.filter(m => candidatou.has(`${m.dev_github_id}-${m.job_id}`)).length;

      res.json({
        stats: {
          total:        matchs.length,
          candidaturas: totalCandidaturas,
          organicos:    matchs.length - totalCandidaturas,
        },
        destaque: destaque.map(par),
        vagas: jobs.map((j, i) => ({
          id:                 j.id,
          title:              j.title,
          active:             Boolean(j.active),
          area:               j.area ?? areaPorVaga[j.id] ?? null,
          created_at:         j.created_at,
          total_candidaturas: Number(j.total_candidaturas ?? 0),
          total_matches:      (porVaga[j.id] ?? []).length,
          matches:            gruposMostrados[i].map(par),
        })),
      });
    } catch (err) {
      console.error("[GET /api/empresa/matchs/painel]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  updateMatchAction: async (req, res) => {
    const companyId    = req.session.user.id;
    const devGithubId  = Number(req.params.devGithubId);
    const jobId        = Number(req.params.jobId);
    const { action }   = req.body;

    if (!["aceito", "recusado"].includes(action))
      return res.status(400).json({ error: "Ação inválida." });
    if (!devGithubId || !jobId)
      return res.status(400).json({ error: "IDs inválidos." });

    try {
      const [rows] = await db.query(
        "SELECT id FROM jobs WHERE id = ? AND company_id = ?",
        [jobId, companyId]
      );
      if (!rows.length) return res.status(404).json({ error: "Vaga não encontrada." });

      await db.query(`
        INSERT INTO company_match_actions (company_id, dev_github_id, job_id, action)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE action = VALUES(action)
      `, [companyId, devGithubId, jobId, action]);

      res.json({ success: true });
    } catch (err) {
      console.error("[PATCH /api/empresa/matchs]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getDesenvolvedores: async (req, res) => {
    const companyId = req.session.user.id;
    try {
      const [jobs] = await db.query(
        "SELECT id, level FROM jobs WHERE company_id = ? AND active = 1",
        [companyId]
      );
      const jobIds = jobs.map(j => j.id);
      const jobLevelMap = {};
      for (const j of jobs) jobLevelMap[j.id] = j.level;

      const jobSkillMap = {};
      if (jobIds.length) {
        const [jobSkillRows] = await db.query(
          "SELECT job_id, skill_id, importance FROM job_skills WHERE job_id IN (?)",
          [jobIds]
        );
        for (const r of jobSkillRows) {
          if (!jobSkillMap[r.job_id]) jobSkillMap[r.job_id] = [];
          jobSkillMap[r.job_id].push({ skill_id: r.skill_id, importance: r.importance });
        }
      }

      const [devs] = await db.query(
        "SELECT user_id AS id, github_id, nome, github_login, nivel FROM user_dev_profiles WHERE github_id IS NOT NULL"
      );
      if (!devs.length) return res.json([]);

      const devGithubIds = devs.map(d => d.github_id);

      const [skillRows] = await db.query(`
        SELECT us.github_id, us.skill_id, us.confidence, us.source, s.name AS skill_name
        FROM user_skills us
        JOIN skills s ON s.id = us.skill_id
        WHERE us.github_id IN (?)
        ORDER BY us.confidence DESC
      `, [devGithubIds]);

      const devSkillMap   = {};
      const devSkillNames = {};
      const devSkillOrigem = {}; // nome → "github" | "manual" (selo "detectada"/"declarada")
      for (const s of skillRows) {
        if (!devSkillMap[s.github_id]) { devSkillMap[s.github_id] = {}; devSkillNames[s.github_id] = []; devSkillOrigem[s.github_id] = {}; }
        devSkillMap[s.github_id][s.skill_id] = s.confidence;
        devSkillNames[s.github_id].push(s.skill_name);
        devSkillOrigem[s.github_id][s.skill_name] = s.source === "manual" ? "manual" : "github";
      }

      const [progressRows] = await db.query(`
        SELECT
          github_id,
          job_id,
          COUNT(*)                              AS total_skills,
          SUM(status = 'concluido')             AS concluded,
          SUM(status IN ('em_progresso','concluido')) AS active_skills
        FROM user_roadmap_progress
        WHERE github_id IN (?)
        GROUP BY github_id, job_id
      `, [devGithubIds]);

      const devProgressMap = {};
      for (const p of progressRows) {
        if (!devProgressMap[p.github_id])
          devProgressMap[p.github_id] = { bestProgress: 0, inRoadmap: false, concluido: false };
        const pct = p.total_skills > 0
          ? Math.round(Number(p.concluded) / p.total_skills * 100) : 0;
        const pm = devProgressMap[p.github_id];
        if (pct > pm.bestProgress) pm.bestProgress = pct;
        if (Number(p.active_skills) > 0) pm.inRoadmap = true;
        if (Number(p.concluded) > 0 && Number(p.concluded) === p.total_skills) pm.concluido = true;
      }

      const planCodes = await getPlanCodesBulk(devs.map(d => d.id), "dev");

      const result = devs.map(dev => {
        const devSkills   = devSkillMap[dev.github_id]   ?? {};
        const skillNames  = devSkillNames[dev.github_id] ?? [];
        const prog        = devProgressMap[dev.github_id] ?? { bestProgress: 0, inRoadmap: false, concluido: false };

        let bestMatch = 0;
        for (const jobId of jobIds) {
          const score = computeMatch(devSkills, jobSkillMap[jobId] ?? [], dev.nivel, jobLevelMap[jobId]);
          if (score > bestMatch) bestMatch = score;
        }

        return {
          id:           dev.id,
          dev_github_id: dev.github_id,
          name:         dev.nome,
          github:       dev.github_login,
          level:        NIVEL_MAP[dev.nivel] ?? "estagio",
          skills:       skillNames.slice(0, 5),
          skillsOrigem: Object.fromEntries(skillNames.slice(0, 5).map(n => [n, devSkillOrigem[dev.github_id]?.[n] ?? "github"])),
          progress:     prog.bestProgress,
          match:        bestMatch,
          roadmap:      prog.inRoadmap,
          concluido:    prog.concluido,
          isPro:        planCodes[dev.id] === "dev_pro",
        };
      });

      res.json(result);
    } catch (err) {
      console.error("[GET /api/empresa/desenvolvedores]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getDevProfile: async (req, res) => {
    const companyId = req.session.user.id;
    const devId     = Number(req.params.id);
    if (!Number.isInteger(devId) || devId <= 0)
      return res.status(400).json({ error: "ID inválido." });

    try {
      const [profiles] = await db.query(
        "SELECT user_id AS id, github_id, nome, sobrenome, github_login, nivel, avatar_url FROM user_dev_profiles WHERE user_id = ?",
        [devId]
      );
      if (!profiles.length) return res.status(404).json({ error: "Desenvolvedor não encontrado." });
      const dev = profiles[0];

      // "Dev visualizados recentemente" (dashboard): registra sem bloquear a resposta.
      db.query(
        `INSERT INTO company_dev_views (company_id, dev_user_id, viewed_at)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE viewed_at = NOW()`,
        [companyId, dev.id]
      ).catch(err => console.error("[GET /api/empresa/dev/:id] registrar visualização:", err.message));

      const [skillRows] = await db.query(`
        SELECT s.id AS skill_id, s.name, s.category, s.type, us.confidence, us.source
        FROM user_skills us
        JOIN skills s ON s.id = us.skill_id
        WHERE us.github_id = ?
        ORDER BY us.confidence DESC
      `, [dev.github_id]);

      const devSkills = {};
      for (const s of skillRows) devSkills[s.skill_id] = s.confidence;

      const [jobs] = await db.query(
        "SELECT id, title, level FROM jobs WHERE company_id = ? AND active = 1",
        [companyId]
      );

      let bestMatch = 0;
      let bestJobTitle = null;
      if (jobs.length) {
        const jobIds = jobs.map(j => j.id);
        const [jobSkillRows] = await db.query(
          "SELECT job_id, skill_id, importance FROM job_skills WHERE job_id IN (?)",
          [jobIds]
        );
        const jobSkillMap = {};
        for (const r of jobSkillRows) {
          if (!jobSkillMap[r.job_id]) jobSkillMap[r.job_id] = [];
          jobSkillMap[r.job_id].push({ skill_id: r.skill_id, importance: r.importance });
        }
        for (const job of jobs) {
          const score = computeMatch(devSkills, jobSkillMap[job.id] ?? [], dev.nivel, job.level);
          if (score > bestMatch) { bestMatch = score; bestJobTitle = job.title; }
        }
      }

      const [progressRows] = await db.query(`
        SELECT
          urp.job_id,
          j.title AS job_title,
          COUNT(*)                        AS total,
          SUM(urp.status = 'concluido')   AS concluded
        FROM user_roadmap_progress urp
        JOIN jobs j ON j.id = urp.job_id AND j.company_id = ?
        WHERE urp.github_id = ?
        GROUP BY urp.job_id, j.title
      `, [companyId, dev.github_id]);

      const devPlan = await getUserPlan(dev.id, "dev");

      res.json({
        id:           dev.id,
        github_id:    dev.github_id,
        name:         [dev.nome, dev.sobrenome].filter(Boolean).join(" "),
        github:       dev.github_login,
        avatar_url:   dev.avatar_url,
        level:        NIVEL_MAP[dev.nivel] ?? "estagio",
        skills:       skillRows.map(s => ({
          name: s.name, category: s.category, type: s.type, confidence: s.confidence,
          source: s.source === "manual" ? "manual" : "github",
        })),
        match:        bestMatch,
        isPro:        devPlan.code === "dev_pro",
        best_job:     bestJobTitle,
        roadmaps:     progressRows.map(p => ({
          job_id:    p.job_id,
          job_title: p.job_title,
          total:     Number(p.total),
          concluded: Number(p.concluded),
          progress:  p.total > 0 ? Math.round(Number(p.concluded) / Number(p.total) * 100) : 0,
        })),
      });
    } catch (err) {
      console.error("[GET /api/empresa/dev/:id]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getProfile: async (req, res) => {
    const companyId = req.session.user.id;
    try {
      const [users]    = await db.query("SELECT id, email, created_at FROM users WHERE id = ?", [companyId]);
      const [profiles] = await db.query("SELECT * FROM user_company_profiles WHERE user_id = ?", [companyId]);

      const [counts] = await db.query(
        "SELECT COUNT(*) AS total, CAST(SUM(active) AS UNSIGNED) AS ativas FROM jobs WHERE company_id = ?",
        [companyId]
      );
      // Vagas do Perfil da empresa: ativas primeiro, com área e nº de candidatos inscritos.
      const [vagasRows] = await db.query(`
        SELECT j.id, j.title, j.level, j.active, j.area, j.created_at,
               (SELECT COUNT(*) FROM job_applications ja WHERE ja.job_id = j.id) AS total_candidaturas
        FROM jobs j
        WHERE j.company_id = ?
        ORDER BY j.active DESC, j.created_at DESC
        LIMIT 20
      `, [companyId]);
      const areaPorVaga = await seguro(() => areasInferidasDasVagas(vagasRows.map(v => v.id)), {}, "áreas do perfil");
      const vagas = vagasRows.map(v => ({
        id:                 v.id,
        title:              v.title,
        level:              v.level,
        active:             Boolean(v.active),
        area:               v.area ?? areaPorVaga[v.id] ?? null, // a escolhida no formulário vence a inferida
        created_at:         v.created_at,
        total_candidaturas: Number(v.total_candidaturas ?? 0),
      }));

      const profile = profiles[0] ?? {};
      const user    = users[0]    ?? {};
      const plan    = await getUserPlan(companyId, "empresa");

      res.json({
        id:            companyId,
        email:         user.email         ?? "",
        created_at:    user.created_at    ?? null,
        razao_social:  profile.razao_social  ?? "",
        nome_fantasia: profile.nome_fantasia ?? "",
        cnpj:          profile.cnpj       ?? "",
        setor:         profile.setor      ?? "",
        tamanho:       profile.tamanho    ?? "",
        site:          profile.site       ?? "",
        descricao:     profile.descricao  ?? "",
        cidade:        profile.cidade     ?? "",
        estado:        profile.estado     ?? "",
        email_exibicao:  profile.email_exibicao  ?? "",
        endereco:        profile.endereco        ?? "",
        modelo_trabalho: profile.modelo_trabalho ?? "",
        maturidade:      profile.maturidade      ?? "",
        vagas,
        totalVagas:  Number(counts[0]?.total  ?? 0),
        vagasAtivas: Number(counts[0]?.ativas ?? 0),
        plan: {
          code: plan.code, name: plan.name, price_cents: plan.price_cents, max_active_jobs: plan.max_active_jobs,
          upgrade: planoDeUpgrade(plan),
        },
      });
    } catch (err) {
      console.error("[GET /api/empresa/profile]", err.message);
      res.status(500).json({ error: "Erro interno." });
    }
  },

  updateProfile: async (req, res) => {
    const companyId = req.session.user.id;
    const {
      nome_fantasia, setor, tamanho, site, descricao, cidade, estado,
      email_exibicao, endereco, modelo_trabalho, maturidade,
    } = req.body;

    if (nome_fantasia !== undefined && !String(nome_fantasia).trim()) {
      return res.status(400).json({ error: "Nome fantasia não pode ser vazio." });
    }
    if (email_exibicao !== undefined && String(email_exibicao).trim()
        && (String(email_exibicao).trim().length > 255 || !EMAIL_VALIDO.test(String(email_exibicao).trim()))) {
      return res.status(400).json({ error: "Informe um e-mail de exibição válido." });
    }
    if (endereco !== undefined && String(endereco).trim().length > 255) {
      return res.status(400).json({ error: "Endereço deve ter no máximo 255 caracteres." });
    }
    if (modelo_trabalho && !MODELOS_TRABALHO.includes(modelo_trabalho)) {
      return res.status(400).json({ error: "Modelo de trabalho inválido." });
    }
    if (maturidade && !MATURIDADES.includes(maturidade)) {
      return res.status(400).json({ error: "Faixa de maturidade inválida." });
    }
    if (descricao !== undefined && String(descricao).length > 1000) {
      return res.status(400).json({ error: "Descrição deve ter no máximo 1000 caracteres." });
    }

    try {
      const fields = [];
      const values = [];

      if (nome_fantasia !== undefined) { fields.push("nome_fantasia = ?"); values.push(String(nome_fantasia).trim() || null); }
      if (setor         !== undefined) { fields.push("setor = ?");         values.push(setor  || null); }
      if (tamanho       !== undefined) { fields.push("tamanho = ?");       values.push(tamanho || null); }
      if (site          !== undefined) { fields.push("site = ?");          values.push(String(site).trim() || null); }
      if (descricao     !== undefined) { fields.push("descricao = ?");     values.push(String(descricao).trim() || null); }
      if (cidade        !== undefined) { fields.push("cidade = ?");        values.push(String(cidade).trim() || null); }
      if (estado        !== undefined) { fields.push("estado = ?");        values.push(String(estado).trim().toUpperCase() || null); }
      if (email_exibicao  !== undefined) { fields.push("email_exibicao = ?");  values.push(String(email_exibicao).trim() || null); }
      if (endereco        !== undefined) { fields.push("endereco = ?");        values.push(String(endereco).trim() || null); }
      if (modelo_trabalho !== undefined) { fields.push("modelo_trabalho = ?"); values.push(modelo_trabalho || null); }
      if (maturidade      !== undefined) { fields.push("maturidade = ?");      values.push(maturidade || null); }

      if (fields.length > 0) {
        values.push(companyId);
        await db.query(
          `UPDATE user_company_profiles SET ${fields.join(", ")} WHERE user_id = ?`,
          values
        );
      }

      if (nome_fantasia) req.session.user.name = String(nome_fantasia).trim();

      res.json({ success: true, message: "Perfil atualizado com sucesso." });
    } catch (err) {
      console.error("[PATCH /api/empresa/profile]", err.message);
      res.status(500).json({ error: "Erro interno." });
    }
  },

  // Perfil resumido de uma empresa, visível pra qualquer usuário logado —
  // usado no painel lateral de mensagens (dev vendo com quem está falando).
  getPublicProfile: async (req, res) => {
    const companyId = Number(req.params.id);
    if (!Number.isInteger(companyId) || companyId <= 0) return res.status(400).json({ error: "ID inválido." });

    try {
      const [rows] = await db.query(
        "SELECT nome_fantasia, razao_social, setor, tamanho, site, descricao, cidade, estado, email_exibicao, endereco, modelo_trabalho, maturidade FROM user_company_profiles WHERE user_id = ?",
        [companyId]
      );
      if (!rows.length) return res.status(404).json({ error: "Empresa não encontrada." });
      const profile = rows[0];

      const [jobs] = await db.query(
        "SELECT id, title, level, modality FROM jobs WHERE company_id = ? AND active = 1 ORDER BY created_at DESC",
        [companyId]
      );

      res.json({
        id:      companyId,
        name:    profile.nome_fantasia ?? profile.razao_social,
        setor:   profile.setor    ?? null,
        tamanho: profile.tamanho  ?? null,
        site:    profile.site     ?? null,
        descricao: profile.descricao ?? null,
        cidade:  profile.cidade   ?? null,
        estado:  profile.estado   ?? null,
        email_exibicao:  profile.email_exibicao  ?? null,
        endereco:        profile.endereco        ?? null,
        modelo_trabalho: profile.modelo_trabalho ?? null,
        maturidade:      profile.maturidade      ?? null,
        jobs,
      });
    } catch (err) {
      console.error("[GET /api/empresas/:id]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  // Lista as candidaturas recebidas numa vaga da empresa. No plano Premium,
  // cada candidatura vem com um resumo gerado por IA (pontos fortes,
  // projetos relevantes) — gerado sob demanda e cacheado em resumo_ia.
  getJobApplications: async (req, res) => {
    const companyId = req.session.user.id;
    const jobId      = Number(req.params.id);
    if (!Number.isInteger(jobId) || jobId <= 0) return res.status(400).json({ error: "ID inválido." });

    try {
      const [[job]] = await db.query(
        "SELECT id, title, level FROM jobs WHERE id = ? AND company_id = ?",
        [jobId, companyId]
      );
      if (!job) return res.status(404).json({ error: "Vaga não encontrada." });

      const [applications] = await db.query(`
        SELECT ja.id, ja.dev_github_id, ja.created_at, ja.resumo_ia,
               udp.user_id AS dev_id, udp.nome AS dev_nome, udp.github_login, udp.nivel
        FROM job_applications ja
        LEFT JOIN user_dev_profiles udp ON udp.github_id = ja.dev_github_id
        WHERE ja.job_id = ?
        ORDER BY ja.created_at DESC
      `, [jobId]);

      const plan = await getUserPlan(companyId, "empresa");
      const isPremium = plan.code === "empresa_premium";

      res.json({
        job: { id: job.id, title: job.title, level: job.level },
        premium: isPremium,
        applications: applications.map(a => ({
          id: a.id,
          dev_id: a.dev_id,
          dev_github_id: a.dev_github_id,
          dev_nome: a.dev_nome,
          github_login: a.github_login,
          nivel: a.nivel,
          created_at: a.created_at,
          resumo_ia: a.resumo_ia,
        })),
      });
    } catch (err) {
      console.error("[GET /api/empresa/jobs/:id/candidaturas]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  // Gera (ou retorna do cache) o resumo IA de uma candidatura — exclusivo
  // empresa Premium.
  getApplicationSummary: async (req, res) => {
    const companyId    = req.session.user.id;
    const applicationId = Number(req.params.id);
    if (!Number.isInteger(applicationId) || applicationId <= 0) return res.status(400).json({ error: "ID inválido." });

    // Gate do plano Premium: requirePlan("empresa_premium") em routes/empresa.js.
    try {
      const [[application]] = await db.query(
        `SELECT ja.id FROM job_applications ja JOIN jobs j ON j.id = ja.job_id
         WHERE ja.id = ? AND j.company_id = ?`,
        [applicationId, companyId]
      );
      if (!application) return res.status(404).json({ error: "Candidatura não encontrada." });

      const resumo = await getOrGenerateSummary(applicationId);
      res.json({ resumo_ia: resumo });
    } catch (err) {
      console.error("[POST /api/empresa/candidaturas/:id/resumo-ia]", resumoDoErro(err));
      // 503: IA indisponível agora; 502: resposta inutilizável; 500: interno.
      res.status(statusHttpDaIA(err, 500)).json({ error: "Erro ao gerar resumo com IA. Tente novamente em instantes." });
    }
  },
};

module.exports = empresaController;
