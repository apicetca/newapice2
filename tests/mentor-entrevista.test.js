// tests/mentor-entrevista.test.js
// O simulador de entrevista saiu do site (página, menu, API e recurso de
// plano) e o que ele fazia com IA passou para o mentor de carreira: uma
// pergunta técnica por vez, adequada ao nível, às skills e aos requisitos
// da vaga, seguida de feedback construtivo de 3 a 5 frases.
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
jest.mock("../services/subscriptionService", () => ({
  hasFeature: jest.fn().mockResolvedValue(true),
}));
jest.mock("../services/geminiClient", () => ({
  askGeminiJSON: jest.fn(),
  chatTurn: jest.fn(),
  sendFunctionResults: jest.fn(),
  MODEL: "modelo-de-teste",
}));
jest.mock("../services/userContextService", () => ({
  buildUserContextBlock: jest.fn().mockResolvedValue(""),
  getSkillsSummary: jest.fn(),
  getReposSummary: jest.fn(),
  getNivel: jest.fn(),
}));
jest.mock("../services/matchCalculator", () => ({
  calculateJobMatch: jest.fn(),
  getMatchExplanation: jest.fn(),
}));
jest.mock("../services/roadmapGenerator", () => ({ generateRoadmap: jest.fn() }));
jest.mock("../services/marketInsights", () => ({ getInsightsFreshOrCached: jest.fn() }));

const db = require("../database/db");
const { chatTurn } = require("../services/geminiClient");
const { TOOL_DECLARATIONS, executeTool } = require("../services/aiTools");
const { sendMessage } = require("../services/mentorChat");
const aiRoutes = require("../routes/ai");

const ROOT = path.join(__dirname, "..");
const ler  = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");
const DEV  = { id: 1, type: "dev", github_id: 10, nivel: "iniciante" };

function montarApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { user };
    next();
  });
  app.use("/api/ai", aiRoutes);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
});

describe("simulador de entrevista removido do site", () => {
  test.each(["/api/ai/entrevista/iniciar", "/api/ai/entrevista/1/responder"])(
    "POST %s não existe mais",
    async url => {
      db.query.mockResolvedValue([[]]);
      const res = await request(montarApp(DEV)).post(url).send({ resposta: "Closures guardam o escopo." });
      expect(res.status).toBe(404);
    }
  );

  test("não sobra página, serviço nem link no menu do dev", () => {
    expect(fs.existsSync(path.join(ROOT, "views", "entrevista.ejs"))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "services", "interviewSimulator.js"))).toBe(false);
    expect(ler("views/partials/header-dev.ejs")).not.toMatch(/href="\/entrevista"/);
  });

  test("os planos não oferecem mais o simulador como recurso separado", () => {
    const { PLANS } = require("../config/plans");
    for (const plan of Object.values(PLANS)) {
      expect(plan.features ?? {}).not.toHaveProperty("simulador_entrevista");
    }
  });
});

describe("mentor assume a simulação de entrevista técnica", () => {
  test("a instrução do mentor traz o modo entrevistador: uma pergunta por vez e feedback de 3 a 5 frases", async () => {
    db.query.mockResolvedValue([[]]);
    chatTurn.mockResolvedValue({ interactionId: "i-1", text: "Primeira pergunta...", functionCalls: [] });

    await sendMessage(DEV.id, DEV.github_id, DEV.nivel, "Quero simular uma entrevista técnica.");

    const { system } = chatTurn.mock.calls[0][0];
    expect(system).toMatch(/entrevistador técnico/i);
    expect(system).toMatch(/UMA pergunta/);
    expect(system).toMatch(/3 a 5 frases/);
    expect(system).toMatch(/buscarRequisitosVaga/);
  });

  test("a ferramenta buscarRequisitosVaga está declarada para o modelo", () => {
    expect(TOOL_DECLARATIONS.map(t => t.name)).toContain("buscarRequisitosVaga");
  });

  test("buscarRequisitosVaga devolve a vaga e as skills exigidas com a importância de cada uma", async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 5, title: "Estágio Back-end", level: "estagio", modality: "remoto" }]])
      .mockResolvedValueOnce([[
        { name: "Node.js", importance: "obrigatoria" },
        { name: "SQL", importance: "desejavel" },
      ]]);

    const out = await executeTool("buscarRequisitosVaga", { job_id: 5 }, { userId: DEV.id, githubId: DEV.github_id });
    expect(out).toEqual({
      vaga: "Estágio Back-end",
      nivel: "estagio",
      modalidade: "remoto",
      requisitos: [
        { skill: "Node.js", importancia: "obrigatoria" },
        { skill: "SQL", importancia: "desejavel" },
      ],
    });
  });

  test("buscarRequisitosVaga recusa job_id inválido e vaga inativa", async () => {
    expect(await executeTool("buscarRequisitosVaga", { job_id: "abc" }, {})).toEqual({ erro: "job_id inválido." });

    db.query.mockResolvedValueOnce([[]]);
    expect(await executeTool("buscarRequisitosVaga", { job_id: 9 }, {}))
      .toEqual({ erro: "Vaga não encontrada ou não está mais ativa." });
  });

  test("a tela do mentor tem o atalho para começar a simulação", () => {
    const view = ler("views/mentor.ejs");
    expect(view).toContain('id="btn-mentor-entrevista"');
    expect(view).toMatch(/Simular uma entrevista técnica/);
  });
});
