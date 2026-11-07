// ============================================
// services/userContextService.js
// Monta um contexto pequeno e relevante do usuário
// pra IA — nunca o "banco inteiro". Cada função
// retorna só o pedaço necessário pra um tipo de
// pergunta; quem chama decide quais montar.
//
// LGPD: nenhuma função aqui retorna nome completo,
// e-mail ou qualquer dado pessoal — só sinais
// técnicos (skills, nível, progresso), igual ao
// padrão já usado em mentorChat.js.
// ============================================
const db = require("../database/db");
const { getUserPlan } = require("./subscriptionService");

const MAX_SKILLS = 20;
const MAX_REPOS = 10;

// Skills detectadas (GitHub) ou adicionadas manualmente, com confiança.
async function getSkillsSummary(githubId) {
  const [skills] = await db.query(
    `SELECT s.name, s.type, us.confidence
     FROM user_skills us
     JOIN skills s ON s.id = us.skill_id
     WHERE us.github_id = ?
     ORDER BY us.confidence DESC
     LIMIT ?`,
    [githubId, MAX_SKILLS]
  );
  return skills.map(s => ({ nome: s.name, tipo: s.type, confianca: s.confidence }));
}

// Repositórios públicos importados (portfólio) — só nome/linguagem/descrição.
async function getReposSummary(userId) {
  const [repos] = await db.query(
    `SELECT repo_name, language, description, ai_description
     FROM user_repositories
     WHERE user_id = ? AND is_public = 1
     ORDER BY updated_at_gh DESC
     LIMIT ?`,
    [userId, MAX_REPOS]
  );
  return repos.map(r => ({
    nome: r.repo_name,
    linguagem: r.language,
    descricao: r.ai_description || r.description || null,
  }));
}

// Nível auto-declarado/estimado do dev.
async function getNivel(userId) {
  const [[row]] = await db.query(
    "SELECT nivel FROM user_dev_profiles WHERE user_id = ?",
    [userId]
  );
  return row?.nivel ?? null;
}

// Progresso de roadmap em vagas que o usuário já está acompanhando —
// só o resumo (skill + status), não o roadmap inteiro por vaga.
async function getRoadmapProgressSummary(githubId) {
  const [rows] = await db.query(
    `SELECT s.name AS skill_name, urp.status, j.title AS job_title
     FROM user_roadmap_progress urp
     JOIN skills s ON s.id = urp.skill_id
     JOIN jobs j   ON j.id = urp.job_id
     WHERE urp.github_id = ? AND urp.status != 'nao_iniciado'
     ORDER BY urp.completed_at DESC, urp.id DESC
     LIMIT ?`,
    [githubId, MAX_SKILLS]
  );
  return rows.map(r => ({ skill: r.skill_name, status: r.status, vaga: r.job_title }));
}

// Resumo do roadmap ATIVO do sistema novo (fases/etapas via IA, /trilha —
// docs/roadmap-spec.md, "Integrações": "recebe o roadmap ativo e a etapa
// atual como contexto"). Função separada de getRoadmapProgressSummary
// acima, que é do sistema antigo (gap de skills por vaga) — os dois
// convivem, ver docs/roadmap-diagnostico.md.
async function getRoadmapAtivoSummary(usuarioId) {
  const [[roadmap]] = await db.query(
    `SELECT id, tipo_objetivo, area, vaga_id FROM roadmaps
     WHERE usuario_id = ? AND status = 'ativo'
     ORDER BY gerado_em DESC LIMIT 1`,
    [usuarioId]
  );
  if (!roadmap) return null;

  let objetivo;
  if (roadmap.tipo_objetivo === "area") {
    objetivo = `área de ${roadmap.area}`;
  } else {
    const [[job]] = await db.query("SELECT title FROM jobs WHERE id = ?", [roadmap.vaga_id]);
    objetivo = job ? `vaga "${job.title}"` : "uma vaga";
  }

  const [fases] = await db.query(
    "SELECT id, nome FROM roadmap_fases WHERE roadmap_id = ? ORDER BY ordem",
    [roadmap.id]
  );
  if (!fases.length) return { objetivo, faseAtual: null, etapaAtual: null, faltam: 0 };

  const [etapas] = await db.query(
    "SELECT fase_id, titulo, status FROM roadmap_etapas WHERE fase_id IN (?) ORDER BY fase_id, ordem",
    [fases.map(f => f.id)]
  );
  const etapasPorFase = {};
  for (const e of etapas) (etapasPorFase[e.fase_id] ??= []).push(e);

  // "fase atual" = a primeira com alguma etapa não concluída.
  let faseAtual = null, etapaAtual = null, faltam = 0;
  for (const f of fases) {
    const pendentes = (etapasPorFase[f.id] ?? []).filter(e => e.status !== "concluida");
    if (!faseAtual && pendentes.length) { faseAtual = f.nome; etapaAtual = pendentes[0].titulo; }
    faltam += pendentes.length;
  }
  return { objetivo, faseAtual, etapaAtual, faltam };
}

// Monta o bloco de texto "CONTEXTO DO USUÁRIO" pra injetar no prompt —
// só com as seções pedidas em `include`, pra nunca mandar mais dado do
// que a pergunta atual precisa.
//
// include: subconjunto de { skills, repos, nivel, roadmap }
async function buildUserContextBlock(user, include = ["skills", "nivel"]) {
  const githubId = user.github_id ?? user.id;
  const parts = [];

  if (include.includes("nivel")) {
    const nivel = await getNivel(user.id);
    if (nivel) parts.push(`Nível: ${nivel}`);
  }

  if (include.includes("skills")) {
    const skills = await getSkillsSummary(githubId);
    if (skills.length) {
      const lista = skills.map(s => `${s.nome} (${s.tipo}, confiança ${s.confianca}%)`).join(", ");
      parts.push(`Skills conhecidas: ${lista}`);
    } else {
      parts.push("Skills conhecidas: nenhuma detectada ainda");
    }
  }

  if (include.includes("repos")) {
    const repos = await getReposSummary(user.id);
    if (repos.length) {
      const lista = repos.map(r => `${r.nome} (${r.linguagem ?? "?"})${r.descricao ? `: ${r.descricao}` : ""}`).join("; ");
      parts.push(`Projetos no portfólio: ${lista}`);
    }
  }

  if (include.includes("roadmap")) {
    const progresso = await getRoadmapProgressSummary(githubId);
    if (progresso.length) {
      const lista = progresso.map(p => `${p.skill} (${p.status}, vaga: ${p.vaga})`).join("; ");
      parts.push(`Progresso em roadmaps: ${lista}`);
    }
  }

  // Try/catch isolado: uma falha aqui (ex. banco fora do ar num detalhe
  // específico) nunca derruba o restante do contexto (skills/nível), nem
  // o mentor — ele só segue sem a linha de roadmap, como se não houvesse.
  if (include.includes("roadmapAtivo")) {
    try {
      const r = await getRoadmapAtivoSummary(user.id);
      if (r) {
        parts.push(r.faseAtual
          ? `Roadmap ativo: ${r.objetivo} — fase atual "${r.faseAtual}", etapa atual "${r.etapaAtual}", ${r.faltam} etapa(s) restante(s).`
          : `Roadmap ativo: ${r.objetivo} — todas as etapas concluídas.`);
      }
    } catch (err) {
      console.error("[userContextService] falha ao montar resumo do roadmap ativo:", err.message);
    }
  }

  if (!parts.length) return "";
  return `CONTEXTO DO USUÁRIO\n${parts.join("\n")}`;
}

// ──────────────────────────────────────────────────────────
// Resumo para o Mentor de carreira (services/mentorChat.js), montado a cada
// pergunta: nível e plano, skills da análise do perfil, repositórios,
// roadmaps com o progresso e candidaturas. Só dados técnicos e de
// progresso — nunca nome, e-mail, senha ou dado de pagamento (o plano vai
// só pelo nome). Cada parte é isolada: se uma consulta falhar, o resumo
// sai sem ela, e o mentor responde mesmo assim.
// ──────────────────────────────────────────────────────────
const MENTOR_MAX_SKILLS = 15;
const MENTOR_MAX_REPOS = 8;
const MENTOR_MAX_CANDIDATURAS = 5;
const MENTOR_PROXIMAS_ETAPAS = 3;

const STATUS_ETAPA = { pendente: "pendente", em_andamento: "em andamento", concluida: "concluída" };
const STATUS_PROJETO = {
  pendente: "projeto pendente",
  em_revisao: "projeto em revisão",
  verificado: "projeto verificado",
  nao_verificado: "projeto entregue (não verificado)",
};

const curto = (texto, max = 120) => (texto && texto.length > max ? `${texto.slice(0, max)}…` : texto);
const pct = (feitas, total) => (total ? Math.round((feitas / total) * 100) : 0);

async function mentorNivelEPlano(userId) {
  const [nivel, plano] = await Promise.all([getNivel(userId), getUserPlan(userId, "dev")]);
  const partes = [];
  if (nivel) partes.push(`Nível: ${nivel}`);
  if (plano?.name) partes.push(`Plano: ${plano.name}`);
  return partes.join(" · ") || null;
}

async function mentorSkills(githubId) {
  const skills = (await getSkillsSummary(githubId)).slice(0, MENTOR_MAX_SKILLS);
  if (!skills.length) return "Skills (análise do perfil): nenhuma detectada ainda.";
  return `Skills (análise do perfil, com a confiança): ${skills.map(s => `${s.nome} ${s.confianca}%`).join(", ")}`;
}

async function mentorRepositorios(userId) {
  const [[contagem]] = await db.query(
    "SELECT COUNT(*) AS total, COALESCE(SUM(is_public = 1), 0) AS visiveis FROM user_repositories WHERE user_id = ?",
    [userId]
  );
  const total = Number(contagem?.total ?? 0);
  if (!total) return "Repositórios no perfil: nenhum ainda.";
  const visiveis = (await getReposSummary(userId)).slice(0, MENTOR_MAX_REPOS);
  const lista = visiveis.map(r => `${r.nome} (${r.linguagem ?? "linguagem não informada"})${r.descricao ? `: ${curto(r.descricao)}` : ""}`);
  return `Repositórios no perfil: ${total} (${Number(contagem.visiveis)} visíveis no perfil público)`
    + (lista.length ? `. Visíveis: ${lista.join("; ")}` : "");
}

async function mentorRoadmaps(usuarioId) {
  const [roadmaps] = await db.query(
    `SELECT r.id, r.tipo_objetivo, r.area, r.horas_semana, r.status, r.origem, j.title AS vaga_titulo
     FROM roadmaps r LEFT JOIN jobs j ON j.id = r.vaga_id
     WHERE r.usuario_id = ?
     ORDER BY (r.status = 'ativo') DESC, r.gerado_em DESC`,
    [usuarioId]
  );
  if (!roadmaps.length) return "Roadmap: nenhum criado ainda.";

  const ativos = roadmaps.filter(r => r.status === "ativo");
  const arquivados = roadmaps.length - ativos.length;
  if (!ativos.length) return `Roadmap: nenhum ativo (${arquivados} arquivado${arquivados === 1 ? "" : "s"}).`;

  const atual = ativos[0];
  const [fases] = await db.query(
    "SELECT id, nome, projeto_status FROM roadmap_fases WHERE roadmap_id = ? ORDER BY ordem",
    [atual.id]
  );
  const [etapas] = fases.length
    ? await db.query(
        "SELECT fase_id, titulo, habilidade, horas_estimadas, status FROM roadmap_etapas WHERE fase_id IN (?) ORDER BY fase_id, ordem",
        [fases.map(f => f.id)]
      )
    : [[]];

  const objetivo = atual.tipo_objetivo === "area"
    ? `área ${atual.area}`
    : atual.vaga_titulo ? `vaga "${atual.vaga_titulo}"` : "uma vaga que não está mais disponível";
  const origem = atual.origem === "modelo" ? "montado a partir do roadmap-modelo (dá para regenerar)" : "montado pela IA";
  const concluidas = etapas.filter(e => e.status === "concluida").length;

  const linhas = [
    `Roadmap ativo: ${objetivo} · ${atual.horas_semana}h/semana · ${origem} · `
      + `${pct(concluidas, etapas.length)}% concluído (${concluidas} de ${etapas.length} etapas)`,
  ];
  if (fases.length) {
    linhas.push("Fases:");
    fases.forEach((f, i) => {
      const daFase = etapas.filter(e => e.fase_id === f.id);
      const feitas = daFase.filter(e => e.status === "concluida").length;
      linhas.push(`${i + 1}. ${f.nome} — ${pct(feitas, daFase.length)}% (${feitas}/${daFase.length} etapas) · ${STATUS_PROJETO[f.projeto_status] ?? "projeto pendente"}`);
    });
  }
  // Na ordem das fases: as etapas ainda não concluídas, as em andamento antes.
  const ordemDaFase = new Map(fases.map((f, i) => [f.id, i]));
  const prioridade = e => (e.status === "em_andamento" ? 0 : 1);
  const proximas = etapas
    .filter(e => e.status !== "concluida")
    .sort((a, b) => (ordemDaFase.get(a.fase_id) - ordemDaFase.get(b.fase_id)) || (prioridade(a) - prioridade(b)))
    .slice(0, MENTOR_PROXIMAS_ETAPAS);
  linhas.push(proximas.length
    ? `Próximas etapas: ${proximas.map(e => `"${e.titulo}" (${e.habilidade}, ~${e.horas_estimadas}h, ${STATUS_ETAPA[e.status] ?? e.status})`).join("; ")}`
    : "Próximas etapas: nenhuma — todas as etapas estão concluídas.");

  const outrosAtivos = ativos.length - 1;
  if (outrosAtivos || arquivados) {
    linhas.push(`Outros roadmaps: ${outrosAtivos} ativo${outrosAtivos === 1 ? "" : "s"}, ${arquivados} arquivado${arquivados === 1 ? "" : "s"}.`);
  }
  return linhas.join("\n");
}

async function mentorCandidaturas(githubId) {
  const [[contagem]] = await db.query(
    "SELECT COUNT(*) AS total FROM job_applications WHERE dev_github_id = ?",
    [githubId]
  );
  const total = Number(contagem?.total ?? 0);
  if (!total) return "Candidaturas: nenhuma ainda.";
  const [recentes] = await db.query(
    `SELECT j.title, j.company, ja.created_at
     FROM job_applications ja JOIN jobs j ON j.id = ja.job_id
     WHERE ja.dev_github_id = ?
     ORDER BY ja.created_at DESC LIMIT ?`,
    [githubId, MENTOR_MAX_CANDIDATURAS]
  );
  const lista = recentes.map(c => `${c.title} (${c.company}, ${new Date(c.created_at).toLocaleDateString("pt-BR")})`);
  return `Candidaturas: ${total}${lista.length ? ` — mais recentes: ${lista.join("; ")}` : ""}`;
}

async function buildMentorContext(user) {
  const githubId = user.github_id ?? user.id;
  const partes = await Promise.allSettled([
    mentorNivelEPlano(user.id),
    mentorSkills(githubId),
    mentorRepositorios(user.id),
    mentorRoadmaps(user.id),
    mentorCandidaturas(githubId),
  ]);

  const linhas = [];
  for (const parte of partes) {
    if (parte.status === "fulfilled" && parte.value) linhas.push(parte.value);
    if (parte.status === "rejected") console.error("[userContextService] resumo do mentor sem uma das partes:", parte.reason?.message);
  }
  if (!linhas.length) return "";
  return "DADOS DO USUÁRIO (consultados agora no banco do Ápice — use para personalizar a resposta e não invente o que não estiver aqui)\n"
    + linhas.join("\n");
}

module.exports = {
  getSkillsSummary,
  getReposSummary,
  getNivel,
  getRoadmapProgressSummary,
  getRoadmapAtivoSummary,
  buildUserContextBlock,
  buildMentorContext,
};
