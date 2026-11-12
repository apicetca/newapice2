// tests/iaRotas.test.js
// Status HTTP e log das rotas de IA quando a IA falha: 503 se ela está
// indisponível agora, 502 se respondeu algo inutilizável, 500 se a falha é
// interna — sempre com mensagem amigável em português.
//
// O banco é sempre simulado: o .env local aponta para o banco de produção.
const fs      = require("fs");
const path    = require("path");
const express = require("express");
const request = require("supertest");

jest.mock("../database/db", () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
  ready: Promise.resolve(),
}));
jest.mock("../services/subscriptionService", () => ({ hasFeature: jest.fn().mockResolvedValue(true) }));
jest.mock("../services/mentorChat", () => ({ listConversas: jest.fn(), getHistory: jest.fn(), sendMessage: jest.fn() }));
jest.mock("../services/marketInsights", () => ({ getInsightsFreshOrCached: jest.fn() }));
jest.mock("../services/matchCalculator", () => ({ getMatchExplanation: jest.fn(), calculateJobMatch: jest.fn() }));
jest.mock("../services/geminiClient", () => ({ askGeminiJSON: jest.fn(), MODEL: "modelo-de-teste" }));

const { listConversas, getHistory, sendMessage } = require("../services/mentorChat");
const { getInsightsFreshOrCached } = require("../services/marketInsights");
const { ErroIA, statusHttpDaIA } = require("../services/iaErros");
const aiRoutes = require("../routes/ai");

const DEV = { id: 1, type: "dev", github_id: 10, nivel: "iniciante" };

function montarApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { user: DEV };
    next();
  });
  app.use("/api/ai", aiRoutes);
  return app;
}

const indisponivel = () => new ErroIA("A IA está indisponível no momento. Tente novamente em alguns minutos.", {
  tipo: "indisponivel",
  temporario: true,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("statusHttpDaIA", () => {
  test.each([
    [{ tipo: "tempo", temporario: true }, 503],
    [{ tipo: "limite", status: 429, temporario: true }, 503],
    [{ tipo: "indisponivel", temporario: true }, 503],
    [{ tipo: "config" }, 503],
    [{ tipo: "chave", status: 401 }, 503],
    [{ tipo: "json" }, 502],
    [{ tipo: "vazia" }, 502],
  ])("ErroIA %o → %i", (opcoes, esperado) => {
    expect(statusHttpDaIA(new ErroIA("falhou", opcoes))).toBe(esperado);
  });

  test("erro que não é da IA fica com o padrão de quem chama", () => {
    expect(statusHttpDaIA(new Error("ER_LOCK_WAIT_TIMEOUT"), 500)).toBe(500);
  });
});

// Conversa que não existe ou é de outro usuário, como mentorChat lança.
const naoEncontrada = () => Object.assign(new Error("Conversa não encontrada."), { name: "ConversaNaoEncontrada", status: 404 });

describe("histórico de conversas do mentor", () => {
  test("GET /mentor/conversas lista as conversas do usuário logado", async () => {
    listConversas.mockResolvedValue([{ id: 7, titulo: "Como estudar SQL?", atualizada_em: "2026-11-07T14:00:00.000Z" }]);

    const res = await request(montarApp()).get("/api/ai/mentor/conversas");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 7, titulo: "Como estudar SQL?", atualizada_em: "2026-11-07T14:00:00.000Z" }]);
    expect(listConversas).toHaveBeenCalledWith(DEV.id);
  });

  test("conta de empresa não lista conversas (recurso de dev)", async () => {
    const app = express();
    app.use((req, res, next) => { req.session = { user: { ...DEV, type: "empresa" } }; next(); });
    app.use("/api/ai", aiRoutes);

    const res = await request(app).get("/api/ai/mentor/conversas");
    expect(res.status).toBe(403);
    expect(listConversas).not.toHaveBeenCalled();
  });

  test("GET /mentor/historico?conversa=7 abre aquela conversa", async () => {
    getHistory.mockResolvedValue({ conversa: { id: 7, titulo: "SQL" }, mensagens: [] });

    const res = await request(montarApp()).get("/api/ai/mentor/historico?conversa=7");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ conversa: { id: 7, titulo: "SQL" }, mensagens: [] });
    expect(getHistory).toHaveBeenCalledWith(DEV.id, 7);
  });

  test("GET /mentor/historico sem conversa abre a mais recente", async () => {
    getHistory.mockResolvedValue({ conversa: null, mensagens: [] });

    await request(montarApp()).get("/api/ai/mentor/historico");
    expect(getHistory).toHaveBeenCalledWith(DEV.id, null);
  });

  test("conversa inválida: 400; de outro usuário: 404", async () => {
    const invalida = await request(montarApp()).get("/api/ai/mentor/historico?conversa=abc");
    expect(invalida.status).toBe(400);
    expect(getHistory).not.toHaveBeenCalled();

    getHistory.mockRejectedValue(naoEncontrada());
    const alheia = await request(montarApp()).get("/api/ai/mentor/historico?conversa=99");
    expect(alheia.status).toBe(404);
    expect(alheia.body).toEqual({ error: "Conversa não encontrada." });
  });

  test("POST /mentor/mensagem continua a conversa aberta e devolve a conversa", async () => {
    sendMessage.mockResolvedValue({ texto: "Use JOIN.", conversa: { id: 7, titulo: "SQL" } });

    const res = await request(montarApp()).post("/api/ai/mentor/mensagem").send({ mensagem: "E o JOIN?", conversa: "7" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ resposta: "Use JOIN.", conversa: { id: 7, titulo: "SQL" } });
    expect(sendMessage).toHaveBeenCalledWith(DEV.id, DEV.github_id, DEV.nivel, "E o JOIN?", undefined, 7);
  });

  test("POST /mentor/mensagem sem conversa começa uma nova; com conversa de outro usuário, 404", async () => {
    sendMessage.mockResolvedValue({ texto: "Olá!", conversa: { id: 8, titulo: "Oi" } });
    await request(montarApp()).post("/api/ai/mentor/mensagem").send({ mensagem: "Oi" });
    expect(sendMessage).toHaveBeenLastCalledWith(DEV.id, DEV.github_id, DEV.nivel, "Oi", undefined, null);

    sendMessage.mockRejectedValue(naoEncontrada());
    const res = await request(montarApp()).post("/api/ai/mentor/mensagem").send({ mensagem: "Oi", conversa: "99" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Conversa não encontrada." });
  });
});

describe("POST /api/ai/mentor/mensagem", () => {
  test("IA indisponível: 503 com mensagem amigável e o tipo do erro no log", async () => {
    sendMessage.mockRejectedValue(indisponivel());

    const res = await request(montarApp()).post("/api/ai/mentor/mensagem").send({ mensagem: "Oi" });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "Erro ao falar com o mentor. Tente novamente em instantes." });
    expect(console.error).toHaveBeenCalledWith("[POST /api/ai/mentor/mensagem]", {
      tipo: "indisponivel",
      status: null,
      motivo: "A IA está indisponível no momento. Tente novamente em alguns minutos.",
    });
  });

  test("falha interna (banco): 500", async () => {
    sendMessage.mockRejectedValue(new Error("ER_LOCK_WAIT_TIMEOUT"));

    const res = await request(montarApp()).post("/api/ai/mentor/mensagem").send({ mensagem: "Oi" });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Erro ao falar com o mentor. Tente novamente em instantes.");
  });
});

describe("GET /api/ai/insights-mercado", () => {
  test("IA indisponível sem cache para servir: 503", async () => {
    getInsightsFreshOrCached.mockRejectedValue(indisponivel());

    const res = await request(montarApp()).get("/api/ai/insights-mercado");
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("Erro ao gerar insights com IA. Tente novamente em instantes.");
  });

  test("sem vagas cadastradas continua 404", async () => {
    getInsightsFreshOrCached.mockRejectedValue(new Error("Nenhuma vaga com skills cadastradas ainda."));

    const res = await request(montarApp()).get("/api/ai/insights-mercado");
    expect(res.status).toBe(404);
  });
});

// server.js não é carregado nos testes (conecta no banco ao subir) — as
// checagens abaixo leem o código.
describe("server.js", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

  test("GET /health é público, vem antes da sessão e não chama IA nem banco", () => {
    const inicio = server.indexOf('app.get("/health"');
    expect(inicio).toBeGreaterThan(-1);
    expect(inicio).toBeLessThan(server.indexOf("app.use(session("));
    const handler = server.slice(inicio, server.indexOf("});", inicio));
    expect(handler).not.toMatch(/db\.|askGeminiJSON|isAuth|await/);
  });

  test("a subida avisa quando falta GEMINI_API_KEY", () => {
    expect(server).toMatch(/configuracaoIA\(\)/);
    expect(server).toMatch(/GEMINI_API_KEY não definida/);
  });
});
