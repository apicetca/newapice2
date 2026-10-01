// ============================================
// services/interviewSimulator.js
// Simulador de entrevista técnica — gera perguntas
// a partir da vaga + perfil do candidato, e feedback
// sobre a resposta em texto. Exclusivo plano PRO.
// ============================================
const db = require("../database/db");
const { askGeminiJSON } = require("./geminiClient");

const QUESTION_SYSTEM_PROMPT = `Você é um entrevistador técnico. A partir dos requisitos de
uma vaga e do nível do candidato, gere UMA pergunta técnica objetiva, adequada ao nível
informado. Responda SEMPRE em JSON puro (sem markdown) no formato exato:
{ "pergunta": "string" }`;

const FEEDBACK_SYSTEM_PROMPT = `Você é um entrevistador técnico dando feedback sobre a
resposta de um candidato a uma pergunta técnica. Seja construtivo e específico. Responda
SEMPRE em JSON puro (sem markdown) no formato exato:
{ "feedback": "string (3-5 frases, aponta acertos e pontos de melhoria)" }`;

// Gera uma pergunta técnica a partir do perfil (nível, skills) e,
// opcionalmente, dos requisitos de uma vaga específica.
// LGPD: só nível, skills e requisitos da vaga vão pro prompt.
async function gerarPergunta(userId, githubId, nivel, jobId = null) {
  const [skills] = await db.query(
    `SELECT s.name FROM user_skills us JOIN skills s ON s.id = us.skill_id
     WHERE us.github_id = ? ORDER BY us.confidence DESC LIMIT 10`,
    [githubId]
  );

  let jobSkills = [];
  let jobTitle  = null;
  if (jobId) {
    const [job] = await db.query("SELECT title FROM jobs WHERE id = ?", [jobId]);
    jobTitle = job[0]?.title ?? null;

    const [rows] = await db.query(
      `SELECT s.name, js.importance FROM job_skills js JOIN skills s ON s.id = js.skill_id
       WHERE js.job_id = ?`,
      [jobId]
    );
    jobSkills = rows;
  }

  const payload = {
    nivel_candidato: nivel ?? "iniciante",
    skills_candidato: skills.map(s => s.name),
    vaga: jobTitle,
    requisitos_vaga: jobSkills,
  };

  const result = await askGeminiJSON({
    system: QUESTION_SYSTEM_PROMPT,
    prompt: `Gere uma pergunta de entrevista técnica para:\n${JSON.stringify(payload)}`,
    maxTokens: 1536,
  });

  const pergunta = result.pergunta ?? "Descreva um projeto seu e os desafios técnicos que enfrentou.";

  const [insert] = await db.query(
    "INSERT INTO entrevista_simulacoes (user_id, job_id, pergunta) VALUES (?, ?, ?)",
    [userId, jobId, pergunta]
  );

  return { id: insert.insertId, pergunta };
}

async function avaliarResposta(userId, simulacaoId, respostaTexto) {
  const [[simulacao]] = await db.query(
    "SELECT id, pergunta FROM entrevista_simulacoes WHERE id = ? AND user_id = ?",
    [simulacaoId, userId]
  );
  if (!simulacao) throw new Error("Simulação não encontrada.");

  const result = await askGeminiJSON({
    system: FEEDBACK_SYSTEM_PROMPT,
    prompt: `Pergunta: ${simulacao.pergunta}\n\nResposta do candidato: ${respostaTexto}`,
    maxTokens: 1792,
  });

  const feedback = result.feedback ?? "Não foi possível gerar feedback agora. Tente novamente.";

  await db.query(
    "UPDATE entrevista_simulacoes SET resposta_usuario = ?, feedback = ? WHERE id = ?",
    [respostaTexto, feedback, simulacaoId]
  );

  return { id: simulacaoId, pergunta: simulacao.pergunta, resposta_usuario: respostaTexto, feedback };
}

module.exports = { gerarPergunta, avaliarResposta };
