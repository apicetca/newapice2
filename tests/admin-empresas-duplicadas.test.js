// tests/admin-empresas-duplicadas.test.js
// Mesma ideia de tests/admin-contas-duplicadas.test.js, para empresas: o
// plano vale por conta, e uma empresa pode ter mais de uma conta. A lista
// do admin aponta as outras contas da mesma empresa (mesmo CNPJ, ou mesmo
// nome fantasia/razão social) para o admin aplicar o plano em todas.
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

const empresa = extra => ({
  email: null, active: 1, created_at: "2026-06-17T00:00:00.000Z",
  nome_fantasia: null, razao_social: null, cnpj: null, setor: "tecnologia", tamanho: null,
  total_vagas: 0, vagas_ativas: 0,
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValueOnce([[
    empresa({ id: 30, email: "rh@acme.com",      nome_fantasia: "Acme",       cnpj: "12.345.678/0001-90" }),
    empresa({ id: 31, email: "vagas@acme.com",   nome_fantasia: "ACME Tech",  cnpj: "12345678000190" }),
    empresa({ id: 3,  email: "apice1@gmail.com", nome_fantasia: "Apice" }),
    empresa({ id: 16, email: "apice2@gmail.com", nome_fantasia: "Ápice" }),
    empresa({ id: 23, email: "a@teste.com",      nome_fantasia: "Teste" }),
    empresa({ id: 26, email: "b@teste.com",      nome_fantasia: "", razao_social: "Teste" }),
    empresa({ id: 40, email: "outra@x.com",      nome_fantasia: "Outra", cnpj: "99.999.999/0001-99" }),
  ]]);
  getPlanCodesBulk.mockResolvedValueOnce({
    30: "empresa_premium", 31: "empresa_free", 3: "empresa_free", 16: "empresa_free",
    23: "empresa_free", 26: "empresa_basico", 40: "empresa_free",
  });
});

describe("GET /api/admin/empresas — contas da mesma empresa", () => {
  test("mesmo CNPJ, mesmo com formatação diferente", async () => {
    const res = await request(montarApp()).get("/api/admin/empresas");
    expect(res.status).toBe(200);
    const porId = Object.fromEntries(res.body.map(e => [e.id, e]));
    expect(porId[31].outras_contas).toEqual([
      { id: 30, email: "rh@acme.com", nome: "Acme", plan_code: "empresa_premium", motivo: "CNPJ" },
    ]);
  });

  test("mesmo nome, ignorando acento, caixa e se é nome fantasia ou razão social", async () => {
    const res = await request(montarApp()).get("/api/admin/empresas");
    const porId = Object.fromEntries(res.body.map(e => [e.id, e]));
    expect(porId[3].outras_contas).toEqual([
      { id: 16, email: "apice2@gmail.com", nome: "Ápice", plan_code: "empresa_free", motivo: "nome" },
    ]);
    expect(porId[23].outras_contas).toEqual([
      { id: 26, email: "b@teste.com", nome: "Teste", plan_code: "empresa_basico", motivo: "nome" },
    ]);
  });

  test("empresa sem outra conta não recebe aviso", async () => {
    const res = await request(montarApp()).get("/api/admin/empresas");
    expect(res.body.find(e => e.id === 40).outras_contas).toEqual([]);
  });
});

describe("tela de empresas do admin", () => {
  const view = fs.readFileSync(path.join(__dirname, "..", "views", "admin-empresas.ejs"), "utf8");

  test("ao trocar o plano, oferece aplicar nas outras contas da mesma empresa", () => {
    expect(view).toMatch(/outras_contas/);
    expect(view).toMatch(/confirm\(/);
  });

  test("escapa e-mail e CNPJ antes de montar o HTML", () => {
    expect(view).toMatch(/escapeHtml\(e\.email\)/);
    expect(view).toMatch(/escapeHtml\(e\.cnpj\)/);
  });
});
