// tests/trilha.test.js
// Testa routes/trilha.js com supertest. server.js tem efeitos colaterais
// ao ser importado (conecta no banco real, abre a porta) — por isso o
// teste monta um app Express mínimo que só registra sessão fake + o
// router sob teste, igual ao próprio app faria a partir de /trilha.
const request = require("supertest");
const express = require("express");
const path    = require("path");

jest.mock("../database/db", () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
  ready: Promise.resolve(),
}));

// gerarRoadmap/regenerarRoadmap não são o foco aqui (já cobertos em
// tests/roadmapService.test.js) — só precisamos que existam pra não
// quebrar o require do controller.
jest.mock("../services/roadmapService", () => ({
  gerarRoadmap: jest.fn(),
  regenerarRoadmap: jest.fn(),
}));

const db = require("../database/db");
const trilhaRoutes = require("../routes/trilha");

function montarApp(sessionUser) {
  const app = express();
  // mesmo view engine/views do server.js real — os controllers usam
  // res.render("404")/res.render("500") e as views de views/roadmap/*.
  app.set("views", path.join(__dirname, "..", "views"));
  app.set("view engine", "ejs");
  app.use(express.json());
  // Sessão fake — sem express-session/MySQLStore de verdade, só o shape
  // que requireDev/os controllers leem (req.session.user).
  app.use((req, res, next) => {
    req.session = sessionUser ? { user: sessionUser } : {};
    next();
  });
  app.use("/trilha", trilhaRoutes);
  return app;
}

const DEV_USER = { id: 1, type: "dev" };

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /trilha — sem login", () => {
  test("redireciona para /login", async () => {
    const app = montarApp(null);
    const res = await request(app).get("/trilha");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login");
  });
});

describe("GET /trilha/:id — roadmap de outro usuário", () => {
  test("responde 404 (não revela se o id existe)", async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.toLowerCase().includes("from roadmaps where id")) {
        return [[]]; // usuario_id não bate no WHERE → nenhuma linha
      }
      throw new Error(`rota não mapeada: ${sql}`);
    });

    const app = montarApp(DEV_USER);
    const res = await request(app).get("/trilha/999");

    expect(res.status).toBe(404);
  });
});

describe("POST /trilha — limite do plano Free atingido", () => {
  test("bloqueia a criação com mensagem amigável (nunca a tela de erro genérica)", async () => {
    db.query.mockImplementation(async (sql) => {
      const s = sql.toLowerCase();
      // subscriptionService.getUserPlan: sem assinatura ativa → cai no
      // DEFAULT_PLAN_BY_TYPE.dev = "dev_free" (config/plans.js real, não mockado).
      if (s.includes("from user_subscriptions")) return [[]];
      // Free = 1 roadmap ativo no máximo — já tem 1.
      if (s.includes("count(*)") && s.includes("from roadmaps")) return [[{ total: 1 }]];
      throw new Error(`rota não mapeada: ${sql}`);
    });

    const app = montarApp(DEV_USER);
    const res = await request(app)
      .post("/trilha")
      .send({ tipo: "area", area: "front-end", horasSemana: 10 });

    expect(res.status).toBe(402); // bloqueio por plano — não é a tela de erro (404/500)
    expect(res.text).toMatch(/limite de 1 roadmap/i);
    expect(res.text).toMatch(/\/planos/); // link de upgrade
  });
});

describe("POST /trilha/:id/regenerar — regra 'fallback não conta no limite'", () => {
  const { regenerarRoadmap } = require("../services/roadmapService");

  function mockDbComRoadmap(roadmap) {
    db.query.mockImplementation(async (sql) => {
      const s = sql.toLowerCase();
      if (s.includes("from roadmaps where id")) return [[roadmap]];
      if (s.includes("from user_subscriptions"))  return [[]]; // sem assinatura ativa → dev_free
      throw new Error(`rota não mapeada: ${sql}`);
    });
  }

  test("roadmap criado por fallback (origem='modelo') → Free consegue regenerar no mesmo dia", async () => {
    mockDbComRoadmap({
      id: 1, usuario_id: 1, origem: "modelo",
      gerado_em: new Date(), // agora mesmo — se a regra dependesse só da data, isso bloquearia
    });
    regenerarRoadmap.mockResolvedValue({ roadmapId: 1 });

    const app = montarApp(DEV_USER);
    const res = await request(app).post("/trilha/1/regenerar");

    expect(res.status).toBe(302); // não foi bloqueado — redireciona pro detalhe
    expect(res.headers.location).toBe("/trilha/1");
    expect(regenerarRoadmap).toHaveBeenCalledWith(1);
  });

  test("roadmap criado pela IA (origem='ia') → Free bloqueado com 402 até completar o intervalo", async () => {
    mockDbComRoadmap({
      id: 2, usuario_id: 1, origem: "ia",
      gerado_em: new Date(), // dentro dos 30 dias do plano Free
    });

    const app = montarApp(DEV_USER);
    const res = await request(app).post("/trilha/2/regenerar");

    expect(res.status).toBe(402);
    expect(res.text).toMatch(/próxima regeneração/i);
    expect(regenerarRoadmap).not.toHaveBeenCalled();
  });
});
