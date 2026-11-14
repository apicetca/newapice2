const db = require("../database/db");
const { computeMatch } = require("../services/matchCalculator");
const {
  setUserPlan, getPlanCodesBulk, getUserPlan, MP_ACCESS_CONDITION, ANNUAL_ACCESS_CONDITION,
} = require("../services/subscriptionService");
const profileController = require("./profileController");
const relatorioCrescimento = require("../services/relatorioCrescimento");
const relatorioDesempenho = require("../services/relatorioDesempenho");
const relatorioMatchs = require("../services/relatorioMatchs");
const relatorioEmpresas = require("../services/relatorioEmpresas");
const relatorioUso = require("../services/relatorioUso");
const relatorioPlanos = require("../services/relatorioPlanos");
const relatorioExport = require("../services/relatorioExport");
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

// Equivalente para empresas: o plano vale por conta e uma empresa pode ter
// mais de uma. Mesmo CNPJ (só os dígitos) é o sinal forte; mesmo nome
// fantasia ou razão social (sem acento, caixa ou pontuação) é mais fraco.
// Tudo é digitado no cadastro, então o painel só avisa e o admin decide.
const somenteDigitos = s => String(s ?? "").replace(/\D/g, "");
const nomeNormalizado = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]/gi, "").toLowerCase();

function motivoMesmaEmpresa(a, b) {
  const cnpj = somenteDigitos(a.cnpj);
  if (cnpj && cnpj === somenteDigitos(b.cnpj)) return "CNPJ";
  const nomesB = [b.nome_fantasia, b.razao_social].map(nomeNormalizado).filter(Boolean);
  const mesmoNome = [a.nome_fantasia, a.razao_social].map(nomeNormalizado).some(n => n && nomesB.includes(n));
  return mesmoNome ? "nome" : null;
}

const SETORES     = ["tecnologia", "financeiro", "educacao", "saude", "varejo", "industria", "consultoria", "outro"];
const MATURIDADES = ["startup", "crescimento", "consolidada"];
const MODELOS_TRABALHO = ["remoto", "hibrido", "presencial"];

// Opções fixas da vaga: valores das colunas ENUM do banco, com o texto mostrado ao admin.
const OPCOES_VAGA = {
  modalidades: [
    ["presencial", "Presencial", "Trabalho no escritório da empresa."],
    ["remoto", "Remoto", "Trabalho totalmente a distância."],
    ["hibrido", "Híbrido", "Combina dias no escritório e dias a distância."],
  ],
  niveis: [
    ["estagio", "Estágio", "Para estudantes em início de carreira."],
    ["junior", "Júnior", "Profissionais em início de carreira, com autonomia crescente."],
    ["pleno", "Pleno", "Profissionais com autonomia e experiência consolidada."],
  ],
  contratacao: [
    ["clt", "CLT", "Contratação com carteira assinada."],
    ["pj", "PJ", "Contratação como pessoa jurídica."],
    ["estagio", "Estágio", "Contrato de estágio."],
    ["freelancer", "Freelancer", "Trabalho por projeto ou demanda."],
  ],
};

// Paginação e busca de listas do admin: page ≥ 1, limit 1–50 (padrão 10), q aparado (até 100).
function paginacao(query = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 50);
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
  return { page, limit, q };
}

// Valida nome/descrição de categoria; `completo` exige o nome (criação).
function validarCategoria(b, completo) {
  const out = {};
  if (completo || "nome" in b) {
    const nome = typeof b.nome === "string" ? b.nome.trim() : "";
    if (nome.length < 2 || nome.length > 60) return { error: "O nome deve ter entre 2 e 60 caracteres." };
    out.nome = nome;
  }
  if ("descricao" in b) {
    const d = typeof b.descricao === "string" ? b.descricao.trim() : null;
    if (d === null || d.length > 255) return { error: "A descrição deve ter no máximo 255 caracteres." };
    out.descricao = d || null;
  }
  return out;
}

async function comoDev(req, res, handler, extra) {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "ID inválido." });
  try {
    const [[dev]] = await db.query(
      "SELECT u.id, p.github_id FROM users u LEFT JOIN user_dev_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.type = 'dev'",
      [userId]);
    if (!dev) return res.status(404).json({ error: "Desenvolvedor não encontrado." });
    const fakeReq = { session: { user: { id: dev.id, github_id: dev.github_id ?? undefined, type: "dev" } }, body: {}, params: {}, ...extra };
    return handler(fakeReq, res);
  } catch (err) {
    console.error("[admin → habilidade do dev]", err.message);
    res.status(500).json({ error: "Erro interno. Tente novamente." });
  }
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
          (SELECT COUNT(*) FROM company_match_actions WHERE action = 'aceito') AS matchsAceitos,
          (SELECT COUNT(*) FROM users WHERE type = 'dev'
             AND created_at >= (NOW() - INTERVAL 30 DAY))             AS novosDevs,
          (SELECT COUNT(*) FROM users WHERE type = 'empresa'
             AND created_at >= (NOW() - INTERVAL 30 DAY))             AS novasEmpresas,
          (SELECT COUNT(*) FROM mentor_conversas WHERE role = 'user') AS mentorAnalises
      `);

      // Assinantes PRO (dev): mesmas três fontes de plano do subscriptionService.
      const [[{ assinantesPro }]] = await db.query(`
        SELECT COUNT(DISTINCT user_id) AS assinantesPro FROM (
          SELECT user_id FROM user_subscriptions WHERE status = 'active' AND plan_code = 'dev_pro'
          UNION ALL
          SELECT user_id FROM subscriptions WHERE plan_id = 'dev_pro' AND ${MP_ACCESS_CONDITION}
          UNION ALL
          SELECT user_id FROM annual_payments WHERE plan_id = 'dev_pro' AND ${ANNUAL_ACCESS_CONDITION}
        ) t
      `);

      const [devsRecentes] = await db.query(`
        SELECT u.id, u.email, u.created_at, p.nome, p.sobrenome, p.nivel, p.avatar_url
        FROM users u LEFT JOIN user_dev_profiles p ON p.user_id = u.id
        WHERE u.type = 'dev' ORDER BY u.created_at DESC LIMIT 5
      `);

      const [empresasRecentes] = await db.query(`
        SELECT u.id, u.email, u.created_at, p.nome_fantasia, p.razao_social,
               (SELECT COUNT(*) FROM jobs j WHERE j.company_id = u.id AND j.active = 1) AS vagasAtivas
        FROM users u LEFT JOIN user_company_profiles p ON p.user_id = u.id
        WHERE u.type = 'empresa' ORDER BY u.created_at DESC LIMIT 6
      `);

      res.json({
        stats: {
          totalDevs:        Number(stats.totalDevs),
          totalEmpresas:    Number(stats.totalEmpresas),
          vagasAtivas:      Number(stats.vagasAtivas),
          totalVagas:       Number(stats.totalVagas),
          totalCandidaturas: Number(stats.totalCandidaturas),
          matchsAceitos:    Number(stats.matchsAceitos),
          novosDevs:        Number(stats.novosDevs),
          novasEmpresas:    Number(stats.novasEmpresas),
          assinantesPro:    Number(assinantesPro),
          mentorAnalises:   Number(stats.mentorAnalises),
        },
        devsRecentes,
        empresasRecentes: empresasRecentes.map(e => ({ ...e, vagasAtivas: Number(e.vagasAtivas) })),
      });
    } catch (err) {
      console.error("[GET /api/admin/dashboard]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  // Perfil completo de um dev, para Admin → Usuários → ver perfil.
  getUserDetail: async (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "ID inválido." });
    try {
      const [[u]] = await db.query(`
        SELECT u.id, u.email, u.active, u.created_at, (u.password_hash IS NOT NULL) AS tem_senha,
               TIMESTAMPDIFF(SECOND, u.last_seen_at, NOW()) AS visto_ha_segundos,
               p.nome, p.sobrenome, p.nivel, p.github_login, p.github_id, p.avatar_url
        FROM users u LEFT JOIN user_dev_profiles p ON p.user_id = u.id
        WHERE u.id = ? AND u.type = 'dev'`, [userId]);
      if (!u) return res.status(404).json({ error: "Desenvolvedor não encontrado." });

      // Mesma regra de profileController: user_skills é chaveado por github_id (ou id interno).
      const chave = u.github_id ?? u.id;
      const [skills] = await db.query(`
        SELECT us.skill_id, us.source, us.confidence, s.name
        FROM user_skills us JOIN skills s ON s.id = us.skill_id
        WHERE us.github_id = ? ORDER BY us.confidence DESC, s.name ASC`, [chave]);
      try {
        const [decl] = await db.query("SELECT skill_id, nivel FROM user_skill_declaracoes WHERE github_id = ?", [chave]);
        const porSkill = Object.fromEntries(decl.map(d => [d.skill_id, d.nivel]));
        for (const s of skills) s.nivel_declarado = porSkill[s.skill_id] ?? null;
      } catch (err) {
        if (err.code !== "ER_NO_SUCH_TABLE") throw err;
        for (const s of skills) s.nivel_declarado = null;
      }

      const [repos] = await db.query(
        "SELECT repo_name, repo_full_name FROM user_repositories WHERE user_id = ? AND is_public = 1 ORDER BY added_at DESC",
        [userId]);

      const plan = await getUserPlan(userId, "dev");
      const [subs] = await db.query(`
        SELECT DATE_FORMAT(next_payment_date, '%Y-%m-%d') AS next_payment_date
        FROM subscriptions WHERE user_id = ? AND status = 'authorized' ORDER BY id DESC LIMIT 1`, [userId]);

      res.json({
        id: u.id, email: u.email, active: Boolean(u.active), created_at: u.created_at,
        visto_ha_segundos: u.visto_ha_segundos == null ? null : Number(u.visto_ha_segundos),
        login_github: u.github_id != null, login_email: Boolean(u.tem_senha),
        nome: u.nome ?? "", sobrenome: u.sobrenome ?? "", nivel: u.nivel ?? "iniciante",
        github_login: u.github_login ?? "", avatar_url: u.avatar_url ?? null,
        skills, repos,
        plan: { code: plan.code, name: plan.name, benefits: plan.benefits ?? [], next_payment_date: subs[0]?.next_payment_date ?? null },
      });
    } catch (err) {
      console.error("[GET /api/admin/users/:id]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  // Declarar/remover habilidade em nome do dev: reaproveita a regra do próprio
  // perfil (combinar detectado × declarado) chamando os mesmos handlers com a
  // identidade do dev, em vez de duplicar a lógica.
  addUserSkill:    (req, res) => comoDev(req, res, profileController.addSkill,    { body: req.body }),
  removeUserSkill: (req, res) => comoDev(req, res, profileController.removeSkill, { params: { skillId: req.params.skillId } }),

  getUsers: async (req, res) => {
    try {
      const [rows] = await db.query(`
        SELECT u.id, u.email, u.active, u.created_at, (u.password_hash IS NOT NULL) AS tem_senha,
               p.nome, p.sobrenome, p.nivel, p.github_login, p.github_id, p.avatar_url,
               TIMESTAMPDIFF(SECOND, u.last_seen_at, NOW()) AS visto_ha_segundos
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
          visto_ha_segundos: r.visto_ha_segundos == null ? null : Number(r.visto_ha_segundos),
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
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "ID inválido." });

    // { active } (suspender/reativar) continua como antes; nome/sobrenome/nivel/
    // github_login vêm do modal de edição. Todos opcionais.
    const b = req.body ?? {};
    const profile = [], pvalues = [];
    const text = (v) => (typeof v === "string" ? v.trim() : null);

    if ("nome" in b) {
      const v = text(b.nome);
      if (!v || v.length > 100 || !/^[\p{L}][\p{L} '’-]*$/u.test(v)) {
        return res.status(400).json({ error: "Nome inválido. Use apenas letras e espaços (até 100)." });
      }
      profile.push("nome = ?"); pvalues.push(v);
    }
    if ("sobrenome" in b) {
      const v = text(b.sobrenome);
      if (v === null || v.length > 100 || (v && !/^[\p{L}][\p{L} '’-]*$/u.test(v))) {
        return res.status(400).json({ error: "Sobrenome inválido. Use apenas letras e espaços (até 100)." });
      }
      profile.push("sobrenome = ?"); pvalues.push(v || null);
    }
    if ("nivel" in b) {
      if (!["iniciante", "intermediario", "avancado"].includes(b.nivel)) return res.status(400).json({ error: "Nível inválido." });
      profile.push("nivel = ?"); pvalues.push(b.nivel);
    }
    if ("github_login" in b) {
      const v = text(b.github_login)?.replace(/^@/, "");
      if (v === undefined || v === null || (v && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(v))) {
        return res.status(400).json({ error: "Usuário do GitHub inválido." });
      }
      profile.push("github_login = ?"); pvalues.push(v || null);
    }
    if (!("active" in b) && !profile.length) return res.status(400).json({ error: "Nada para atualizar." });

    try {
      const [rows] = await db.query("SELECT id FROM users WHERE id = ? AND type = 'dev'", [userId]);
      if (!rows.length) return res.status(404).json({ error: "Desenvolvedor não encontrado." });

      if ("active" in b) {
        await db.query("UPDATE users SET active = ? WHERE id = ? AND type = 'dev'", [b.active ? 1 : 0, userId]);
      }
      if (profile.length) {
        await db.query(`UPDATE user_dev_profiles SET ${profile.join(", ")} WHERE user_id = ?`, [...pvalues, userId]);
      }
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

  // Perfil completo de uma empresa, para Admin → Empresas → ver perfil.
  getEmpresaDetail: async (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "ID inválido." });
    try {
      const [[u]] = await db.query(`
        SELECT u.id, u.email, u.active, u.created_at,
               TIMESTAMPDIFF(SECOND, u.last_seen_at, NOW()) AS visto_ha_segundos,
               p.razao_social, p.nome_fantasia, p.cnpj, p.setor, p.maturidade, p.endereco,
               p.modelo_trabalho, p.descricao, p.site, p.cidade, p.estado
        FROM users u LEFT JOIN user_company_profiles p ON p.user_id = u.id
        WHERE u.id = ? AND u.type = 'empresa'`, [userId]);
      if (!u) return res.status(404).json({ error: "Empresa não encontrada." });

      const [jobs] = await db.query(`
        SELECT j.id, j.title, j.area, j.active, j.max_candidates, j.created_at,
               DATE_FORMAT(j.expires_at, '%Y-%m-%d') AS expires_at,
               (SELECT COUNT(*) FROM job_applications ja WHERE ja.job_id = j.id) AS total_candidaturas
        FROM jobs j WHERE j.company_id = ? ORDER BY j.active DESC, j.created_at DESC`, [userId]);

      const plan = await getUserPlan(userId, "empresa");
      const [subs] = await db.query(`
        SELECT DATE_FORMAT(next_payment_date, '%Y-%m-%d') AS next_payment_date
        FROM subscriptions WHERE user_id = ? AND status = 'authorized' ORDER BY id DESC LIMIT 1`, [userId]);

      const vagas = jobs.map(j => ({ ...j, active: Boolean(j.active), total_candidaturas: Number(j.total_candidaturas) }));
      res.json({
        id: u.id, email: u.email, active: Boolean(u.active), created_at: u.created_at,
        visto_ha_segundos: u.visto_ha_segundos == null ? null : Number(u.visto_ha_segundos),
        razao_social: u.razao_social ?? "", nome_fantasia: u.nome_fantasia ?? "", cnpj: u.cnpj ?? "",
        setor: u.setor ?? "", maturidade: u.maturidade ?? "", endereco: u.endereco ?? "",
        modelo_trabalho: u.modelo_trabalho ?? "", descricao: u.descricao ?? "", site: u.site ?? "",
        cidade: u.cidade ?? "", estado: u.estado ?? "",
        stats: {
          vagas: vagas.length,
          vagas_ativas: vagas.filter(v => v.active).length,
          candidaturas: vagas.reduce((n, v) => n + v.total_candidaturas, 0),
        },
        vagas,
        plan: { code: plan.code, name: plan.name, benefits: plan.benefits ?? [], next_payment_date: subs[0]?.next_payment_date ?? null },
      });
    } catch (err) {
      console.error("[GET /api/admin/empresas/:id]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getEmpresas: async (req, res) => {
    try {
      const [rows] = await db.query(`
        SELECT u.id, u.email, u.active, u.created_at,
               p.nome_fantasia, p.razao_social, p.cnpj, p.setor, p.tamanho, p.maturidade, p.site,
               TIMESTAMPDIFF(SECOND, u.last_seen_at, NOW()) AS visto_ha_segundos,
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
        visto_ha_segundos: r.visto_ha_segundos == null ? null : Number(r.visto_ha_segundos),
        total_vagas:  Number(r.total_vagas),
        vagas_ativas: Number(r.vagas_ativas),
        plan_code: planCodes[r.id],
        outras_contas: rows
          .filter(o => o.id !== r.id)
          .map(o => ({ o, motivo: motivoMesmaEmpresa(r, o) }))
          .filter(({ motivo }) => motivo)
          .map(({ o, motivo }) => ({
            id: o.id, email: o.email, nome: o.nome_fantasia || o.razao_social || null,
            plan_code: planCodes[o.id], motivo,
          })),
      })));
    } catch (err) {
      console.error("[GET /api/admin/empresas]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  updateEmpresaStatus: async (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "ID inválido." });

    // { active } (suspender/reativar) continua como antes; razão social, nome
    // fantasia, setor e maturidade vêm do modal de edição. Todos opcionais.
    const b = req.body ?? {};
    const profile = [], pvalues = [];
    const text = (v) => (typeof v === "string" ? v.trim() : null);

    if ("razao_social" in b) {
      const v = text(b.razao_social);
      if (!v || v.length < 2 || v.length > 200) return res.status(400).json({ error: "O nome deve ter entre 2 e 200 caracteres." });
      profile.push("razao_social = ?"); pvalues.push(v);
    }
    if ("nome_fantasia" in b) {
      const v = text(b.nome_fantasia);
      if (v === null || v.length > 200) return res.status(400).json({ error: "O nome fantasia deve ter no máximo 200 caracteres." });
      profile.push("nome_fantasia = ?"); pvalues.push(v || null);
    }
    if ("setor" in b) {
      if (b.setor && !SETORES.includes(b.setor)) return res.status(400).json({ error: "Setor inválido." });
      profile.push("setor = ?"); pvalues.push(b.setor || null);
    }
    if ("maturidade" in b) {
      if (b.maturidade && !MATURIDADES.includes(b.maturidade)) return res.status(400).json({ error: "Faixa de maturidade inválida." });
      profile.push("maturidade = ?"); pvalues.push(b.maturidade || null);
    }
    if ("endereco" in b) {
      const v = text(b.endereco);
      if (v === null || v.length > 255) return res.status(400).json({ error: "Endereço deve ter no máximo 255 caracteres." });
      profile.push("endereco = ?"); pvalues.push(v || null);
    }
    if ("modelo_trabalho" in b) {
      if (b.modelo_trabalho && !MODELOS_TRABALHO.includes(b.modelo_trabalho)) return res.status(400).json({ error: "Modelo de trabalho inválido." });
      profile.push("modelo_trabalho = ?"); pvalues.push(b.modelo_trabalho || null);
    }
    if ("descricao" in b) {
      const v = text(b.descricao);
      if (v === null || v.length > 1000) return res.status(400).json({ error: "Descrição deve ter no máximo 1000 caracteres." });
      profile.push("descricao = ?"); pvalues.push(v || null);
    }
    if (!("active" in b) && !profile.length) return res.status(400).json({ error: "Nada para atualizar." });

    try {
      const [rows] = await db.query("SELECT id FROM users WHERE id = ? AND type = 'empresa'", [userId]);
      if (!rows.length) return res.status(404).json({ error: "Empresa não encontrada." });

      if ("active" in b) {
        await db.query("UPDATE users SET active = ? WHERE id = ? AND type = 'empresa'", [b.active ? 1 : 0, userId]);
      }
      if (profile.length) {
        await db.query(`UPDATE user_company_profiles SET ${profile.join(", ")} WHERE user_id = ?`, [...pvalues, userId]);
      }
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
               j.location, DATE_FORMAT(j.expires_at, '%Y-%m-%d') AS expires_at,
               u.email AS company_email,
               (SELECT COUNT(*) FROM job_applications ja WHERE ja.job_id = j.id) AS total_candidaturas
        FROM jobs j
        LEFT JOIN users u ON u.id = j.company_id
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
    if (!Number.isInteger(jobId) || jobId <= 0) return res.status(400).json({ error: "ID inválido." });

    // Todos os campos são opcionais: { active } continua funcionando como antes
    // (pausar/reativar); título/empresa/nível/local/expiração vêm do modal de edição.
    const b = req.body ?? {};
    const sets = [], values = [];
    const text = (v) => (typeof v === "string" ? v.trim() : null);

    if ("active" in b) {
      sets.push("active = ?"); values.push(b.active ? 1 : 0);
      // registra quando a vaga saiu do ar (relatório "Desempenho das vagas")
      sets.push(b.active ? "closed_at = NULL" : "closed_at = COALESCE(closed_at, NOW())");
    }
    if ("title" in b) {
      const v = text(b.title);
      if (!v || v.length < 3 || v.length > 200) return res.status(400).json({ error: "O título deve ter entre 3 e 200 caracteres." });
      sets.push("title = ?"); values.push(v);
    }
    if ("company" in b) {
      const v = text(b.company);
      if (v === null || v.length > 100) return res.status(400).json({ error: "A empresa deve ter no máximo 100 caracteres." });
      sets.push("company = ?"); values.push(v || null);
    }
    if ("level" in b) {
      if (!["estagio", "junior", "pleno"].includes(b.level)) return res.status(400).json({ error: "Nível inválido." });
      sets.push("level = ?"); values.push(b.level);
    }
    if ("location" in b) {
      const v = text(b.location);
      if (v === null || v.length > 255) return res.status(400).json({ error: "O local deve ter no máximo 255 caracteres." });
      sets.push("location = ?"); values.push(v || null);
    }
    if ("expires_at" in b) {
      const v = b.expires_at;
      if (v !== null && v !== "" && !(/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)))) {
        return res.status(400).json({ error: "Data de expiração inválida." });
      }
      sets.push("expires_at = ?"); values.push(v || null);
    }
    if (!sets.length) return res.status(400).json({ error: "Nada para atualizar." });

    try {
      const [result] = await db.query(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`, [...values, jobId]);
      if (result.affectedRows === 0) return res.status(404).json({ error: "Vaga não encontrada." });
      res.json({ success: true });
    } catch (err) {
      console.error("[PATCH /api/admin/jobs/:id]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  // ── Configurações → Categorias e vagas ─────────────────────
  listJobCategories: async (req, res) => {
    try {
      const [rows] = await db.query(`
        SELECT c.id, c.nome, c.descricao, c.active,
               (SELECT COUNT(*) FROM jobs j WHERE j.category_id = c.id) AS vagas
        FROM job_categories c ORDER BY vagas DESC, c.nome ASC`);
      res.json(rows.map(r => ({ ...r, active: Boolean(r.active), vagas: Number(r.vagas) })));
    } catch (err) {
      console.error("[GET /api/admin/job-categories]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  createJobCategory: async (req, res) => {
    const v = validarCategoria(req.body ?? {}, true);
    if (v.error) return res.status(400).json({ error: v.error });
    try {
      const [[dup]] = await db.query("SELECT id FROM job_categories WHERE nome = ?", [v.nome]);
      if (dup) return res.status(409).json({ error: "Já existe uma categoria com esse nome." });
      const [r] = await db.query("INSERT INTO job_categories (nome, descricao) VALUES (?, ?)", [v.nome, v.descricao ?? null]);
      res.status(201).json({ success: true, id: r.insertId });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Já existe uma categoria com esse nome." });
      console.error("[POST /api/admin/job-categories]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  updateJobCategory: async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID inválido." });
    const b = req.body ?? {};
    const v = validarCategoria(b, false);
    if (v.error) return res.status(400).json({ error: v.error });
    const sets = [], values = [];
    if ("nome" in b) { sets.push("nome = ?"); values.push(v.nome); }
    if ("descricao" in b) { sets.push("descricao = ?"); values.push(v.descricao ?? null); }
    if ("active" in b) { sets.push("active = ?"); values.push(b.active ? 1 : 0); }
    if (!sets.length) return res.status(400).json({ error: "Nada para atualizar." });
    try {
      if ("nome" in b) {
        const [[dup]] = await db.query("SELECT id FROM job_categories WHERE nome = ? AND id <> ?", [v.nome, id]);
        if (dup) return res.status(409).json({ error: "Já existe uma categoria com esse nome." });
      }
      const [r] = await db.query(`UPDATE job_categories SET ${sets.join(", ")} WHERE id = ?`, [...values, id]);
      if (r.affectedRows === 0) return res.status(404).json({ error: "Categoria não encontrada." });
      res.json({ success: true });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Já existe uma categoria com esse nome." });
      console.error("[PATCH /api/admin/job-categories/:id]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  // Opções fixas da vaga (colunas ENUM do banco) com quantas vagas usam cada uma,
  // mais o resumo do catálogo de habilidades.
  getJobOptions: async (req, res) => {
    try {
      const contar = async (coluna) => {
        const [rows] = await db.query(`SELECT ${coluna} AS valor, COUNT(*) AS n FROM jobs GROUP BY ${coluna}`);
        return Object.fromEntries(rows.map(r => [r.valor, Number(r.n)]));
      };
      const [modal, nivel, contrato] = [await contar("modality"), await contar("level"), await contar("contract_type")];
      const montar = (def, cont) => def.map(([valor, nome, descricao]) => ({ valor, nome, descricao, vagas: cont[valor] ?? 0 }));
      const [[sk]] = await db.query(`
        SELECT COUNT(*) AS total, COALESCE(SUM(type = 'hard'), 0) AS tecnicas, COALESCE(SUM(type = 'soft'), 0) AS comportamentais FROM skills`);
      res.json({
        modalidades: montar(OPCOES_VAGA.modalidades, modal),
        niveis: montar(OPCOES_VAGA.niveis, nivel),
        contratacao: montar(OPCOES_VAGA.contratacao, contrato),
        habilidades: { total: Number(sk.total), tecnicas: Number(sk.tecnicas), comportamentais: Number(sk.comportamentais) },
      });
    } catch (err) {
      console.error("[GET /api/admin/job-options]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  // ── Configurações → Segurança e privacidade ─────────────────
  listAdmins: async (req, res) => {
    const { q, page, limit } = paginacao(req.query);
    try {
      const filtro = q ? "AND (u.email LIKE ? OR p.nome LIKE ?)" : "";
      const args = q ? [`%${q}%`, `%${q}%`] : [];
      const [[{ total }]] = await db.query(`
        SELECT COUNT(*) AS total FROM users u LEFT JOIN user_admin_profiles p ON p.user_id = u.id
        WHERE u.type = 'admin' ${filtro}`, args);
      const [rows] = await db.query(`
        SELECT u.id, u.email, p.nome, TIMESTAMPDIFF(SECOND, u.last_seen_at, NOW()) AS visto_ha_segundos
        FROM users u LEFT JOIN user_admin_profiles p ON p.user_id = u.id
        WHERE u.type = 'admin' ${filtro}
        ORDER BY u.last_seen_at IS NULL, u.last_seen_at DESC, p.nome ASC
        LIMIT ? OFFSET ?`, [...args, limit, (page - 1) * limit]);
      res.json({
        total: Number(total), page, limit,
        items: rows.map(r => ({
          id: r.id, nome: r.nome || r.email, email: r.email, voce: r.id === req.session.user.id,
          visto_ha_segundos: r.visto_ha_segundos == null ? null : Number(r.visto_ha_segundos),
        })),
      });
    } catch (err) {
      console.error("[GET /api/admin/admins]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  // Remove a conta de um administrador e derruba as sessões dele. Não permite remover a
  // própria conta nem o último administrador.
  removeAdmin: async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID inválido." });
    if (id === req.session.user.id) return res.status(400).json({ error: "Você não pode remover a sua própria conta." });
    try {
      const [[alvo]] = await db.query("SELECT id FROM users WHERE id = ? AND type = 'admin'", [id]);
      if (!alvo) return res.status(404).json({ error: "Administrador não encontrado." });
      const [[{ total }]] = await db.query("SELECT COUNT(*) AS total FROM users WHERE type = 'admin'");
      if (Number(total) <= 1) return res.status(400).json({ error: "Não é possível remover o último administrador." });

      await db.query("DELETE FROM user_admin_profiles WHERE user_id = ?", [id]);
      await db.query("DELETE FROM users WHERE id = ? AND type = 'admin'", [id]);
      // Sem isso, a pessoa continuaria logada até a sessão expirar (até 24h).
      try {
        await db.query("DELETE FROM sessions WHERE JSON_EXTRACT(data, '$.user.id') = ?", [id]);
      } catch (err) { console.error("[removeAdmin] sessões não encerradas:", err.message); }
      res.json({ success: true });
    } catch (err) {
      console.error("[DELETE /api/admin/admins/:id]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  listAuditLog: async (req, res) => {
    const { page, limit } = paginacao(req.query);
    // Filtro opcional de período: ?periodo=7|30|90 ou ?from=AAAA-MM-DD&to=AAAA-MM-DD (sem nada = tudo).
    let where = "", args = [];
    if (req.query.periodo || req.query.from || req.query.to) {
      try {
        const { from, to } = require("../services/relatorioCrescimento").resolverPeriodo(req.query);
        where = "WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)";
        args = [from, to];
      } catch (err) { return res.status(400).json({ error: err.message }); }
    }
    try {
      const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM admin_audit_log ${where}`, args);
      const [rows] = await db.query(`
        SELECT id, admin_nome, titulo, acao, TIMESTAMPDIFF(SECOND, created_at, NOW()) AS ha_segundos
        FROM admin_audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...args, limit, (page - 1) * limit]);
      res.json({ total: Number(total), page, limit,
        items: rows.map(r => ({ id: r.id, admin: r.admin_nome, titulo: r.titulo || "Alteração no painel", acao: r.acao, ha_segundos: Number(r.ha_segundos) })) });
    } catch (err) {
      console.error("[GET /api/admin/audit-log]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  deleteJob: async (req, res) => {
    const jobId = Number(req.params.id);
    if (!Number.isInteger(jobId) || jobId <= 0) return res.status(400).json({ error: "ID inválido." });
    try {
      const [result] = await db.query("DELETE FROM jobs WHERE id = ?", [jobId]);
      if (result.affectedRows === 0) return res.status(404).json({ error: "Vaga não encontrada." });
      res.json({ success: true });
    } catch (err) {
      console.error("[DELETE /api/admin/jobs/:id]", err.message);
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

  // Relatório "Crescimento de usuários" (JSON e exportação CSV).
  getRelatorioCrescimento: async (req, res) => {
    try {
      res.json(await relatorioCrescimento.gerar(db, req.query));
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      console.error("[GET /api/admin/reports/crescimento-de-usuarios]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getRelatorioDesempenho: async (req, res) => {
    try {
      res.json(await relatorioDesempenho.gerar(db, req.query));
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      console.error("[GET /api/admin/reports/desempenho-das-vagas]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getRelatorioMatchs: async (req, res) => {
    try {
      res.json(await relatorioMatchs.gerar(db, req.query));
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      console.error("[GET /api/admin/reports/compatibilidade-de-matchs]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getRelatorioEmpresas: async (req, res) => {
    try {
      res.json(await relatorioEmpresas.gerar(db, req.query));
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      console.error("[GET /api/admin/reports/atividade-das-empresas]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getRelatorioUso: async (req, res) => {
    try {
      res.json(await relatorioUso.gerar(db, req.query));
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      console.error("[GET /api/admin/reports/uso-da-plataforma]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  getRelatorioPlanos: async (req, res) => {
    try {
      res.json(await relatorioPlanos.gerar(db, req.query));
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      console.error("[GET /api/admin/reports/planos-e-assinaturas]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  // Download do relatório em PDF ou Excel: /reports/<slug>.pdf | .xlsx
  exportRelatorio: (servico) => async (req, res) => {
    try {
      const r = await servico.gerar(db, req.query);
      const arq = await relatorioExport.exportar(servico.paraExport(r, req.query), req.params.formato);
      res.set({
        "Content-Type": arq.mime,
        "Content-Disposition": `attachment; filename="${servico.nomeArquivo(r, arq.ext)}"`,
        "Cache-Control": "no-store",
      });
      res.send(arq.buffer);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      console.error("[GET /api/admin/reports/:relatorio.:formato]", err.message);
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
