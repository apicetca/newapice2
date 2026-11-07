// tests/aiFallback.test.js
// Fallback multi-provedor (services/aiFallback.js) com o SDK da OpenAI
// simulado: nenhuma chamada real. Cobre a ordem da cadeia, o retry oculto
// do SDK desligado, o prazo total e o erro final padronizado.
jest.mock("openai", () => {
  const create = jest.fn();
  const OpenAI = jest.fn(function (config) {
    this.chat = { completions: { create: (corpo, opcoes) => create(config, corpo, opcoes) } };
  });
  OpenAI.__create = create;
  return OpenAI;
});

const { __create: create } = require("openai");
const { askFallbackJSON, askFallbackText, PROVIDERS } = require("../services/aiFallback");

const CHAVES = Object.values(PROVIDERS).map(p => p.apiKeyEnv);
const originais = Object.fromEntries(CHAVES.map(nome => [nome, process.env[nome]]));

const completion = (content, finish_reason = "stop") => ({ choices: [{ message: { content }, finish_reason }] });
const pedido = { system: "sistema", prompt: "pergunta" };

beforeEach(() => {
  create.mockReset();
  for (const nome of CHAVES) process.env[nome] = `chave-${nome}`;
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  console.error.mockRestore();
  for (const nome of CHAVES) {
    if (originais[nome] === undefined) delete process.env[nome];
    else process.env[nome] = originais[nome];
  }
});

test("pula provedor sem chave e responde pelo próximo da cadeia", async () => {
  delete process.env.GROQ_API_KEY;
  create.mockResolvedValue(completion('{"ok":true}'));

  await expect(askFallbackJSON(pedido)).resolves.toEqual({ ok: true, __provider: "cerebras", __model: "llama-3.3-70b" });
  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0][0].baseURL).toBe(PROVIDERS.cerebras.baseURL);
});

test("desliga o retry oculto do SDK e passa o prazo em cada chamada", async () => {
  create.mockResolvedValue(completion('{"ok":true}'));

  await askFallbackJSON(pedido);

  const [config, , opcoes] = create.mock.calls[0];
  expect(config.maxRetries).toBe(0);
  expect(opcoes.timeout).toBeGreaterThan(0);
  expect(opcoes.timeout).toBeLessThanOrEqual(12000);
});

test("resposta cortada no teto de tokens passa pro próximo provedor", async () => {
  create
    .mockResolvedValueOnce(completion('{"trilha": [{"tecnologia": "No', "length"))
    .mockResolvedValueOnce(completion('Aqui está: {"ok":true}'));

  await expect(askFallbackJSON(pedido)).resolves.toMatchObject({ ok: true, __provider: "cerebras" });
});

test("resposta sem campo obrigatório passa pro próximo provedor", async () => {
  create
    .mockResolvedValueOnce(completion('{"outro":"valor"}'))
    .mockResolvedValueOnce(completion('{"resumo":"Tudo certo."}'));

  await expect(askFallbackJSON({ ...pedido, obrigatorios: ["resumo"] })).resolves.toMatchObject({
    resumo: "Tudo certo.",
    __provider: "cerebras",
  });
});

test("quando todos falham, lança ErroIA temporário com a mensagem amigável", async () => {
  create.mockRejectedValue(Object.assign(new Error("429 Rate limit reached"), { status: 429 }));

  await expect(askFallbackJSON(pedido)).rejects.toMatchObject({
    name: "ErroIA",
    tipo: "indisponivel",
    temporario: true,
    message: "A IA está indisponível no momento. Tente novamente em alguns minutos.",
  });
  expect(create).toHaveBeenCalledTimes(Object.keys(PROVIDERS).length);
});

test("não começa um provedor novo depois do prazo de quem chama", async () => {
  await expect(askFallbackJSON({ ...pedido, prazo: Date.now() + 500 })).rejects.toMatchObject({ tipo: "indisponivel" });
  expect(create).not.toHaveBeenCalled();
});

test("askFallbackText devolve o texto, se foi cortado e o provedor, com o system antes da conversa", async () => {
  create.mockResolvedValue(completion("Resposta em texto.", "length"));

  await expect(askFallbackText({ system: "sistema", messages: [{ role: "user", content: "Oi" }] })).resolves.toEqual({
    text: "Resposta em texto.",
    cortada: true,
    provider: "groq",
    model: "openai/gpt-oss-120b",
  });
  expect(create.mock.calls[0][1].messages).toEqual([
    { role: "system", content: "sistema" },
    { role: "user", content: "Oi" },
  ]);
});
