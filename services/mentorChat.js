// ============================================
// services/mentorChat.js
// Chat de mentoria de carreira — assistente com
// memória real de conversa (previous_interaction_id
// da Interactions API) e function calling pra
// consultar dados reais da plataforma (vagas,
// perfil, portfólio, roadmap). Exclusivo do
// plano PRO.
// ============================================
const db = require("../database/db");
const { chatTurn, sendFunctionResults } = require("./geminiClient");
const { TOOL_DECLARATIONS, executeTool } = require("./aiTools");
const { buildUserContextBlock } = require("./userContextService");

const MAX_HISTORY = 20; // últimas mensagens trazidas na tela (histórico exibido)
const MAX_FUNCTION_CALL_ROUNDS = 4; // evita loop infinito se o modelo insistir em chamar tools

const SYSTEM_INSTRUCTION = `Você é o assistente inteligente de carreira e desenvolvimento da
plataforma Ápice — uma plataforma que conecta estudantes e desenvolvedores iniciantes a vagas
de estágio em tecnologia.

Seu papel é ajudar:
- estudantes e desenvolvedores iniciantes a evoluir na carreira;
- na busca pelo primeiro estágio;
- na análise de perfil técnico (skills, repositórios/portfólio);
- na montagem e revisão de portfólio;
- na recomendação de tecnologias para aprender;
- a explicar conceitos de programação;
- no acompanhamento de roadmaps de estudo;
- na preparação para entrevistas técnicas;
- a interpretar informações disponíveis na plataforma (vagas, roadmap, perfil).

Regras:
1. Responda sempre em português brasileiro, a menos que o usuário peça outro idioma
   explicitamente — nesse caso, responda no idioma pedido.
2. Explique conceitos técnicos de forma compreensível para quem está começando.
3. Nunca invente informações. Se não souber algo, diga isso claramente.
4. Nunca afirme ter encontrado dados (vagas, perfil, roadmap) se nenhuma ferramenta
   disponível de fato retornou esses dados — use as ferramentas quando a pergunta
   precisar de dados reais da plataforma, em vez de supor.
5. Para dúvidas de programação: identifique o problema, explique o motivo, apresente a
   solução, mostre código quando necessário, e explique as principais alterações.
6. Para portfólio/projetos: destaque pontos fortes, aponte melhorias possíveis, e adapte
   a sugestão ao nível de experiência do usuário.
7. Para busca de estágio/vagas: considere tecnologias conhecidas, experiência, projetos e
   área de interesse do usuário antes de recomendar.
8. Para roadmap: nunca recomende algo que o usuário já domina — verifique o que ele já
   sabe antes de sugerir o próximo passo, e sugira uma progressão lógica.
9. Seja conciso — evite respostas longas quando uma resposta curta resolver. Use
   listas/títulos só quando isso realmente ajudar a compreensão.
10. Seja útil e prático, nunca genérico.`;

async function getHistory(userId) {
  const [rows] = await db.query(
    "SELECT id, role, content, created_at FROM mentor_conversas WHERE user_id = ? ORDER BY created_at ASC",
    [userId]
  );
  return rows;
}

// Busca o interaction_id da última resposta do assistente pra esse
// usuário — é o que encadeia a próxima mensagem como continuação da
// mesma conversa (previous_interaction_id), em vez de uma conversa nova.
async function getLastInteractionId(userId) {
  const [[row]] = await db.query(
    `SELECT gemini_interaction_id FROM mentor_conversas
     WHERE user_id = ? AND role = 'assistant' AND gemini_interaction_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return row?.gemini_interaction_id ?? null;
}

// anexoTexto: conteúdo já extraído de um arquivo (PDF/.txt/.md) enviado
// junto da mensagem, se houver — anexado à mensagem do usuário antes de
// enviar pro Gemini e salvar, pra aparecer no histórico como contexto.
async function sendMessage(userId, githubId, nivel, userMessage, anexoTexto) {
  const content = anexoTexto
    ? `${userMessage}\n\n[Arquivo anexado]\n${anexoTexto}`
    : userMessage;

  await db.query(
    "INSERT INTO mentor_conversas (user_id, role, content) VALUES (?, 'user', ?)",
    [userId, content]
  );

  const previousInteractionId = await getLastInteractionId(userId);
  const userContext = await buildUserContextBlock({ id: userId, github_id: githubId }, ["nivel", "skills"]);
  const system = userContext ? `${SYSTEM_INSTRUCTION}\n\n${userContext}` : SYSTEM_INSTRUCTION;

  const ctx = { userId, githubId, nivel };

  let turn = await chatTurn({
    system,
    input: content,
    previousInteractionId,
    tools: TOOL_DECLARATIONS,
    maxTokens: 2048,
  });

  // Se o modelo pediu pra executar ferramentas, roda cada uma (validadas
  // em aiTools.js, nunca confiando cegamente nos argumentos do modelo) e
  // manda o resultado de volta, repetindo até ele responder em texto ou
  // até o limite de rodadas — evita loop infinito em caso de comportamento
  // inesperado do modelo.
  let rounds = 0;
  while (turn.functionCalls.length && rounds < MAX_FUNCTION_CALL_ROUNDS) {
    const results = await Promise.all(
      turn.functionCalls.map(async call => ({
        id: call.id,
        name: call.name,
        response: { output: await executeTool(call.name, call.arguments, ctx) },
      }))
    );

    turn = await sendFunctionResults({
      system,
      previousInteractionId: turn.interactionId,
      results,
      tools: TOOL_DECLARATIONS,
      maxTokens: 2048,
    });
    rounds += 1;
  }

  const resposta = turn.text || "Desculpe, não consegui gerar uma resposta agora. Tente novamente.";

  await db.query(
    "INSERT INTO mentor_conversas (user_id, role, content, gemini_interaction_id) VALUES (?, 'assistant', ?, ?)",
    [userId, resposta, turn.interactionId ?? null]
  );

  return resposta;
}

module.exports = { getHistory, sendMessage, MAX_HISTORY };
