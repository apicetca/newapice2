// ============================================
// services/mentorChat.js
// Chat de mentoria de carreira — usa o perfil
// técnico do usuário (skills + nível) como
// contexto de sistema. Exclusivo do plano PRO.
// ============================================
const db = require("../database/db");
const { askGeminiJSON } = require("./geminiClient");

const MAX_HISTORY = 20; // últimas mensagens trazidas como contexto

async function getHistory(userId) {
  const [rows] = await db.query(
    "SELECT id, role, content, created_at FROM mentor_conversas WHERE user_id = ? ORDER BY created_at ASC",
    [userId]
  );
  return rows;
}

// Monta o prompt de sistema com skills + nível — nunca nome, e-mail
// ou qualquer outro dado pessoal do candidato (LGPD).
async function buildSystemPrompt(githubId, nivel) {
  const [skills] = await db.query(
    `SELECT s.name, s.type, us.confidence
     FROM user_skills us
     JOIN skills s ON s.id = us.skill_id
     WHERE us.github_id = ?
     ORDER BY us.confidence DESC`,
    [githubId]
  );

  const skillsList = skills.length
    ? skills.map(s => `${s.name} (${s.type}, confiança ${s.confidence}%)`).join(", ")
    : "nenhuma skill detectada ainda";

  return `Você é um mentor de carreira especializado em ajudar desenvolvedores iniciantes
a evoluir no mercado de tecnologia. Seja direto, prático e encorajador. Responda sempre
em português, em texto simples (sem markdown pesado).

Perfil técnico do candidato:
- Nível: ${nivel ?? "não informado"}
- Skills detectadas: ${skillsList}

Use esse contexto pra personalizar suas respostas sobre carreira, próximos passos de
estudo, preparação para entrevistas e posicionamento no mercado.`;
}

async function sendMessage(userId, githubId, nivel, userMessage) {
  await db.query(
    "INSERT INTO mentor_conversas (user_id, role, content) VALUES (?, 'user', ?)",
    [userId, userMessage]
  );

  const history = await getHistory(userId);
  const recent  = history.slice(-MAX_HISTORY);
  const system  = await buildSystemPrompt(githubId, nivel);

  // askGeminiJSON exige JSON estruturado — o mentor responde em
  // { "resposta": "string" } pra manter o mesmo padrão do resto da app.
  const conversationText = recent
    .map(m => `${m.role === "user" ? "Candidato" : "Mentor"}: ${m.content}`)
    .join("\n");

  const result = await askGeminiJSON({
    system: `${system}\n\nResponda SEMPRE em JSON puro (sem markdown) no formato exato: { "resposta": "string" }`,
    prompt: `Histórico da conversa até agora:\n${conversationText}\n\nResponda à última mensagem do candidato.`,
    maxTokens: 2048,
  });

  const resposta = result.resposta ?? "Desculpe, não consegui gerar uma resposta agora. Tente novamente.";

  await db.query(
    "INSERT INTO mentor_conversas (user_id, role, content) VALUES (?, 'assistant', ?)",
    [userId, resposta]
  );

  return resposta;
}

module.exports = { getHistory, sendMessage };
