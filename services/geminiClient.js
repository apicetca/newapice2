// ============================================
// services/geminiClient.js
// Client único pro Gemini via SDK oficial
// (@google/genai), usando a Interactions API —
// mesma API que o projeto já usava via REST manual
// antes desta reescrita. Ponto único de configuração:
// todo serviço de IA passa por aqui, igual
// subscriptionService.js é o ponto único pra
// consulta de planos.
//
// Por que a Interactions API (não generateContent):
// testado em 2026-09-15 contra a chave configurada —
// ai.models.generateContent() retornou 404 orientando
// migrar pra "models/gemini-3.6-flash" via Interactions
// API ("We recommend you to use the Interactions API"),
// e chamadas de teste via generateContent devolveram
// 503 "high demand" de forma consistente mesmo pro
// modelo padrão. ai.interactions.create() respondeu
// normalmente nos mesmos testes — por isso o client
// usa esse namespace do SDK, não generateContent.
// ============================================
const { GoogleGenAI } = require("@google/genai");
const { askFallbackJSON } = require("./aiFallback");

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

// gemini-3.7-flash e gemini-3.8-flash foram testados em 2026-09-15
// contra a API real (ambos existem e estão listados pra esta chave) e
// os dois retornaram 503 "high demand" de forma consistente em múltiplas
// tentativas; gemini-3.6-flash respondeu em poucos segundos nos mesmos
// testes — mantido como padrão até os modelos mais novos estabilizarem.
const THINKING_LEVEL = "low";

let client = null;
function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY não configurada.");
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

// Remove cercas ```json / ``` que o modelo às vezes inclui mesmo
// quando response_format pede JSON puro, antes do JSON.parse.
function stripCodeFences(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function extractOutputText(interaction) {
  const outputStep = interaction.steps?.find(s => s.type === "model_output");
  return outputStep?.content?.find(c => c.type === "text")?.text ?? "";
}

function extractFunctionCalls(interaction) {
  return (interaction.steps ?? []).filter(s => s.type === "function_call");
}

// Timeout aplicado manualmente via Promise.race — a opção nativa do SDK
// (RequestOptions.timeout_ms) foi testada em 2026-09-28 e não interrompe
// a chamada de verdade: com timeout_ms:3000, uma chamada que devolveu
// 429 (rate limit) só retornou depois de 34s, ou seja, a própria API
// demora a responder o erro e o SDK não aborta antes disso. Sem este
// timeout manual, uma chamada lenta ao Gemini poderia travar o fallback
// (services/aiFallback.js) por dezenas de segundos antes dele sequer
// começar a tentar o próximo provedor.
const GEMINI_TIMEOUT_MS = 15000;

async function callInteractions(params) {
  try {
    return await Promise.race([
      getClient().interactions.create(params),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout de ${GEMINI_TIMEOUT_MS}ms excedido.`)), GEMINI_TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    // Nunca logar a API key — só status e mensagem do provedor.
    const status = err.status ?? err.response?.status;
    const providerMessage = err.message ?? String(err);
    console.error(`[gemini-client] Falha na chamada (modelo ${MODEL})`, {
      status: status ?? "sem resposta",
      motivo: providerMessage,
    });
    throw new Error(`Falha ao chamar a IA (Gemini): ${providerMessage}`);
  }
}

// --------------------------------------------
// Pede uma resposta em JSON estruturado ao Gemini — sem memória de
// conversa (cada chamada é isolada). Mantido como a função mais usada
// do projeto: a maioria dos serviços de IA (análise de perfil, resumo
// de candidato, insights de mercado, etc.) faz uma pergunta e recebe
// uma resposta, sem precisar de conversa contínua.
//
// system:    instruções de contexto (papel, formato esperado)
// prompt:    conteúdo da requisição (dados já filtrados pro LGPD)
// maxTokens: teto de tokens de saída — IMPORTANTE: o Gemini soma os
//            tokens de "thinking" interno dentro desse teto, então
//            precisa de folga (visto na prática: ~400-450 tokens só
//            de thinking mesmo com thinking_level "low", antes de
//            começar a gerar a resposta em si).
// responseSchema: opcional — JSON Schema que a resposta deve seguir.
//            Reforça (mas não substitui) o formato pedido no prompt.
// --------------------------------------------
// Tenta o Gemini primeiro; se falhar (cota esgotada, 5xx, timeout,
// etc.), cai pro fallback multi-provedor (services/aiFallback.js —
// Groq/Cerebras/Mistral/OpenRouter, gratuitos, formato OpenAI). Só
// askGeminiJSON tem esse fallback — chatTurn/sendFunctionResults
// (usados só pelo mentor, que depende de memória/tools nativos do
// Gemini) continuam exclusivamente no Gemini.
async function askGeminiJSON({ system, prompt, maxTokens = 2048, responseSchema }) {
  try {
    return await askGeminiJSONOnly({ system, prompt, maxTokens, responseSchema });
  } catch (err) {
    console.error(`[gemini-client] Gemini falhou, tentando fallback multi-provedor:`, err.message);
    return askFallbackJSON({ system, prompt, maxTokens });
  }
}

async function askGeminiJSONOnly({ system, prompt, maxTokens = 2048, responseSchema }) {
  const interaction = await callInteractions({
    model: MODEL,
    input: prompt,
    system_instruction: system,
    response_format: {
      type: "text",
      mime_type: "application/json",
      ...(responseSchema ? { schema: responseSchema } : {}),
    },
    generation_config: {
      max_output_tokens: maxTokens,
      thinking_level: THINKING_LEVEL,
    },
  });

  const text = extractOutputText(interaction);
  if (!text) {
    console.error(`[gemini-client] Resposta vazia da IA (modelo ${MODEL})`);
    throw new Error("A IA não retornou nenhum conteúdo.");
  }

  try {
    return JSON.parse(stripCodeFences(text));
  } catch {
    // Gemini não retornou JSON válido apesar do pedido no prompt —
    // trata como falha de integração, não derruba o processo chamador.
    console.error(`[gemini-client] Resposta não é JSON válido (modelo ${MODEL}):`, text.slice(0, 200));
    throw new Error("Resposta da IA não veio em JSON válido.");
  }
}

// --------------------------------------------
// Conversa com memória real e (opcionalmente) function calling — usa
// previous_interaction_id da Interactions API pra encadear o contexto
// do lado do provedor, em vez de reconstruir o histórico como texto
// a cada chamada.
//
// system:               system instruction da conversa
// input:                mensagem do usuário nesta chamada
// previousInteractionId: id da interação anterior (null na 1ª mensagem)
// tools:                 array de declarações de função (opcional)
// maxTokens, thinkingLevel: mesma semântica de askGeminiJSON
//
// Retorna { interactionId, text, functionCalls } — se functionCalls
// não estiver vazio, o texto pode vir vazio (o modelo pediu pra
// executar uma ferramenta antes de responder); quem chama deve
// executar as funções e mandar o resultado de volta via
// sendFunctionResults antes de considerar a resposta final.
// --------------------------------------------
async function chatTurn({ system, input, previousInteractionId, tools, maxTokens = 2048, thinkingLevel = THINKING_LEVEL }) {
  const interaction = await callInteractions({
    model: MODEL,
    input,
    system_instruction: system,
    previous_interaction_id: previousInteractionId || undefined,
    tools: tools?.length ? tools : undefined,
    generation_config: {
      max_output_tokens: maxTokens,
      thinking_level: thinkingLevel,
    },
  });

  return {
    interactionId: interaction.id,
    text: extractOutputText(interaction),
    functionCalls: extractFunctionCalls(interaction),
  };
}

// Envia os resultados de function calling de volta pro Gemini, encadeado
// na mesma interação (previousInteractionId = id da interação que pediu
// as chamadas), pra ele formular a resposta final usando os dados reais.
async function sendFunctionResults({ system, previousInteractionId, results, tools, maxTokens = 2048, thinkingLevel = THINKING_LEVEL }) {
  const interaction = await callInteractions({
    model: MODEL,
    input: results.map(r => ({
      type: "function_result",
      id: r.id,
      name: r.name,
      response: r.response,
    })),
    system_instruction: system,
    previous_interaction_id: previousInteractionId,
    tools: tools?.length ? tools : undefined,
    generation_config: {
      max_output_tokens: maxTokens,
      thinking_level: thinkingLevel,
    },
  });

  return {
    interactionId: interaction.id,
    text: extractOutputText(interaction),
    functionCalls: extractFunctionCalls(interaction),
  };
}

module.exports = { askGeminiJSON, chatTurn, sendFunctionResults, MODEL };
