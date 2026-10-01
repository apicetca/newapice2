// ============================================
// services/candidateSummarizer.js
// Resumo inteligente de candidatos pro recrutador
// (pontos fortes, projetos relevantes). Exclusivo
// plano Premium de empresas.
// ============================================
const db = require("../database/db");
const { askGeminiJSON } = require("./geminiClient");

const SYSTEM_PROMPT = `Você ajuda recrutadores técnicos a avaliar candidatos rapidamente.
A partir das skills e projetos de um candidato, escreva um resumo curto (2-4 frases,
em português) destacando pontos fortes e projetos relevantes pra vaga. Responda SEMPRE
em JSON puro (sem markdown) no formato exato: { "resumo": "string" }`;

async function getOrGenerateSummary(applicationId) {
  const [[application]] = await db.query(
    "SELECT id, job_id, dev_github_id, resumo_ia FROM job_applications WHERE id = ?",
    [applicationId]
  );
  if (!application) throw new Error("Candidatura não encontrada.");
  if (application.resumo_ia) return application.resumo_ia;

  const [[job]] = await db.query("SELECT title FROM jobs WHERE id = ?", [application.job_id]);

  const [skills] = await db.query(
    `SELECT s.name, us.confidence FROM user_skills us JOIN skills s ON s.id = us.skill_id
     WHERE us.github_id = ? ORDER BY us.confidence DESC LIMIT 15`,
    [application.dev_github_id]
  );

  const [repos] = await db.query(
    `SELECT ur.repo_name, ur.language, ur.description FROM user_repositories ur
     JOIN user_dev_profiles udp ON udp.user_id = ur.user_id
     WHERE udp.github_id = ? AND ur.is_public = 1`,
    [application.dev_github_id]
  );

  // LGPD: só skills e dados de projetos (nome do repo, linguagem, descrição)
  // vão pro prompt — nunca nome, e-mail ou outro dado pessoal do candidato.
  const payload = {
    vaga: job?.title ?? null,
    skills: skills.map(s => ({ nome: s.name, confianca: s.confidence })),
    projetos: repos.map(r => ({ nome: r.repo_name, linguagem: r.language, descricao: r.description })),
  };

  const result = await askGeminiJSON({
    system: SYSTEM_PROMPT,
    prompt: `Dados do candidato para resumo:\n${JSON.stringify(payload)}`,
    maxTokens: 1536,
  });

  const resumo = result.resumo ?? "Não foi possível gerar o resumo agora.";
  await db.query("UPDATE job_applications SET resumo_ia = ? WHERE id = ?", [resumo, applicationId]);

  return resumo;
}

module.exports = { getOrGenerateSummary };
