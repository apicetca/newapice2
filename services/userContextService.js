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
// padrão já usado em mentorChat.js/aiProfileAnalyzer.js.
// ============================================
const db = require("../database/db");

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

  if (!parts.length) return "";
  return `CONTEXTO DO USUÁRIO\n${parts.join("\n")}`;
}

module.exports = {
  getSkillsSummary,
  getReposSummary,
  getNivel,
  getRoadmapProgressSummary,
  buildUserContextBlock,
};
