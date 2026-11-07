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
const { askFallbackJSON, parseJsonLoose, camposFaltando, FALLBACK_CHAIN, PROVIDERS } = require("./aiFallback");
const { ErroIA, classificarErro, motivoDoErro, esperaSugeridaMs } = require("./iaErros");

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
    throw new ErroIA("GEMINI_API_KEY não configurada.", { tipo: "config" });
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

function extractOutputText(interaction) {
  const outputStep = interaction.steps?.find(s => s.type === "model_output");
  return outputStep?.content?.find(c => c.type === "text")?.text ?? "";
}

function extractFunctionCalls(interaction) {
  return (interaction.steps ?? []).filter(s => s.type === "function_call");
}

// "completed" é o normal e "requires_action" é o modelo pedindo ferramentas.
// "incomplete"/"budget_exceeded": parou no teto de tokens — o thinking conta
// dentro de max_output_tokens, então a resposta pode vir cortada no meio.
function respostaCortada(interaction) {
  return interaction.status === "incomplete" || interaction.status === "budget_exceeded";
}

function verificarFalha(interaction) {
  if (interaction.status === "failed" || interaction.status === "cancelled") {
    throw new ErroIA(`A IA devolveu status "${interaction.status}".`, { tipo: "sobrecarga", temporario: true });
  }
}

// --------------------------------------------
// Prazos e retry
//
// O SDK tem retry próprio ligado por padrão: até 4 tentativas em
// 408/409/429/5xx com backoff de até 30s, e o timeout_ms dele vale por
// tentativa. Com o Gemini em "high demand" (503) ou no limite de uso (429),
// a chamada ficava retentando em silêncio — por isso "uma chamada que
// devolveu 429 só retornou depois de 34s" (testado em 2026-09-28) e os logs
// do Render mostravam "Timeout de 15000ms excedido" no mentor. O antigo
// Promise.race desistia em 15s, mas a requisição continuava rodando (e
// gastando cota) por trás.
//
// Agora: retry do SDK desligado, cada tentativa com um AbortSignal que
// cancela a requisição de verdade, e no máximo GEMINI_MAX_RETRIES novas
// tentativas — só para falhas passageiras (429, 5xx, rede) e só se ainda
// couberem no prazo total. Tempo esgotado não é repetido: o prazo que
// sobra fica para o fallback.
//
// Prazos em ms, ajustáveis por variável de ambiente:
//   JSON (askGeminiJSON): tentativa GEMINI_TIMEOUT_MS (15s), total
//     GEMINI_TOTAL_MS (20s) — curtos, porque depois ainda há o fallback
//     multi-provedor (services/aiFallback.js, até 20s).
//   Conversa (mentor):    tentativa GEMINI_CHAT_TIMEOUT_MS (30s), total
//     GEMINI_CHAT_TOTAL_MS (40s) — a resposta é maior e o mentor só cai
//     no fallback depois disso.
// --------------------------------------------
function envNumero(nome, padrao) {
  const bruto = process.env[nome]?.trim();
  const valor = Number(bruto);
  return bruto && Number.isFinite(valor) && valor >= 0 ? valor : padrao;
}

function limites(tipo) {
  return tipo === "chat"
    ? { tentativaMs: envNumero("GEMINI_CHAT_TIMEOUT_MS", 30000), totalMs: envNumero("GEMINI_CHAT_TOTAL_MS", 40000) }
    : { tentativaMs: envNumero("GEMINI_TIMEOUT_MS", 15000), totalMs: envNumero("GEMINI_TOTAL_MS", 20000) };
}

const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

// Limite de uso (429): o Gemini diz quanto esperar ("Please retry in 55s";
// no plano gratuito do gemini-3.6-flash, 20 requisições por dia e 5 por
// minuto, visto em 2026-11-06). Se a espera não cabe no prazo, não adianta
// repetir; e, se passa de PAUSA_MINIMA_MS, o Gemini fica em pausa até lá —
// as chamadas vão direto para o fallback em vez de gastar uma tentativa
// (que daria 429 de novo) em cada pergunta.
const PAUSA_MINIMA_MS = 10 * 1000;
const PAUSA_MAXIMA_MS = 24 * 60 * 60 * 1000;
let pausadoAte = 0;

// prazo: instante (Date.now()) até quando a chamada pode terminar, se quem
// chama tiver um prazo maior a respeitar (ex.: a mensagem inteira do mentor).
async function callInteractions(params, { tentativaMs, totalMs }, prazo = Infinity) {
  if (Date.now() < pausadoAte) {
    throw new ErroIA(`Gemini em pausa pelo limite de uso até ${new Date(pausadoAte).toISOString()}.`, {
      tipo: "limite", status: 429, temporario: true,
    });
  }
  const fim = Math.min(Date.now() + totalMs, prazo);
  const maxRetries = envNumero("GEMINI_MAX_RETRIES", 2);

  for (let tentativa = 1; ; tentativa++) {
    const restante = fim - Date.now();
    if (restante < 1000) {
      throw new ErroIA("Prazo da chamada à IA esgotado.", { tipo: "tempo", temporario: true });
    }
    const limiteMs = Math.floor(Math.min(tentativaMs, restante)); // AbortSignal.timeout só aceita inteiro
    const sinal = AbortSignal.timeout(limiteMs);
    try {
      return await getClient().interactions.create(params, { retries: { strategy: "none" }, signal: sinal });
    } catch (err) {
      if (err instanceof ErroIA) throw err; // GEMINI_API_KEY ausente
      const info = classificarErro(err, sinal);
      const motivo = info.tipo === "tempo"
        ? `tempo esgotado (${limiteMs >= 1000 ? `${Math.round(limiteMs / 1000)}s` : `${limiteMs}ms`})`
        : motivoDoErro(err);
      // Nunca logar a API key — só status, tipo e mensagem do provedor.
      console.error(`[gemini-client] Falha na chamada (modelo ${MODEL}, tentativa ${tentativa})`, {
        status: info.status ?? "sem resposta",
        tipo: info.tipo,
        motivo,
      });

      const sugerida = info.tipo === "limite" ? esperaSugeridaMs(err) : null;
      if (sugerida >= PAUSA_MINIMA_MS) {
        pausadoAte = Date.now() + Math.min(sugerida, PAUSA_MAXIMA_MS);
        console.error(`[gemini-client] Gemini em pausa até ${new Date(pausadoAte).toISOString()} pelo limite de uso; até lá, a IA responde pelo fallback.`);
      }

      const espera = Math.max(500 * 2 ** (tentativa - 1) + Math.random() * 300, sugerida ?? 0);
      const repetir = info.temporario && info.tipo !== "tempo" && tentativa <= maxRetries
        && Date.now() + espera + 2000 < fim && Date.now() >= pausadoAte;
      if (!repetir) {
        throw new ErroIA(`Falha ao chamar a IA (Gemini): ${motivo}`, info);
      }
      await esperar(espera);
    }
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
// obrigatorios: opcional — campos de texto que a resposta tem que trazer
//            preenchidos (ex.: ["resumo"]). Sem eles a resposta conta como
//            falha, em vez de um texto vazio ir pro cache de quem chamou.
// --------------------------------------------
// Tenta o Gemini primeiro; se falhar (cota esgotada, 5xx, timeout,
// resposta cortada, fora do JSON ou sem um campo obrigatório), cai pro
// fallback multi-provedor (services/aiFallback.js — Groq/Cerebras/Mistral/
// OpenRouter, gratuitos, formato OpenAI). O mentor (chatTurn/
// sendFunctionResults) depende de memória/tools nativos do Gemini e tem o
// próprio fallback, só de texto, em services/mentorChat.js.
async function askGeminiJSON({ system, prompt, maxTokens = 2048, responseSchema, obrigatorios = [] }) {
  try {
    return await askGeminiJSONOnly({ system, prompt, maxTokens, responseSchema, obrigatorios });
  } catch (err) {
    console.error(`[gemini-client] Gemini falhou, tentando fallback multi-provedor:`, err.message);
    return askFallbackJSON({ system, prompt, maxTokens, obrigatorios });
  }
}

async function askGeminiJSONOnly({ system, prompt, maxTokens = 2048, responseSchema, obrigatorios = [] }) {
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
  }, limites("json"));
  verificarFalha(interaction);

  const text = extractOutputText(interaction);
  if (!text) {
    console.error(`[gemini-client] Resposta vazia da IA (modelo ${MODEL}, status ${interaction.status})`);
    throw new ErroIA("A IA não retornou nenhum conteúdo.", { tipo: "vazia" });
  }
  // JSON cortado no meio não serve: melhor o fallback do que um parse quebrado.
  if (respostaCortada(interaction)) {
    console.error(`[gemini-client] Resposta cortada no teto de ${maxTokens} tokens (modelo ${MODEL})`);
    throw new ErroIA("A resposta da IA veio cortada.", { tipo: "cortada" });
  }

  let resultado;
  try {
    // Tolerante: tira cercas ```json e, se vier texto antes/depois, pega o bloco { ... }.
    resultado = parseJsonLoose(text);
  } catch {
    // Gemini não retornou JSON válido apesar do pedido no prompt —
    // trata como falha de integração, não derruba o processo chamador.
    console.error(`[gemini-client] Resposta não é JSON válido (modelo ${MODEL}):`, text.slice(0, 500));
    throw new ErroIA("Resposta da IA não veio em JSON válido.", { tipo: "json" });
  }

  const faltando = camposFaltando(resultado, obrigatorios);
  if (faltando.length) {
    console.error(`[gemini-client] Resposta sem ${faltando.join(", ")} (modelo ${MODEL}):`, text.slice(0, 500));
    throw new ErroIA(`A resposta da IA veio sem ${faltando.join(", ")}.`, { tipo: "vazia" });
  }
  return resultado;
}

// --------------------------------------------
// Formato do input da Interactions API (SDK @google/genai 2.22): uma lista
// de passos — a conversa vai como passos "user_input" (usuário) e
// "model_output" (respostas anteriores), cada um com content
// [{ type: "text", text }]. Não existe campo role, e qualquer campo a mais
// (id, created_at, gemini_interaction_id… de uma linha do banco) é
// rejeitado com 400 "Unknown parameter". Por isso o input é sempre montado
// aqui, campo a campo, a partir só do papel e do texto.
// --------------------------------------------
function passoDeTexto(tipo, texto) {
  return { type: tipo, content: [{ type: "text", text: texto }] };
}

// historico: [{ role: "user" | "assistant", content: string }] — mensagens
// vazias ou sem texto são ignoradas.
function paraPassos(historico = []) {
  return historico
    .filter(m => typeof m?.content === "string" && m.content.trim())
    .map(m => passoDeTexto(m.role === "assistant" ? "model_output" : "user_input", m.content));
}

// Resultado de function calling: call_id é o id do function_call que o
// pediu. Com id/response a API devolvia 400 "Unknown parameter 'id' at
// 'input[0]'" e o mentor falhava sempre que usava uma ferramenta (visto nos
// logs do Render em 2026-11-03).
function paraResultados(results = []) {
  return results.map(r => ({ type: "function_result", call_id: r.id, name: r.name, result: r.response }));
}

// --------------------------------------------
// Conversa com function calling. A memória vai explícita a cada chamada: o
// histórico recente (quem chama limita, o mentor manda as últimas 10
// mensagens) seguido da mensagem nova — nada fica dependendo de uma
// interação guardada no provedor de uma mensagem para a outra.
//
// system:    system instruction da conversa
// historico: mensagens anteriores [{ role: "user" | "assistant", content }]
// input:     mensagem do usuário nesta chamada (texto)
// tools:     array de declarações de função (opcional)
// maxTokens, thinkingLevel: mesma semântica de askGeminiJSON
// prazo:     instante (Date.now()) até quando a chamada pode terminar — o
//            mentor passa o prazo da mensagem
//
// Retorna { interactionId, text, functionCalls, cortada } — se
// functionCalls não estiver vazio, o texto pode vir vazio (o modelo pediu
// pra executar uma ferramenta antes de responder); quem chama deve
// executar as funções e mandar o resultado de volta via
// sendFunctionResults (encadeado nesta interação) antes de considerar a
// resposta final. cortada indica que a resposta parou no teto de tokens.
// --------------------------------------------
async function chatTurn({ system, historico = [], input, tools, maxTokens = 2048, thinkingLevel = THINKING_LEVEL, prazo }) {
  const interaction = await callInteractions({
    model: MODEL,
    input: [...paraPassos(historico), passoDeTexto("user_input", String(input ?? ""))],
    system_instruction: system,
    tools: tools?.length ? tools : undefined,
    generation_config: {
      max_output_tokens: maxTokens,
      thinking_level: thinkingLevel,
    },
  }, limites("chat"), prazo);
  verificarFalha(interaction);

  return {
    interactionId: interaction.id,
    text: extractOutputText(interaction),
    functionCalls: extractFunctionCalls(interaction),
    cortada: respostaCortada(interaction),
  };
}

// Envia os resultados de function calling de volta pro Gemini, encadeado
// na mesma interação (previousInteractionId = id da interação que pediu
// as chamadas), pra ele formular a resposta final usando os dados reais.
async function sendFunctionResults({ system, previousInteractionId, results, tools, maxTokens = 2048, thinkingLevel = THINKING_LEVEL, prazo }) {
  const interaction = await callInteractions({
    model: MODEL,
    input: paraResultados(results),
    system_instruction: system,
    previous_interaction_id: previousInteractionId,
    tools: tools?.length ? tools : undefined,
    generation_config: {
      max_output_tokens: maxTokens,
      thinking_level: thinkingLevel,
    },
  }, limites("chat"), prazo);
  verificarFalha(interaction);

  return {
    interactionId: interaction.id,
    text: extractOutputText(interaction),
    functionCalls: extractFunctionCalls(interaction),
    cortada: respostaCortada(interaction),
  };
}

// O que está configurado para a IA — só se cada chave existe, nunca o
// valor. Usado no log de inicialização (server.js) e no /api/ai/health.
function configuracaoIA() {
  return {
    gemini: Boolean(process.env.GEMINI_API_KEY),
    modelo: MODEL,
    fallback: FALLBACK_CHAIN
      .filter(({ provider }) => process.env[PROVIDERS[provider].apiKeyEnv])
      .map(({ provider }) => provider),
  };
}

module.exports = { askGeminiJSON, chatTurn, sendFunctionResults, configuracaoIA, MODEL };
