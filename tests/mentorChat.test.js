// tests/mentorChat.test.js
// Mentor de carreira: memória da conversa (as últimas 10 mensagens vão
// junto a cada pergunta, só com papel e texto) e, quando o Gemini falha,
// resposta pelo fallback multi-provedor, sem ferramentas.
//
// O banco é sempre simulado: o .env local aponta para o banco de produção.
jest.mock("../database/db", () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
  ready: Promise.resolve(),
}));
jest.mock("../services/geminiClient", () => ({
  chatTurn: jest.fn(),
  sendFunctionResults: jest.fn(),
}));
jest.mock("../services/aiFallback", () => ({ askFallbackText: jest.fn() }));
jest.mock("../services/aiTools", () => ({
  TOOL_DECLARATIONS: [{ name: "buscarVagas" }],
  executeTool: jest.fn(),
}));
jest.mock("../services/userContextService", () => ({
  buildMentorContext: jest.fn().mockResolvedValue("DADOS DO USUÁRIO\nRoadmap: nenhum criado ainda."),
}));

const db = require("../database/db");
const { chatTurn, sendFunctionResults } = require("../services/geminiClient");
const { askFallbackText } = require("../services/aiFallback");
const { executeTool } = require("../services/aiTools");
const { ErroIA } = require("../services/iaErros");
const { sendMessage } = require("../services/mentorChat");

const ID_INSERIDO = 99;
let conversa; // linhas de mentor_conversas, da mais antiga para a mais nova

// Linha como vem do banco, com as colunas que nunca podem ir para a IA.
const linha = (i, role, content) => ({
  id: i, role, content, created_at: new Date(2026, 10, 6, 10, i), gemini_interaction_id: role === "assistant" ? `i-${i}` : null,
});

// Último INSERT da resposta do mentor: [user_id, conteúdo, interaction id].
const respostaGravada = () => db.query.mock.calls.find(([sql]) => sql.includes("'assistant'"))?.[1];
const foraDoAr = () => new ErroIA("Prazo da chamada à IA esgotado.", { tipo: "tempo", temporario: true });

beforeEach(() => {
  jest.clearAllMocks();
  conversa = [];
  db.query.mockImplementation(async (sql, params) => {
    const s = sql.trim();
    // getMensagensRecentes: ORDER BY created_at DESC LIMIT ?
    if (s.startsWith("SELECT")) return [conversa.slice(-params[1]).reverse()];
    if (s.startsWith("INSERT")) return [{ insertId: ID_INSERIDO }];
    return [{ affectedRows: 1 }];
  });
  askFallbackText.mockResolvedValue({ text: "Resposta do fallback.", cortada: false, provider: "groq", model: "modelo" });
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("Gemini responde: grava a resposta com o interaction id e não usa o fallback", async () => {
  chatTurn.mockResolvedValue({ interactionId: "i-2", text: "Olá!", functionCalls: [], cortada: false });

  await expect(sendMessage(1, 10, "iniciante", "Oi")).resolves.toBe("Olá!");
  expect(respostaGravada()).toEqual([1, "Olá!", "i-2"]);
  expect(chatTurn.mock.calls[0][0].prazo).toBeGreaterThan(Date.now());
  expect(askFallbackText).not.toHaveBeenCalled();
});

test("o prompt de sistema traz as áreas do site e os dados atuais do usuário", async () => {
  const { buildMentorContext } = require("../services/userContextService");
  chatTurn.mockResolvedValue({ interactionId: "i-1", text: "Olá!", functionCalls: [], cortada: false });

  await sendMessage(1, 10, "iniciante", "Como está meu roadmap?");

  expect(buildMentorContext).toHaveBeenCalledWith({ id: 1, github_id: 10 });
  const { system } = chatTurn.mock.calls[0][0];
  expect(system).toMatch(/Mentor de carreira do Ápice/);
  expect(system).toMatch(/Roadmap \(\/trilha\)/);
  expect(system.endsWith("DADOS DO USUÁRIO\nRoadmap: nenhum criado ainda.")).toBe(true);
});

test("primeira mensagem: histórico vazio e a mensagem nova como input", async () => {
  chatTurn.mockResolvedValue({ interactionId: "i-1", text: "Olá!", functionCalls: [], cortada: false });

  await sendMessage(1, 10, "iniciante", "Oi, tudo bem?");

  const pedido = chatTurn.mock.calls[0][0];
  expect(pedido.historico).toEqual([]);
  expect(pedido.input).toBe("Oi, tudo bem?");
  expect(pedido).not.toHaveProperty("previousInteractionId");
});

test("mensagens seguintes: vão as últimas 10, da mais antiga para a mais nova, só com papel e texto", async () => {
  for (let i = 1; i <= 12; i++) conversa.push(linha(i, i % 2 ? "user" : "assistant", `mensagem ${i}`));
  chatTurn.mockResolvedValue({ interactionId: "i-13", text: "Certo.", functionCalls: [], cortada: false });

  await sendMessage(1, 10, "iniciante", "E agora?");

  const { historico, input } = chatTurn.mock.calls[0][0];
  expect(historico).toHaveLength(10);
  expect(historico[0]).toEqual({ role: "user", content: "mensagem 3" });
  expect(historico[9]).toEqual({ role: "assistant", content: "mensagem 12" });
  for (const m of historico) expect(Object.keys(m).sort()).toEqual(["content", "role"]);
  expect(input).toBe("E agora?");
});

test("mensagem longa do histórico é encurtada (2000 caracteres para o Gemini, 800 para o fallback)", async () => {
  conversa = [linha(1, "user", "x".repeat(5000))];
  chatTurn.mockRejectedValue(foraDoAr());

  await sendMessage(1, 10, "iniciante", "Resume?");

  expect(chatTurn.mock.calls[0][0].historico[0].content).toHaveLength(2001); // 2000 + "…"
  expect(askFallbackText.mock.calls[0][0].messages[0].content).toHaveLength(801);
});

test("Gemini falha: o fallback responde com as mesmas mensagens, sem ferramentas e sem interaction id", async () => {
  conversa = [linha(1, "user", "Oi"), linha(2, "assistant", "Olá! Como posso ajudar?")];
  chatTurn.mockRejectedValue(foraDoAr());

  await expect(sendMessage(1, 10, "iniciante", "Como estudar SQL?")).resolves.toBe("Resposta do fallback.");

  const pedido = askFallbackText.mock.calls[0][0];
  expect(pedido.messages).toEqual([
    { role: "user", content: "Oi" },
    { role: "assistant", content: "Olá! Como posso ajudar?" },
    { role: "user", content: "Como estudar SQL?" },
  ]);
  expect(pedido.system).toMatch(/sem acesso às ferramentas/);
  expect(pedido.prazo).toBeGreaterThan(Date.now());
  expect(respostaGravada()).toEqual([1, "Resposta do fallback.", null]);
});

test("Gemini falha no meio das ferramentas: o fallback responde", async () => {
  chatTurn.mockResolvedValue({
    interactionId: "i-2", text: "", cortada: false,
    functionCalls: [{ id: "c-1", name: "buscarVagas", arguments: {} }],
  });
  executeTool.mockResolvedValue([]);
  sendFunctionResults.mockRejectedValue(foraDoAr());

  await expect(sendMessage(1, 10, "iniciante", "Tem vaga de Node?")).resolves.toBe("Resposta do fallback.");
  expect(sendFunctionResults.mock.calls[0][0]).toMatchObject({ previousInteractionId: "i-2" });
  expect(sendFunctionResults.mock.calls[0][0].prazo).toBeGreaterThan(Date.now());
});

test("resposta vazia do Gemini vai pro fallback", async () => {
  chatTurn.mockResolvedValue({ interactionId: "i-2", text: "", functionCalls: [], cortada: false });
  await expect(sendMessage(1, 10, "iniciante", "Oi")).resolves.toBe("Resposta do fallback.");
});

test("Gemini e fallback falham: apaga a pergunta sem resposta e repassa o erro", async () => {
  chatTurn.mockRejectedValue(foraDoAr());
  askFallbackText.mockRejectedValue(new ErroIA("A IA está indisponível no momento.", { tipo: "indisponivel", temporario: true }));

  await expect(sendMessage(1, 10, "iniciante", "Oi")).rejects.toMatchObject({ tipo: "indisponivel" });
  expect(db.query).toHaveBeenCalledWith("DELETE FROM mentor_conversas WHERE id = ?", [ID_INSERIDO]);
  expect(respostaGravada()).toBeUndefined();
});

test("resposta cortada no teto de tokens ganha um aviso", async () => {
  chatTurn.mockResolvedValue({ interactionId: "i-2", text: "Primeiro, estude", functionCalls: [], cortada: true });

  const resposta = await sendMessage(1, 10, "iniciante", "Como começar?");
  expect(resposta).toMatch(/^Primeiro, estude\n\n\(A resposta foi interrompida/);
});
