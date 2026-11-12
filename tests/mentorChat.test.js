// tests/mentorChat.test.js
// Mentor de carreira: várias conversas por usuário, salvas entre logins
// (mentor_chats), memória da conversa (as últimas 10 mensagens dela vão junto
// a cada pergunta, só com papel e texto) e, quando o Gemini falha, resposta
// pelo fallback multi-provedor, sem ferramentas.
//
// O banco é sempre simulado: o .env local aponta para o banco de produção.
const fs   = require("fs");
const path = require("path");

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
const { sendMessage, listConversas, getHistory, ConversaNaoEncontrada } = require("../services/mentorChat");

const USUARIO = 1;
let chats;      // mentor_chats
let mensagens;  // mentor_conversas
let proximoId;

// Banco simulado com só as tabelas do mentor.
function instalarBanco() {
  chats = [];
  mensagens = [];
  proximoId = 100;
  db.query.mockImplementation(async (sql, params = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    if (s.startsWith("SELECT content FROM mentor_conversas WHERE user_id = ? AND chat_id IS NULL")) {
      const orfas = mensagens.filter(m => m.user_id === params[0] && m.chat_id == null);
      return [orfas.sort((a, b) => (b.role === "user") - (a.role === "user") || a.id - b.id).slice(0, 1)];
    }
    if (s.startsWith("UPDATE mentor_conversas SET chat_id = ?")) {
      const orfas = mensagens.filter(m => m.user_id === params[1] && m.chat_id == null);
      orfas.forEach(m => { m.chat_id = params[0]; });
      return [{ affectedRows: orfas.length }];
    }
    if (s.startsWith("INSERT INTO mentor_chats")) {
      const chat = { id: proximoId++, user_id: params[0], title: params[1], updated_at: proximoId };
      chats.push(chat);
      return [{ insertId: chat.id }];
    }
    if (s.startsWith("SELECT id, title, updated_at FROM mentor_chats WHERE user_id = ?")) {
      return [chats.filter(c => c.user_id === params[0]).sort((a, b) => b.updated_at - a.updated_at).slice(0, params[1])];
    }
    if (s.startsWith("SELECT id, title FROM mentor_chats WHERE id = ? AND user_id = ?")) {
      return [chats.filter(c => c.id === params[0] && c.user_id === params[1])];
    }
    if (s.startsWith("SELECT id, title FROM mentor_chats WHERE user_id = ?")) {
      return [chats.filter(c => c.user_id === params[0]).sort((a, b) => b.updated_at - a.updated_at).slice(0, 1)];
    }
    if (s.startsWith("UPDATE mentor_chats SET updated_at")) {
      chats.find(c => c.id === params[0]).updated_at = proximoId++;
      return [{}];
    }
    if (s.startsWith("DELETE FROM mentor_chats WHERE id = ?")) {
      chats = chats.filter(c => c.id !== params[0]);
      return [{}];
    }
    if (s.startsWith("SELECT role, content FROM mentor_conversas WHERE chat_id = ?")) {
      return [mensagens.filter(m => m.chat_id === params[0]).slice(-params[1]).reverse()];
    }
    if (s.startsWith("SELECT id, role, content, created_at FROM mentor_conversas WHERE chat_id = ? AND user_id = ?")) {
      return [mensagens.filter(m => m.chat_id === params[0] && m.user_id === params[1])];
    }
    if (s.startsWith("INSERT INTO mentor_conversas")) {
      const assistente = s.includes("'assistant'");
      const m = { id: proximoId++, user_id: params[0], chat_id: params[1], role: assistente ? "assistant" : "user", content: params[2], gemini_interaction_id: assistente ? params[3] : null };
      mensagens.push(m);
      return [{ insertId: m.id }];
    }
    if (s.startsWith("DELETE FROM mentor_conversas WHERE id = ?")) {
      mensagens = mensagens.filter(m => m.id !== params[0]);
      return [{}];
    }
    throw new Error(`consulta não simulada: ${s}`);
  });
}

// Conversa já gravada, com as mensagens dadas (com colunas que nunca vão para a IA).
function conversaGravada(titulo, conteudos, userId = USUARIO) {
  const chat = { id: proximoId++, user_id: userId, title: titulo, updated_at: proximoId };
  chats.push(chat);
  conteudos.forEach((content, i) => mensagens.push({
    id: proximoId++, user_id: userId, chat_id: chat.id, role: i % 2 ? "assistant" : "user", content,
    created_at: new Date(2026, 10, 6, 10, i), gemini_interaction_id: i % 2 ? `i-${i}` : null,
  }));
  return chat;
}

const respostaGravada = () => mensagens.find(m => m.role === "assistant" && m.content.startsWith("Resposta"));
const foraDoAr = () => new ErroIA("Prazo da chamada à IA esgotado.", { tipo: "tempo", temporario: true });
const respostaDoGemini = (text = "Resposta do Gemini.", extra = {}) => ({ interactionId: "i-novo", text, functionCalls: [], cortada: false, ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  instalarBanco();
  askFallbackText.mockResolvedValue({ text: "Resposta do fallback.", cortada: false, provider: "groq", model: "modelo" });
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("conversas", () => {
  test("sem conversa aberta, a pergunta começa uma conversa nova com ela como título", async () => {
    chatTurn.mockResolvedValue(respostaDoGemini());

    const r = await sendMessage(USUARIO, 10, "iniciante", "Como estudar SQL?\nTenho 5h por semana.");

    expect(r).toEqual({ texto: "Resposta do Gemini.", conversa: { id: chats[0].id, titulo: "Como estudar SQL?" } });
    expect(chats).toHaveLength(1);
    expect(mensagens.map(m => [m.chat_id, m.role])).toEqual([[chats[0].id, "user"], [chats[0].id, "assistant"]]);
    expect(chatTurn.mock.calls[0][0].historico).toEqual([]);
  });

  test("título sem o anexo e com no máximo 120 caracteres", async () => {
    chatTurn.mockResolvedValue(respostaDoGemini());

    await sendMessage(USUARIO, 10, "iniciante", "x".repeat(200), "conteúdo do currículo");

    expect(chats[0].title).toHaveLength(120);
    expect(chats[0].title.endsWith("…")).toBe(true);
    expect(mensagens[0].content).toContain("[Arquivo anexado]\nconteúdo do currículo");
  });

  test("com a conversa aberta, continua nela: manda as mensagens dela e a sobe para o topo", async () => {
    const outra = conversaGravada("Outra", ["outra pergunta", "outra resposta"]);
    const readme = conversaGravada("README", ["Como melhorar o README?", "Comece pelo objetivo."]);
    outra.updated_at = readme.updated_at + 1; // antes da pergunta, a "Outra" é a mais recente
    expect((await listConversas(USUARIO))[0].id).toBe(outra.id);
    chatTurn.mockResolvedValue(respostaDoGemini("Resposta: inclua um print."));

    const r = await sendMessage(USUARIO, 10, "iniciante", "E o que mais?", undefined, readme.id);

    expect(r.conversa).toEqual({ id: readme.id, titulo: "README" });
    expect(chatTurn.mock.calls[0][0].historico).toEqual([
      { role: "user", content: "Como melhorar o README?" },
      { role: "assistant", content: "Comece pelo objetivo." },
    ]);
    expect(chats).toHaveLength(2); // nenhuma conversa nova
    expect((await listConversas(USUARIO))[0]).toMatchObject({ id: readme.id, titulo: "README" });
  });

  test("conversa de outro usuário: ConversaNaoEncontrada, sem gravar nada", async () => {
    const alheia = conversaGravada("De outra pessoa", ["oi", "olá"], 2);

    await expect(sendMessage(USUARIO, 10, "iniciante", "Oi", undefined, alheia.id)).rejects.toBeInstanceOf(ConversaNaoEncontrada);
    await expect(getHistory(USUARIO, alheia.id)).rejects.toMatchObject({ name: "ConversaNaoEncontrada", status: 404 });
    expect(mensagens).toHaveLength(2);
    expect(chatTurn).not.toHaveBeenCalled();
  });

  test("histórico da tela: as conversas do usuário, a mais recente primeiro", async () => {
    const velha = conversaGravada("Velha", ["a", "b"]);
    const nova = conversaGravada("Nova", ["c", "d"]);
    conversaGravada("De outra pessoa", ["e", "f"], 2);

    const lista = await listConversas(USUARIO);
    expect(lista.map(c => c.id)).toEqual([nova.id, velha.id]);
    expect(lista[0]).toEqual({ id: nova.id, titulo: "Nova", atualizada_em: nova.updated_at });
  });

  test("mensagens de antes do histórico viram a primeira conversa, com a primeira pergunta como título", async () => {
    mensagens.push(
      { id: 1, user_id: USUARIO, chat_id: null, role: "user", content: "Pergunta antiga\n\n[Arquivo anexado]\ncv" },
      { id: 2, user_id: USUARIO, chat_id: null, role: "assistant", content: "Resposta antiga" },
    );

    const lista = await listConversas(USUARIO);

    expect(lista).toEqual([{ id: chats[0].id, titulo: "Pergunta antiga", atualizada_em: chats[0].updated_at }]);
    expect(mensagens.every(m => m.chat_id === chats[0].id)).toBe(true);
    await listConversas(USUARIO);
    expect(chats).toHaveLength(1); // só adota uma vez
  });

  test("se outra aba adotou as mensagens antigas no meio do caminho, a conversa vazia sai", async () => {
    mensagens.push({ id: 1, user_id: USUARIO, chat_id: null, role: "user", content: "Pergunta antiga" });
    const consultaOriginal = db.query.getMockImplementation();
    db.query.mockImplementation(async (sql, params) => {
      // a outra aba liga as mensagens a uma conversa dela logo antes deste UPDATE
      if (sql.includes("UPDATE mentor_conversas SET chat_id")) mensagens.forEach(m => { m.chat_id = 55; });
      return consultaOriginal(sql, params);
    });

    await listConversas(USUARIO);
    expect(chats).toEqual([]);
  });

  test("getHistory sem conversa: a mais recente; sem nenhuma: vazio", async () => {
    await expect(getHistory(USUARIO)).resolves.toEqual({ conversa: null, mensagens: [] });

    const chat = conversaGravada("Única", ["oi", "olá"]);
    const r = await getHistory(USUARIO);
    expect(r.conversa).toEqual({ id: chat.id, titulo: "Única" });
    expect(r.mensagens.map(m => m.content)).toEqual(["oi", "olá"]);
  });

  test("o login não apaga mais o histórico do mentor", () => {
    for (const arquivo of ["controllers/authController.js", "controllers/usersController.js"]) {
      const codigo = fs.readFileSync(path.join(__dirname, "..", arquivo), "utf8");
      expect(codigo).not.toMatch(/clearHistory|clearMentorHistory|mentor_conversas/);
    }
  });
});

describe("memória e prompt", () => {
  test("o prompt de sistema traz as áreas do site e os dados atuais do usuário", async () => {
    const { buildMentorContext } = require("../services/userContextService");
    chatTurn.mockResolvedValue(respostaDoGemini());

    await sendMessage(USUARIO, 10, "iniciante", "Como está meu roadmap?");

    expect(buildMentorContext).toHaveBeenCalledWith({ id: USUARIO, github_id: 10 });
    const { system } = chatTurn.mock.calls[0][0];
    expect(system).toMatch(/Mentor de carreira do Ápice/);
    expect(system).toMatch(/Roadmap \(\/trilha\)/);
    expect(system.endsWith("DADOS DO USUÁRIO\nRoadmap: nenhum criado ainda.")).toBe(true);
  });

  test("vão as últimas 10 mensagens da conversa, da mais antiga para a mais nova, só com papel e texto", async () => {
    const chat = conversaGravada("Longa", Array.from({ length: 12 }, (_, i) => `mensagem ${i + 1}`));
    chatTurn.mockResolvedValue(respostaDoGemini());

    await sendMessage(USUARIO, 10, "iniciante", "E agora?", undefined, chat.id);

    const { historico, input } = chatTurn.mock.calls[0][0];
    expect(historico).toHaveLength(10);
    expect(historico[0]).toEqual({ role: "user", content: "mensagem 3" });
    expect(historico[9]).toEqual({ role: "assistant", content: "mensagem 12" });
    for (const m of historico) expect(Object.keys(m).sort()).toEqual(["content", "role"]);
    expect(input).toBe("E agora?");
    expect(chatTurn.mock.calls[0][0]).not.toHaveProperty("previousInteractionId");
  });

  test("mensagem longa do histórico é encurtada (2000 caracteres para o Gemini, 800 para o fallback)", async () => {
    const chat = conversaGravada("Longa", ["x".repeat(5000)]);
    chatTurn.mockRejectedValue(foraDoAr());

    await sendMessage(USUARIO, 10, "iniciante", "Resume?", undefined, chat.id);

    expect(chatTurn.mock.calls[0][0].historico[0].content).toHaveLength(2001); // 2000 + "…"
    expect(askFallbackText.mock.calls[0][0].messages[0].content).toHaveLength(801);
  });
});

describe("quando o Gemini falha", () => {
  test("o fallback responde com as mesmas mensagens, sem ferramentas e sem interaction id", async () => {
    const chat = conversaGravada("Oi", ["Oi", "Olá! Como posso ajudar?"]);
    chatTurn.mockRejectedValue(foraDoAr());

    const r = await sendMessage(USUARIO, 10, "iniciante", "Como estudar SQL?", undefined, chat.id);
    expect(r.texto).toBe("Resposta do fallback.");

    const pedido = askFallbackText.mock.calls[0][0];
    expect(pedido.messages).toEqual([
      { role: "user", content: "Oi" },
      { role: "assistant", content: "Olá! Como posso ajudar?" },
      { role: "user", content: "Como estudar SQL?" },
    ]);
    expect(pedido.system).toMatch(/sem acesso às ferramentas/);
    expect(pedido.prazo).toBeGreaterThan(Date.now());
    expect(respostaGravada()).toMatchObject({ chat_id: chat.id, gemini_interaction_id: null });
  });

  test("falha no meio das ferramentas: o fallback responde", async () => {
    chatTurn.mockResolvedValue(respostaDoGemini("", { functionCalls: [{ id: "c-1", name: "buscarVagas", arguments: {} }] }));
    executeTool.mockResolvedValue([]);
    sendFunctionResults.mockRejectedValue(foraDoAr());

    await expect(sendMessage(USUARIO, 10, "iniciante", "Tem vaga de Node?")).resolves.toMatchObject({ texto: "Resposta do fallback." });
    expect(sendFunctionResults.mock.calls[0][0]).toMatchObject({ previousInteractionId: "i-novo" });
    expect(sendFunctionResults.mock.calls[0][0].prazo).toBeGreaterThan(Date.now());
  });

  test("resposta vazia do Gemini vai pro fallback", async () => {
    chatTurn.mockResolvedValue(respostaDoGemini(""));
    await expect(sendMessage(USUARIO, 10, "iniciante", "Oi")).resolves.toMatchObject({ texto: "Resposta do fallback." });
  });

  test("Gemini e fallback falham numa conversa nova: apaga a pergunta e a conversa, e repassa o erro", async () => {
    chatTurn.mockRejectedValue(foraDoAr());
    askFallbackText.mockRejectedValue(new ErroIA("A IA está indisponível no momento.", { tipo: "indisponivel", temporario: true }));

    await expect(sendMessage(USUARIO, 10, "iniciante", "Oi")).rejects.toMatchObject({ tipo: "indisponivel" });
    expect(mensagens).toEqual([]);
    expect(chats).toEqual([]);
  });

  test("Gemini e fallback falham numa conversa existente: só a pergunta sai", async () => {
    const chat = conversaGravada("Oi", ["Oi", "Olá!"]);
    chatTurn.mockRejectedValue(foraDoAr());
    askFallbackText.mockRejectedValue(new ErroIA("A IA está indisponível no momento.", { tipo: "indisponivel", temporario: true }));

    await expect(sendMessage(USUARIO, 10, "iniciante", "E aí?", undefined, chat.id)).rejects.toMatchObject({ tipo: "indisponivel" });
    expect(mensagens.map(m => m.content)).toEqual(["Oi", "Olá!"]);
    expect(chats).toHaveLength(1);
  });

  test("resposta cortada no teto de tokens ganha um aviso", async () => {
    chatTurn.mockResolvedValue(respostaDoGemini("Primeiro, estude", { cortada: true }));

    const r = await sendMessage(USUARIO, 10, "iniciante", "Como começar?");
    expect(r.texto).toMatch(/^Primeiro, estude\n\n\(A resposta foi interrompida/);
  });
});
