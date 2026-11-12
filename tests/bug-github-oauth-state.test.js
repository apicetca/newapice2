// Bug: "[github-oauth] state inválido ou ausente no callback" ao entrar com
// GitHub. A sessão guardava UM state só: clicar de novo em "Continuar com
// GitHub" (ou abrir duas abas) enquanto o GitHub pedia a verificação do
// dispositivo sobrescrevia o state, e a volta do primeiro login era recusada.
// Reproduzido com curl contra o servidor real antes da correção. Também:
// login começado em outro endereço (127.0.0.1 × APP_URL=localhost) perdia o
// cookie da sessão, e a tela de login mostrava "Erro inesperado: invalid_state".
process.env.APP_URL = "http://localhost:3000";

jest.mock("axios", () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock("../database/db", () => ({ query: jest.fn() }));
jest.mock("../services/githubAnalyzer", () => ({ matchSkillsFromGitHub: jest.fn().mockResolvedValue() }));

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const db = require("../database/db");
const authController = require("../controllers/authController");

function login(session, { host = "localhost:3000", query = {} } = {}) {
  const res = { redirect: jest.fn() };
  const url = "/auth/github" + (query.next ? `?next=${encodeURIComponent(query.next)}` : "");
  authController.githubLogin({ session, query, originalUrl: url, get: h => (h.toLowerCase() === "host" ? host : undefined) }, res);
  const location = res.redirect.mock.calls[0][0];
  return { location, state: new URL(location, "http://x").searchParams.get("state") };
}

async function callback(session, state) {
  const res = { redirect: jest.fn() };
  await authController.githubCallback({ session, query: { code: "codigo", state } }, res);
  return res.redirect.mock.calls[0][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  // Troca do code: sem access_token → /login?error=token_failed. Chegar
  // nesse ponto prova que o state foi aceito.
  axios.post.mockResolvedValue({ data: {} });
});
afterEach(() => jest.restoreAllMocks());

describe("Bug — state do login com GitHub", () => {
  test("um clique: o state volta e é aceito", async () => {
    const session = {};
    const { state } = login(session);
    expect(await callback(session, state)).toBe("/login?error=token_failed");
  });

  test("dois cliques (ou duas abas) antes de voltar do GitHub: os dois logins são aceitos", async () => {
    const session = {};
    const first = login(session).state;
    const second = login(session).state;
    expect(first).not.toBe(second);
    expect(await callback(session, first)).toBe("/login?error=token_failed");
    expect(await callback(session, second)).toBe("/login?error=token_failed");
  });

  test("o state só vale uma vez", async () => {
    const session = {};
    const { state } = login(session);
    await callback(session, state);
    expect(await callback(session, state)).toBe("/login?error=invalid_state");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("não há login com GitHub em andamento"));
  });

  test("state desconhecido (CSRF) continua recusado, com o motivo no log", async () => {
    const session = {};
    login(session);
    expect(await callback(session, "f".repeat(32))).toBe("/login?error=invalid_state");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("não corresponde a nenhum login em andamento"));
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("sem state na URL → recusado", async () => {
    const session = {};
    login(session);
    expect(await callback(session, undefined)).toBe("/login?error=invalid_state");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("sem o parâmetro state"));
  });

  test("state expira em 10 minutos", async () => {
    const session = {};
    const { state } = login(session);
    session.oauthStates[0].exp = Date.now() - 1;
    expect(await callback(session, state)).toBe("/login?error=invalid_state");
  });

  test("guarda no máximo 5 logins pendentes (a sessão não cresce sem limite)", () => {
    const session = {};
    for (let i = 0; i < 8; i++) login(session);
    expect(session.oauthStates).toHaveLength(5);
  });

  test("login começado em outro endereço recomeça no endereço do APP_URL (o cookie da sessão volta junto)", () => {
    const session = {};
    const { location } = login(session, { host: "127.0.0.1:3000", query: { next: "/planos" } });
    expect(location).toBe("http://localhost:3000/auth/github?next=%2Fplanos");
    expect(session.oauthStates).toBeUndefined();
  });

  test("com login bem-sucedido, volta para a página pedida (?next=) daquele login", async () => {
    axios.post.mockResolvedValue({ data: { access_token: "gho_token" } });
    axios.get
      .mockResolvedValueOnce({ data: { id: 99, login: "ana", name: "Ana", email: "ana@exemplo.com", avatar_url: "https://avatars.githubusercontent.com/u/99" } })
      .mockResolvedValueOnce({ data: [] });
    db.query.mockImplementation(async sql => {
      if (sql.startsWith("SELECT id, type, active FROM users")) return [[{ id: 7, type: "dev", active: 1 }]];
      if (sql.includes("SELECT nivel, avatar_url")) return [[{ nivel: "iniciante", avatar_url: null }]];
      return [{}];
    });

    const session = {};
    const { state } = login(session, { query: { next: "/planos/dev_pro/assinar" } });
    login(session); // um segundo clique sem next não interfere
    expect(await callback(session, state)).toBe("/planos/dev_pro/assinar");
    expect(session.user).toMatchObject({ id: 7, type: "dev" });
  });

  test("a tela de login traduz o erro invalid_state", () => {
    const view = fs.readFileSync(path.join(__dirname, "..", "views", "login.ejs"), "utf8");
    expect(view).toMatch(/invalid_state:\s*"Seu login com o GitHub expirou/);
  });
});
