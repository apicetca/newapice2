// tests/perfilEvidencias.test.js
// Etapa 6 da análise de perfil: GET /api/user/profile devolve, em cada skill,
// as evidências ("por quê?") gravadas em user_skill_evidencias, e a view
// monta o "por quê?" sem injetar dados via innerHTML.
jest.mock("../database/db", () => ({ query: jest.fn() }));
jest.mock("../services/subscriptionService", () => ({
  getUserPlan: jest.fn().mockResolvedValue({ code: "dev_free", name: "Free", price_cents: 0, features: {} }),
}));
jest.mock("../services/githubAnalyzer", () => ({ analisarGitHub: jest.fn() }));

const fs = require("fs");
const path = require("path");
const db = require("../database/db");
const { getProfile } = require("../controllers/profileController");

const SKILLS = [
  { skill_id: 7, source: "github", confidence: 80, name: "React", type: "hard", category: "Frontend" },
  { skill_id: 9, source: "manual", confidence: 70, name: "Git",   type: "hard", category: "DevOps" },
];

function instalarFakeDb({ evidencias = [], semTabela = false } = {}) {
  db.query.mockImplementation(async (sql) => {
    const s = sql.toLowerCase();
    if (s.includes("from users")) return [[{ id: 1, email: "a@b.c", type: "dev", created_at: null }]];
    if (s.includes("from user_dev_profiles")) return [[{ nome: "Ana", github_login: "ana", nivel: "iniciante" }]];
    if (s.includes("from user_skill_evidencias")) {
      if (semTabela) { const e = new Error("no table"); e.code = "ER_NO_SUCH_TABLE"; throw e; }
      return [evidencias];
    }
    if (s.includes("from user_skills")) return [SKILLS.map(x => ({ ...x }))];
    throw new Error(`fakeDb: rota não mapeada: ${sql}`);
  });
}

function chamar() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return getProfile({ session: { user: { id: 1, github_id: 42, type: "dev" } } }, res).then(() => res);
}

beforeEach(() => jest.clearAllMocks());

describe("GET /api/user/profile — evidências por skill", () => {
  test("cada skill recebe suas evidências (repo, tipo, pontos); skill sem evidência recebe []", async () => {
    instalarFakeDb({ evidencias: [
      { skill_id: 7, repo_full_name: "ana/loja", tipo: "dependencia", pontos: 40 },
      { skill_id: 7, repo_full_name: "ana/site", tipo: "readme", pontos: 20 },
    ] });
    const res = await chamar();
    expect(res.statusCode).toBe(200);
    const [react, git] = res.body.skills;
    expect(react.evidencias).toEqual([
      { repo: "ana/loja", tipo: "dependencia", pontos: 40 },
      { repo: "ana/site", tipo: "readme", pontos: 20 },
    ]);
    expect(git.evidencias).toEqual([]);
    const consulta = db.query.mock.calls.find(([sql]) => /user_skill_evidencias/i.test(sql));
    expect(consulta[1]).toEqual([42]);
  });

  test("sem a tabela de evidências (migração não rodada) o perfil continua carregando", async () => {
    instalarFakeDb({ semTabela: true });
    const res = await chamar();
    expect(res.statusCode).toBe(200);
    expect(res.body.skills.every(s => Array.isArray(s.evidencias) && s.evidencias.length === 0)).toBe(true);
  });
});

describe("views — 'por quê?' e aviso em /repositorios", () => {
  const perfil = fs.readFileSync(path.join(__dirname, "..", "views", "perfil-dev.ejs"), "utf8").replace(/\r\n/g, "\n");
  const repos  = fs.readFileSync(path.join(__dirname, "..", "views", "repositorios.ejs"), "utf8");

  test("perfil-dev monta a tag com textContent, sem innerHTML com dados nem onclick inline", () => {
    const inicio = perfil.indexOf("function criarSkillTag");
    const fim = perfil.indexOf("function mostrarPorque");
    const final = perfil.indexOf("\n    }\n", fim);
    expect(inicio).toBeGreaterThan(-1);
    expect(final).toBeGreaterThan(fim);
    const trecho = perfil.slice(inicio, final);
    expect(trecho).toMatch(/createTextNode\(sk\.name\)/);
    expect(trecho).not.toMatch(/innerHTML\s*=\s*`[^`]*\$\{/); // nenhum innerHTML interpolando dados
    expect(trecho).not.toMatch(/onclick=/);
    expect(trecho).toMatch(/Adicionada por você/);
  });

  test("perfil-dev tem o painel do 'por quê?'", () => {
    expect(perfil).toMatch(/id="skill-why"/);
    expect(perfil).toMatch(/por quê\?/);
  });

  test("repositorios avisa que a lista é a que conta na análise", () => {
    expect(repos).toContain("Os repositórios desta lista são os que contam na análise do seu perfil.");
  });
});
