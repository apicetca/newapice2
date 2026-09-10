// ============================================
// services/geminiClient.js
// Client fino pra Interactions API do Gemini
// (Google AI Studio, nível gratuito). Ponto único
// de configuração — todo serviço de IA passa por
// aqui, igual subscriptionService.js é o ponto
// único pra consulta de planos.
// ============================================
const axios = require("axios");

const MODEL   = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const API_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

// gemini-3.7-flash apresentou alta latência/instabilidade nos testes
// (10-35s, um erro de "high demand"); gemini-3.6-flash respondeu de
// forma consistente em poucos segundos — mantido como padrão até o
// 3.7 estabilizar. thinking_level "low" reduz bastante os tokens de
// raciocínio interno (que contam dentro de max_output_tokens).
const THINKING_LEVEL = "low";

// --------------------------------------------
// Pede uma resposta em JSON estruturado ao Gemini.
// system:    instruções de contexto (papel, formato esperado)
// prompt:    conteúdo da requisição (dados já filtrados pro LGPD)
// maxTokens: teto de tokens de saída — IMPORTANTE: o Gemini soma os
//            tokens de "thinking" interno dentro desse teto, então
//            precisa de folga (visto na prática: ~400-450 tokens só
//            de thinking mesmo com thinking_level "low", antes de
//            começar a gerar a resposta em si).
// --------------------------------------------
async function askGeminiJSON({ system, prompt, maxTokens = 2048 }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY não configurada.");
  }

  const res = await axios.post(
    API_URL,
    {
      model: MODEL,
      input: prompt,
      system_instruction: system,
      response_format: {
        type: "text",
        mime_type: "application/json",
      },
      generation_config: {
        max_output_tokens: maxTokens,
        thinking_level: THINKING_LEVEL,
      },
    },
    {
      headers: {
        "x-goog-api-key": process.env.GEMINI_API_KEY,
        "content-type": "application/json",
      },
      timeout: 45000,
    }
  );

  // A resposta vem em steps[] — o texto gerado está no step do tipo
  // "model_output" (outros steps, como "thought", não são a resposta final).
  const outputStep = res.data?.steps?.find(s => s.type === "model_output");
  const text = outputStep?.content?.find(c => c.type === "text")?.text ?? "";

  try {
    return JSON.parse(text);
  } catch {
    // Gemini não retornou JSON válido apesar do pedido no prompt —
    // trata como falha de integração, não derruba o processo chamador.
    throw new Error("Resposta da IA não veio em JSON válido.");
  }
}

module.exports = { askGeminiJSON, MODEL };
