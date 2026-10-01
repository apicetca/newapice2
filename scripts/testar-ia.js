// ============================================
// scripts/testar-ia.js
// Testa a integração de IA (Gemini + fallback
// multi-provedor) fora do fluxo HTTP normal.
//
// Uso: node scripts/testar-ia.js
//
// 1. Testa askGeminiJSON normalmente (Gemini deve responder).
// 2. Testa cada provedor de fallback isoladamente (via
//    aiFallback.js), pra confirmar quais chaves estão
//    configuradas e funcionando.
// 3. Simula falha do Gemini (chave inválida temporária) e
//    confirma que o fallback assume — sem alterar o .env
//    real, só a variável de ambiente do processo filho.
// ============================================
require("dotenv").config();

const SYSTEM = "Você é um assistente de teste. Responda SEMPRE em JSON puro no formato exato: { \"resposta\": \"string\" }";
const PROMPT = "Diga oi em uma frase curta.";

async function testarGeminiDireto() {
  console.log("\n=== 1. Gemini direto (askGeminiJSON) ===");
  const { askGeminiJSON } = require("../services/geminiClient");
  try {
    const start = Date.now();
    const result = await askGeminiJSON({ system: SYSTEM, prompt: PROMPT, maxTokens: 256 });
    console.log(`OK (${Date.now() - start}ms):`, JSON.stringify(result));
  } catch (err) {
    console.log("ERRO:", err.message);
  }
}

async function testarCadaProvedorFallback() {
  console.log("\n=== 2. Cada provedor de fallback isoladamente ===");
  const { FALLBACK_CHAIN, PROVIDERS } = require("../services/aiFallback");
  const OpenAI = require("openai");

  for (const { provider, model } of FALLBACK_CHAIN) {
    const config = PROVIDERS[provider];
    const apiKey = process.env[config.apiKeyEnv];

    if (!apiKey) {
      console.log(`${provider}/${model}: SEM CHAVE (${config.apiKeyEnv} não definida) — pulado.`);
      continue;
    }

    try {
      const client = new OpenAI({ apiKey, baseURL: config.baseURL, timeout: 30000 });
      const start = Date.now();
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: PROMPT },
        ],
        max_tokens: 256,
      });
      const text = completion.choices?.[0]?.message?.content ?? "";
      console.log(`${provider}/${model}: OK (${Date.now() - start}ms):`, text.slice(0, 150));
    } catch (err) {
      console.log(`${provider}/${model}: ERRO:`, err.message);
    }
  }
}

async function testarFallbackCompleto() {
  console.log("\n=== 3. Cadeia de fallback completa (askFallbackJSON) ===");
  const { askFallbackJSON } = require("../services/aiFallback");
  try {
    const start = Date.now();
    const result = await askFallbackJSON({ system: SYSTEM, prompt: PROMPT, maxTokens: 256 });
    console.log(`OK (${Date.now() - start}ms), provedor usado: ${result.__provider}/${result.__model}:`, JSON.stringify(result));
  } catch (err) {
    console.log("ERRO (todos os provedores falharam):", err.message);
  }
}

async function testarFallbackComGeminiQuebrado() {
  console.log("\n=== 4. Simulando falha do Gemini (chave inválida) — confirma que o fallback assume ===");
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "chave-invalida-de-teste";

  // Limpa o cache do require pra forçar o geminiClient.js a reler a
  // env var (o client é um singleton lazy, mas a checagem de env var
  // acontece a cada chamada).
  delete require.cache[require.resolve("../services/geminiClient")];
  const { askGeminiJSON } = require("../services/geminiClient");

  try {
    const start = Date.now();
    const result = await askGeminiJSON({ system: SYSTEM, prompt: PROMPT, maxTokens: 256 });
    console.log(`Fallback assumiu (${Date.now() - start}ms), provedor: ${result.__provider ?? "desconhecido"}:`, JSON.stringify(result));
  } catch (err) {
    console.log("ERRO — nem o fallback funcionou:", err.message);
  } finally {
    process.env.GEMINI_API_KEY = originalKey;
    delete require.cache[require.resolve("../services/geminiClient")];
  }
}

async function main() {
  await testarGeminiDireto();
  await testarCadaProvedorFallback();
  await testarFallbackCompleto();
  await testarFallbackComGeminiQuebrado();
  console.log("\n=== Fim dos testes ===");
}

main().catch(err => {
  console.error("Erro inesperado no script de teste:", err);
  process.exit(1);
});
