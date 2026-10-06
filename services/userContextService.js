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

module.exports = {
  getSkillsSummary,
  getReposSummary,
  getNivel,
  getRoadmapProgressSummary,
  getRoadmapAtivoSummary,
  buildUserContextBlock,
};
