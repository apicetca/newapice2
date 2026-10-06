// tests/matchProjetado.test.js
// Prova que roadmapController.getPublicJob calcula matchProjetado quando
// existe um roadmap ativo para a vaga, não calcula nada quando não existe
// (SEM roadmap — resposta idêntica à de antes), e que uma falha nessa
// etapa nunca derruba o match normal (docs/roadmap-spec.md, "Integrações").
jest.mock("../database/db", () => ({ query: jest.fn() }));

const db = require("../database/db");
const roadmapController = require("../controllers/roadmapController");

const JOB = { id: 10, title: "Vaga Teste", level: "estagio", active: 1 };

function montarReqRes({ userId = 1, githubId = 123 } = {}) {
  const req = {
    params: { id: 10 },
    session: { user: { id: userId, github_id: githubId, type: "dev", nivel: "iniciante" } },
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return { req, res };
}

function instalarFakeDb({ roadmap = null, etapas = [] } = {}) {
  db.query.mockImplementation(async (sql) => {
    const s = sql.toLowerCase().replace(/\s+/g, " ").trim();
    if (s.startsWith("select * from jobs")) return [[JOB]];
    if (s.includes("from job_skills js join skills s")) {
      return [[{ skill_id: 1, importance: "obrigatoria", learn_order: 1, name: "JavaScript", type: "hard" }]];
    }
    if (s.includes("from user_skills")) return [[]];
    if (s.includes("from job_applications")) return [[]];
    if (s.startsWith("select id from roadmaps")) {
      if (roadmap === "throw") throw new Error("banco fora do ar");
      return [[roadmap]];
    }
    if (s.includes("from roadmap_etapas re join roadmap_fases rf")) return [etapas];
    throw new Error(`fakeDb: rota não mapeada: ${sql}`);
  });
}

beforeEach(() => jest.clearAllMocks());

describe("getPublicJob — matchProjetado", () => {
  test("SEM roadmap ativo para a vaga: matchProjetado null, resposta igual à de antes", async () => {
    instalarFakeDb({ roadmap: null });
    const { req, res } = montarReqRes();

    await roadmapController.getPublicJob(req, res);

    expect(res.body.matchProjetado).toBeNull();
    expect(res.body.match).toBeTruthy();
  });

  test("COM roadmap ativo cobrindo a skill que falta: matchProjetado sobe", async () => {
    instalarFakeDb({
      roadmap: { id: 5 },
      etapas: [{ habilidade: "JavaScript" }],
    });
    const { req, res } = montarReqRes();

    await roadmapController.getPublicJob(req, res);

    expect(res.body.matchProjetado).toBe(100);
    expect(res.body.matchProjetado).toBeGreaterThan(res.body.match.match);
  });

  test("erro ao calcular o projetado: match normal continua respondendo (try/catch)", async () => {
    instalarFakeDb({ roadmap: "throw" });
    const { req, res } = montarReqRes();

    await roadmapController.getPublicJob(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.matchProjetado).toBeNull();
    expect(res.body.match).toBeTruthy(); // o match de verdade não foi afetado
  });
});
