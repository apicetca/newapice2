// tests/geminiClient.test.js
// Cliente do Gemini (services/geminiClient.js) com o SDK simulado: nenhuma
// chamada real à API. Cobre o formato das mensagens enviadas ao Gemini, o
// prazo por tentativa, o retry só em falhas passageiras, o parse tolerante
// de JSON e as respostas cortadas, vazias ou com falha.
jest.mock("@google/genai", () => {
  const create = jest.fn();
  return { GoogleGenAI: jest.fn(() => ({ interactions: { create } })), __create: create };
});
jest.mock("../services/aiFallback", () => ({
  ...jest.requireActual("../services/aiFallback"),
  askFallbackJSON: jest.fn(),
}));

process.env.GEMINI_API_KEY = "chave-de-teste";

const { __create: create } = require("@google/genai");
const { askFallbackJSON } = require("../services/aiFallback");
const { askGeminiJSON, chatTurn, sendFunctionResults, configuracaoIA } = require("../services/geminiClient");

const VARIAVEIS = ["GEMINI_TIMEOUT_MS", "GEMINI_TOTAL_MS", "GEMINI_MAX_RETRIES"];

const resposta = (text, status = "completed") => ({
  id: "int-1",
  status,
  steps: [{ type: "model_output", content: [{ type: "text", text }] }],
});
const erroHttp = (status, message) => Object.assign(new Error(message), { status });
const pedidoJSON = { system: "sistema", prompt: "pergunta" };

beforeEach(() => {
  create.mockReset();
  askFallbackJSON.mockReset();
  askFallbackJSON.mockResolvedValue({ origem: "fallback" });
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  console.error.mockRestore();
  for (const nome of VARIAVEIS) delete process.env[nome];
});

describe("askGeminiJSON", () => {
  test("desliga o retry oculto do SDK e manda um AbortSignal por tentativa", async () => {
    create.mockResolvedValue(resposta('{"ok":true}'));

    await expect(askGeminiJSON(pedidoJSON)).resolves.toEqual({ ok: true });

    const [, opcoes] = create.mock.calls[0];
    expect(opcoes.retries).toEqual({ strategy: "none" });
    expect(opcoes.signal).toBeInstanceOf(AbortSignal);
    expect(askFallbackJSON).not.toHaveBeenCalled();
  });

  test("aceita JSON cercado por ``` ou com texto em volta", async () => {
    create.mockResolvedValue(resposta('Segue o resultado:\n```json\n{"ok":true}\n```'));
    await expect(askGeminiJSON(pedidoJSON)).resolves.toEqual({ ok: true });
  });

  test("texto sem JSON vai pro fallback e o texto bruto vai pro log", async () => {
    create.mockResolvedValue(resposta("Desculpe, não consigo ajudar com isso."));

    await expect(askGeminiJSON(pedidoJSON)).resolves.toEqual({ origem: "fallback" });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("não é JSON válido"),
      "Desculpe, não consigo ajudar com isso.",
    );
  });

  test("campo obrigatório vazio vai pro fallback, que recebe os mesmos obrigatórios", async () => {
    create.mockResolvedValue(resposta('{"resumo":"  "}'));

    await expect(askGeminiJSON({ ...pedidoJSON, obrigatorios: ["resumo"] })).resolves.toEqual({ origem: "fallback" });
    expect(askFallbackJSON).toHaveBeenCalledWith(expect.objectContaining({ obrigatorios: ["resumo"] }));
  });

  test("repete após 503 e usa a resposta da nova tentativa", async () => {
    create
      .mockRejectedValueOnce(erroHttp(503, "The model is overloaded."))
      .mockResolvedValueOnce(resposta('{"ok":true}'));

    await expect(askGeminiJSON(pedidoJSON)).resolves.toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(2);
    expect(askFallbackJSON).not.toHaveBeenCalled();
  });

  test("429 repetido para em GEMINI_MAX_RETRIES e cai no fallback", async () => {
    process.env.GEMINI_MAX_RETRIES = "1";
    create.mockRejectedValue(erroHttp(429, "Resource has been exhausted."));

    await expect(askGeminiJSON(pedidoJSON)).resolves.toEqual({ origem: "fallback" });
    expect(create).toHaveBeenCalledTimes(2);
  });

  test("erro 400 não é repetido: vai direto pro fallback", async () => {
    create.mockRejectedValue(erroHttp(400, "Invalid argument."));

    await expect(askGeminiJSON(pedidoJSON)).resolves.toEqual({ origem: "fallback" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("tempo esgotado cancela a requisição, não repete e cai no fallback", async () => {
    process.env.GEMINI_TIMEOUT_MS = "50";
    create.mockImplementation((params, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("Request was aborted."), { name: "RequestAbortedError" })));
    }));

    await expect(askGeminiJSON(pedidoJSON)).resolves.toEqual({ origem: "fallback" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][1].signal.aborted).toBe(true);
  });

  test("resposta cortada no teto de tokens vai pro fallback", async () => {
    create.mockResolvedValue(resposta('{"trilha": [{"tecnologia": "Node', "incomplete"));
    await expect(askGeminiJSON(pedidoJSON)).resolves.toEqual({ origem: "fallback" });
  });

  test("resposta vazia vai pro fallback", async () => {
    create.mockResolvedValue({ id: "int-1", status: "completed", steps: [] });
    await expect(askGeminiJSON(pedidoJSON)).resolves.toEqual({ origem: "fallback" });
  });

  test("interação com status failed vai pro fallback", async () => {
    create.mockResolvedValue({ id: "int-1", status: "failed", steps: [] });
    await expect(askGeminiJSON(pedidoJSON)).resolves.toEqual({ origem: "fallback" });
  });

  test("sem GEMINI_API_KEY nem chama o Gemini: vai direto pro fallback", async () => {
    delete process.env.GEMINI_API_KEY;
    try {
      await expect(askGeminiJSON(pedidoJSON)).resolves.toEqual({ origem: "fallback" });
      expect(create).not.toHaveBeenCalled();
    } finally {
      process.env.GEMINI_API_KEY = "chave-de-teste";
    }
  });
});

describe("chatTurn", () => {
  test("monta o input como passos da Interactions API, só com tipo e texto", async () => {
    create.mockResolvedValue(resposta("Seu nome é Ana."));

    await chatTurn({
      system: "sistema",
      historico: [
        // linhas como viriam do banco: as colunas extras não podem ir para a API
        { id: 1, role: "user", content: "Meu nome é Ana.", created_at: "2026-11-06", gemini_interaction_id: null },
        { id: 2, role: "assistant", content: "Prazer, Ana!", created_at: "2026-11-06", gemini_interaction_id: "i-1" },
        { id: 3, role: "user", content: "   " },
        { id: 4, role: "assistant", content: null },
      ],
      input: "Qual é o meu nome?",
    });

    const [params] = create.mock.calls[0];
    expect(params.input).toEqual([
      { type: "user_input", content: [{ type: "text", text: "Meu nome é Ana." }] },
      { type: "model_output", content: [{ type: "text", text: "Prazer, Ana!" }] },
      { type: "user_input", content: [{ type: "text", text: "Qual é o meu nome?" }] },
    ]);
    expect(params).not.toHaveProperty("previous_interaction_id");
    expect(JSON.stringify(params.input)).not.toMatch(/"id"|created_at|gemini_interaction_id|"role"/);
  });

  test("primeira mensagem: input com um passo só", async () => {
    create.mockResolvedValue(resposta("Olá!"));

    await chatTurn({ system: "sistema", input: "Oi" });
    expect(create.mock.calls[0][0].input).toEqual([{ type: "user_input", content: [{ type: "text", text: "Oi" }] }]);
  });

  test("marca a resposta cortada no teto de tokens", async () => {
    create.mockResolvedValue(resposta("Para estudar Node, comece por", "incomplete"));

    const turn = await chatTurn({ system: "sistema", input: "oi" });
    expect(turn).toMatchObject({ text: "Para estudar Node, comece por", cortada: true });
  });

  test("chave inválida vira ErroIA com tipo e status, sem nova tentativa", async () => {
    create.mockRejectedValue(erroHttp(401, "API key not valid."));

    await expect(chatTurn({ system: "sistema", input: "oi" })).rejects.toMatchObject({
      name: "ErroIA",
      tipo: "chave",
      status: 401,
      temporario: false,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("chave inválida do Gemini (400 API_KEY_INVALID) é erro de chave, com o motivo da API no log", async () => {
    // Formato real do @google/genai: mensagem genérica, motivo no corpo.
    create.mockRejectedValue(Object.assign(new Error('400 API error occurred: {"httpMeta":{"response":{},"request":{}}}'), {
      status: 400,
      body: JSON.stringify([{ error: {
        code: 400,
        message: "API key not valid. Please pass a valid API key.",
        status: "INVALID_ARGUMENT",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID" }],
      } }]),
    }));

    await expect(chatTurn({ system: "sistema", input: "oi" })).rejects.toMatchObject({
      tipo: "chave",
      status: 400,
      message: "Falha ao chamar a IA (Gemini): API key not valid. Please pass a valid API key. (API_KEY_INVALID)",
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Falha na chamada"), {
      status: 400,
      tipo: "chave",
      motivo: "API key not valid. Please pass a valid API key. (API_KEY_INVALID)",
    });
  });

  test("respeita o prazo de quem chama", async () => {
    await expect(chatTurn({ system: "sistema", input: "oi", prazo: Date.now() + 500 })).rejects.toMatchObject({
      name: "ErroIA",
      tipo: "tempo",
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("limite de uso (429) com espera sugerida", () => {
  // Formato real do corpo (visto em 2026-11-06): a espera vem só no texto.
  const erro429 = espera => Object.assign(new Error("429 API error occurred"), {
    status: 429,
    body: JSON.stringify({ error: {
      message: `Rate limit exceeded for model gemini-3.6-flash (limit: 20 requests per day on Free Tier). Please retry in ${espera} or upgrade your tier at https://ai.dev/rate-limit.`,
      code: "too_many_requests",
    } }),
  });
  const { esperaSugeridaMs } = require("../services/iaErros");

  test.each([
    ["7h2m2s", 25322000],
    ["55s", 55000],
    ["1m30s", 90000],
    ["0.5s", 500],
  ])("lê a espera \"%s\" do corpo do 429", (espera, ms) => {
    expect(esperaSugeridaMs(erro429(espera))).toBe(ms);
  });

  test("sem espera no texto: null", () => {
    expect(esperaSugeridaMs(erroHttp(429, "Resource has been exhausted."))).toBeNull();
  });

  test("espera longa (cota diária): não repete, pausa o Gemini e as próximas chamadas vão direto pro fallback", async () => {
    // Módulo isolado: a pausa é estado do geminiClient e não pode vazar pros outros testes.
    let cliente, criar, fallback;
    jest.isolateModules(() => {
      cliente  = require("../services/geminiClient");
      criar    = require("@google/genai").__create;
      fallback = require("../services/aiFallback").askFallbackJSON;
    });
    criar.mockRejectedValue(erro429("7h2m2s"));
    fallback.mockResolvedValue({ origem: "fallback" });

    await expect(cliente.askGeminiJSON(pedidoJSON)).resolves.toEqual({ origem: "fallback" });
    expect(criar).toHaveBeenCalledTimes(1);

    await expect(cliente.askGeminiJSON(pedidoJSON)).resolves.toEqual({ origem: "fallback" });
    await expect(cliente.chatTurn({ system: "sistema", input: "oi" })).rejects.toMatchObject({ tipo: "limite", status: 429 });
    expect(criar).toHaveBeenCalledTimes(1); // em pausa: nem tentou de novo
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Gemini em pausa até"));
  });
});

describe("configuracaoIA", () => {
  const CHAVES = ["GROQ_API_KEY", "CEREBRAS_API_KEY", "MISTRAL_API_KEY", "OPENROUTER_API_KEY"];
  const originais = Object.fromEntries(CHAVES.map(nome => [nome, process.env[nome]]));
  afterEach(() => {
    for (const nome of CHAVES) {
      if (originais[nome] === undefined) delete process.env[nome];
      else process.env[nome] = originais[nome];
    }
  });

  test("diz quais chaves existem, sem expor os valores", () => {
    for (const nome of CHAVES) delete process.env[nome];
    process.env.MISTRAL_API_KEY = "segredo-mistral";

    const config = configuracaoIA();
    expect(config).toEqual({ gemini: true, modelo: expect.any(String), fallback: ["mistral"] });
    expect(JSON.stringify(config)).not.toMatch(/segredo|chave-de-teste/);
  });
});

describe("sendFunctionResults", () => {
  test("devolve o resultado da ferramenta com call_id e result (formato da Interactions API)", async () => {
    create.mockResolvedValue({ id: "int-2", status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "Achei 2 vagas." }] }] });

    const turn = await sendFunctionResults({
      system: "sistema",
      previousInteractionId: "int-1",
      results: [{ id: "chamada-1", name: "buscarVagas", response: { output: [{ id: 3 }] } }],
    });

    const [params] = create.mock.calls[0];
    expect(params.previous_interaction_id).toBe("int-1");
    expect(params.input).toEqual([
      { type: "function_result", call_id: "chamada-1", name: "buscarVagas", result: { output: [{ id: 3 }] } },
    ]);
    expect(params.input[0]).not.toHaveProperty("id");
    expect(params.input[0]).not.toHaveProperty("response");
    expect(turn.text).toBe("Achei 2 vagas.");
  });
});
