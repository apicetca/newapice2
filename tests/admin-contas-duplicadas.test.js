// tests/admin-contas-duplicadas.test.js
// Uma mesma pessoa pode ter mais de uma conta dev: a criada pelo login do
// GitHub e outra de e-mail e senha (com o mesmo @login digitado no perfil).
// O admin trocava o plano de uma delas e a pessoa entrava pela outra,
// continuando no Gratuito. A lista do admin agora diz como cada conta
// entra e quais outras contas usam o mesmo GitHub, para o admin aplicar
// o plano em todas.
//
// O banco é sempre simulado: o .env local aponta para o banco de produção.
const fs      = require("fs");
const path    = require("path");
const express = require("express");
const request = require("supertest");

jest.mock("../database/db", () => ({ query: jest.fn(), getConnection: jest.fn() }));
jest.mock("../services/subscriptionService", () => ({
  setUserPlan: jest.fn(),
  getPlanCodesBulk: jest.fn(),
}));
jest.mock("../services/matchCalculator", () => ({ computeMatch: jest.fn() }));

const db = require("../database/db");
const { getPlanCodesBulk } = require("../services/subscriptionService");
const adminRoutes = require("../routes/admin");

function montarApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { user: { id: 1, type: "admin" } };
    next();
  });
  app.use("/api/admin", adminRoutes);
  return app;
}

const linha = extra => ({
  email: null, active: 1, created_at: "2026-06-17T00:00:00.000Z", tem_senha: 0,
  nome: null, sobrenome: null, nivel: "iniciante", github_login: null, github_id: null,
  ...extra,
});

beforeEach(() => jest.clearAllMocks());

describe("GET /api/admin/users — contas da mesma pessoa", () => {
  beforeEach(() => {
    db.query.mockResolvedValueOnce([[
      // entra pelo GitHub (e-mail noreply, github_id vindo do OAuth)
      linha({ id: 18, email: "nimsai07@users.noreply.github.com", github_login: "nimsai07", github_id: 174729074 }),
      // e-mail e senha, com o mesmo @login digitado no perfil
      linha({ id: 54, email: "outra@gmail.com", tem_senha: 1, github_login: "NimSai07" }),
      // GitHub sem github_login no perfil: o login vem do e-mail noreply
      linha({ id: 70, email: "12345+nimsai07@users.noreply.github.com", github_id: 999 }),
      // pessoa sem relação nenhuma
      linha({ id: 3, email: "fulano@gmail.com", tem_senha: 1 }),
    ]]);
    getPlanCodesBulk.mockResolvedValueOnce({ 18: "dev_free", 54: "dev_pro", 70: "dev_free", 3: "dev_free" });
  });

  test("diz como cada conta entra", async () => {
    const res = await request(montarApp()).get("/api/admin/users");
    expect(res.status).toBe(200);
    const porId = Object.fromEntries(res.body.map(u => [u.id, u]));
    expect(porId[18]).toMatchObject({ login_github: true,  login_email: false });
    expect(porId[54]).toMatchObject({ login_github: false, login_email: true });
  });

  test("lista as outras contas com o mesmo GitHub, com o plano de cada uma", async () => {
    const res = await request(montarApp()).get("/api/admin/users");
    const porId = Object.fromEntries(res.body.map(u => [u.id, u]));

    expect(porId[54].outras_contas).toEqual([
      { id: 18, email: "nimsai07@users.noreply.github.com", login_github: true, plan_code: "dev_free" },
      { id: 70, email: "12345+nimsai07@users.noreply.github.com", login_github: true, plan_code: "dev_free" },
    ]);
    expect(porId[18].outras_contas.map(o => o.id)).toEqual([54, 70]);
    expect(porId[3].outras_contas).toEqual([]);
  });

  test("não expõe github_id nem o hash da senha", async () => {
    const res = await request(montarApp()).get("/api/admin/users");
    for (const u of res.body) {
      expect(u).not.toHaveProperty("github_id");
      expect(u).not.toHaveProperty("tem_senha");
      expect(u).not.toHaveProperty("password_hash");
    }
  });
});

describe("tela de usuários do admin", () => {
  const view = fs.readFileSync(path.join(__dirname, "..", "views", "admin-usuarios.ejs"), "utf8");

  test("ao trocar o plano, oferece aplicar nas outras contas da mesma pessoa", () => {
    expect(view).toMatch(/outras_contas/);
    expect(view).toMatch(/confirm\(/);
  });

  test("mostra como a conta entra (GitHub ou e-mail e senha)", () => {
    expect(view).toMatch(/login_github/);
    expect(view).toMatch(/entra pelo GitHub/);
  });
});
