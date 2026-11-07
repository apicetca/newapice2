// ============================================
// services/aiFallback.js
// Fallback multi-provedor pra chamadas de IA que
// não dependem de memória de conversa nem function
// calling nativos do Gemini — usado só dentro de
// services/geminiClient.js::askGeminiJSON, então os
// 5 serviços consumidores (candidateSummarizer,
// marketInsights, matchCalculator, portfolioDescriber,
// roadmapGenerator) ganham fallback automático sem
// precisar de nenhuma alteração.
//
// mentorChat.js (memória via previous_interaction_id +
// tools) só usa askFallbackText, quando o Gemini falha:
// a resposta sai daqui em texto, com as últimas
// mensagens da conversa como contexto e SEM as tools —
// elas estão no formato do @google/genai, sem tradução
// pro formato OpenAI-compatible destes provedores.
//
// Todos os provedores abaixo falam o formato de API da
// OpenAI (chat completions) — por isso o SDK oficial
// `openai` funciona com todos, só trocando baseURL/key.
// ============================================
const OpenAI = require("openai");
const { ErroIA } = require("./iaErros");

// Provedor sem chave configurada é ignorado automaticamente —
// nunca quebra o app por falta de uma env var opcional.
const PROVIDERS = {
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
  },
  cerebras: {
    baseURL: "https://api.cerebras.ai/v1",
    apiKeyEnv: "CEREBRAS_API_KEY",
  },
  mistral: {
    baseURL: "https://api.mistral.ai/v1",
    apiKeyEnv: "MISTRAL_API_KEY",
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
  },
};

// Nomes de modelo dos provedores gratuitos mudam com frequência —
// confira no painel de cada provedor antes de assumir que estes
// ainda existem (groq.com/docs/models, cerebras.ai, mistral.ai,
// openrouter.ai/models). Cada entrada é { provider, model }; a
// primeira da lista é o principal, as seguintes são fallback em ordem.
//
// "askGeminiJSON" (geminiClient.js) é sempre a primeira tentativa,
// antes desta lista — FALLBACK_CHAIN só entra em ação se o Gemini
// falhar.
//
// Testado em 2026-09-28 contra chaves reais de Groq e OpenRouter:
//
// - groq/llama-3.3-70b-versatile foi descontinuado (404 "does not
//   exist") — trocado por openai/gpt-oss-120b (modelo open-weight da
//   OpenAI hospedado no Groq), que respondeu corretamente.
// - Modelos ":free" do OpenRouter usam um pool de cota compartilhado
//   entre TODOS os usuários da plataforma (não é cota sua exclusiva):
//   qwen/qwen3-coder:free foi descontinuado, o sucessor
//   qwen/qwen3.8-27b:free ficou consistentemente saturado, e o atual
//   nvidia/nemotron-3-super-120b-a12b:free também já retornou
//   "temporarily overloaded" ocasionalmente — esperado nesse tipo de
//   modelo. Confira o catálogo em groq.com/docs/models e
//   openrouter.ai/models antes de assumir que estes nomes continuam
//   válidos — mudam com frequência.
const FALLBACK_CHAIN = [
  { provider: "groq", model: "openai/gpt-oss-120b" },
  { provider: "cerebras", model: "llama-3.3-70b" },
  { provider: "mistral", model: "mistral-small-latest" },
  { provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free" },
];

// 30s por tentativa somava rápido: quando o Gemini falha (cota esgotada)
// e a cadeia inteira de fallback precisa rodar, o pior caso ficava perto
// de 40s no total (medido em 2026-09-28), estourando timeouts de 10s no
// frontend (ex: roadmap.ejs). Respostas reais de provedor levam 1-3s —
// 12s já cobre folga generosa sem deixar um provedor travado consumir
// quase meio minuto sozinho antes de passar pro próximo da cadeia.
const TIMEOUT_MS = 12000;

// Prazo da cadeia inteira: sem ele, quatro provedores lentos somariam 48s
// (4 × 12s) depois do tempo já gasto com o Gemini. Com os 20s do Gemini
// (geminiClient.js), uma chamada de askGeminiJSON termina em até ~40s —
// dentro dos 45s que o roadmap.ejs espera.
const TOTAL_MS = 20000;

const clients = {};
function getProviderClient(provider) {
  const config = PROVIDERS[provider];
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) return null;

  if (!clients[provider]) {
    clients[provider] = new OpenAI({
      apiKey,
      baseURL: config.baseURL,
      timeout: TIMEOUT_MS,
      // O SDK repete 2× por padrão (com espera) antes de desistir — aqui isso
      // só atrasava a ida pro próximo provedor da cadeia, que já é o retry.
      maxRetries: 0,
      ...(provider === "openrouter"
        ? {
            defaultHeaders: {
              "HTTP-Referer": process.env.APP_URL || "https://newapice22.onrender.com",
              "X-Title": "Ápice",
            },
          }
        : {}),
    });
  }
  return clients[provider];
}

// Remove cercas ```json / ``` que alguns modelos incluem mesmo
// pedindo JSON puro. parseJsonLoose também é usado pelo geminiClient.js.
function stripCodeFences(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

// Alguns modelos gratuitos (ex.: nvidia/nemotron, que "pensa em voz alta")
// prefixam a resposta com texto de raciocínio antes do JSON, mesmo
// instruídos a responder só JSON — testado em 2026-09-28. Extrai o maior
// bloco { ... } do texto como segunda tentativa antes de desistir.
function extractJsonBlock(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start, end + 1);
}

function parseJsonLoose(text) {
  const cleaned = stripCodeFences(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const block = extractJsonBlock(cleaned);
    if (!block) throw new Error("resposta não contém JSON.");
    return JSON.parse(block);
  }
}

// Campos de texto obrigatórios que vieram ausentes ou vazios no JSON.
function camposFaltando(resultado, obrigatorios = []) {
  return obrigatorios.filter(campo => typeof resultado?.[campo] !== "string" || !resultado[campo].trim());
}

// Uma chamada de chat completions num provedor. Devolve o texto e se ele
// parou no teto de tokens (finish_reason "length").
async function completar(provider, model, { messages, maxTokens, temperature }, timeoutMs) {
  const client = getProviderClient(provider);
  if (!client) {
    throw new Error(`${provider}: sem chave configurada (env var ${PROVIDERS[provider].apiKeyEnv}).`);
  }

  const completion = await client.chat.completions.create(
    { model, messages, max_tokens: maxTokens, temperature },
    { timeout: timeoutMs },
  );

  // A OpenRouter (e possivelmente outros provedores atrás do mesmo SDK)
  // às vezes devolve HTTP 200 com um erro embutido no corpo em vez de um
  // status de erro de verdade — ex.: modelo upstream sobrecarregado. Sem
  // checar isso explicitamente, completion.choices vem undefined e o
  // provedor era erroneamente reportado como "resposta vazia" em vez do
  // motivo real.
  if (completion.error) {
    throw new Error(`${provider}/${model}: ${completion.error.message || JSON.stringify(completion.error)}`);
  }

  const choice = completion.choices?.[0];
  const text = choice?.message?.content ?? "";
  if (!text) throw new Error(`${provider}/${model}: resposta vazia.`);
  return { text, cortada: choice.finish_reason === "length" };
}

// Tenta cada provedor da cadeia em ordem, pulando os que não têm chave
// configurada, até um responder algo que `interpretar` aceite — ou o prazo
// acabar. Nunca expõe detalhes técnicos/chaves: só loga, no servidor, qual
// provedor falhou e por quê (a mensagem do SDK já traz o status HTTP).
//
// prazo: instante (Date.now()) até quando a cadeia pode rodar, se quem chama
// tiver um prazo menor que TOTAL_MS a respeitar.
async function percorrerCadeia(pedido, interpretar, prazo = Infinity) {
  const fim = Math.min(Date.now() + TOTAL_MS, prazo);
  const errors = [];

  for (const { provider, model } of FALLBACK_CHAIN) {
    const restante = fim - Date.now();
    if (restante < 1000) {
      errors.push("prazo esgotado");
      break;
    }
    try {
      const resposta = await completar(provider, model, pedido, Math.min(TIMEOUT_MS, restante));
      return interpretar(resposta, provider, model);
    } catch (err) {
      const motivo = err.message || String(err);
      console.error(`[ai-fallback] Falha em ${provider}/${model}:`, motivo);
      errors.push(`${provider}: ${motivo}`);
    }
  }

  console.error("[ai-fallback] Todos os provedores de fallback falharam:", errors.join(" | "));
  throw new ErroIA("A IA está indisponível no momento. Tente novamente em alguns minutos.", {
    tipo: "indisponivel",
    temporario: true,
  });
}

// obrigatorios: campos de texto que o JSON tem que trazer preenchidos (mesma
// semântica de askGeminiJSON) — sem eles, passa pro próximo provedor.
async function askFallbackJSON({ system, prompt, maxTokens = 2048, temperature = 0.5, obrigatorios = [], prazo }) {
  const messages = [
    { role: "system", content: system },
    { role: "user", content: prompt },
  ];

  return percorrerCadeia({ messages, maxTokens, temperature }, ({ text, cortada }, provider, model) => {
    // JSON cortado no teto de tokens não fecha — melhor o próximo provedor.
    if (cortada) throw new Error(`${provider}/${model}: resposta cortada no teto de ${maxTokens} tokens.`);
    let resultado;
    try {
      resultado = parseJsonLoose(text);
    } catch {
      console.error(`[ai-fallback] ${provider}/${model} não devolveu JSON válido:`, text.slice(0, 500));
      throw new Error(`${provider}/${model}: resposta não veio em JSON válido.`);
    }
    const faltando = camposFaltando(resultado, obrigatorios);
    if (faltando.length) {
      console.error(`[ai-fallback] ${provider}/${model} respondeu sem ${faltando.join(", ")}:`, text.slice(0, 500));
      throw new Error(`${provider}/${model}: resposta sem ${faltando.join(", ")}.`);
    }
    return { ...resultado, __provider: provider, __model: model };
  }, prazo);
}

// Resposta em texto livre, usada pelo mentor quando o Gemini falha.
// messages: a conversa no formato OpenAI ({ role: "user" | "assistant",
// content }), sem a mensagem de sistema. Devolve { text, cortada, provider,
// model } — cortada: a resposta parou no teto de tokens.
async function askFallbackText({ system, messages, maxTokens = 2048, temperature = 0.7, prazo }) {
  return percorrerCadeia(
    { messages: [{ role: "system", content: system }, ...messages], maxTokens, temperature },
    (resposta, provider, model) => ({ ...resposta, provider, model }),
    prazo,
  );
}

module.exports = { askFallbackJSON, askFallbackText, parseJsonLoose, camposFaltando, FALLBACK_CHAIN, PROVIDERS };
