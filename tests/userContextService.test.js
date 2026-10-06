// tests/userContextService.test.js
// Prova que buildUserContextBlock funciona COM e SEM roadmap ativo, e que
// uma falha ao buscar o roadmap nunca derruba o resto do contexto (o
// mentor continua funcionando como antes — docs/roadmap-spec.md,
// "Integrações").
jest.mock("../database/db", () => ({ query: jest.fn() }));

const db = require("../database/db");
const { buildUserContextBlock } = require("../services/userContextService");

const USER = { id: 1, github_id: 123 };

function instalarFakeDb(overrides = {}) {
  db.query.mockImplementation(async (sql) => {
    const s = sql.toLowerCase().replace(/\s+/g, " ").trim();
    if (s.includes("from user_dev_profiles")) return [[{ nivel: "iniciante" }]];
    if (s.includes("from user_skills")) return [[]];
    if (s.startsWith("select id, tipo_objetivo, area, vaga_id from roadmaps")) {
      if (overrides.roadmapsThrow) throw new Error("banco fora do ar");
      return [[overrides.roadmap ?? null]];
    }
    if (s.startsWith("select title from jobs")) return [[{ title: "Vaga de teste" }]];
    if (s.startsWith("select id, nome from roadmap_fases")) return [overrides.fases ?? []];
    if (s.startsWith("select fase_id, titulo, status from roadmap_etapas")) return [overrides.etapas ?? []];
    throw new Error(`fakeDb: rota não mapeada: ${sql}`);
  });
}

beforeEach(() => jest.clearAllMocks());

describe("buildUserContextBlock — com include 'roadmapAtivo'", () => {
  test("SEM roadmap ativo: bloco sai normal, sem nenhuma linha de roadmap", async () => {
    instalarFakeDb({ roadmap: null });
    const texto = await buildUserContextBlock(USER, ["nivel", "roadmapAtivo"]);

    expect(texto).toMatch(/Nível: iniciante/);
    expect(texto).not.toMatch(/Roadmap ativo/);
  });

  test("COM roadmap ativo (objetivo área): mostra fase e etapa atual", async () => {
    instalarFakeDb({
      roadmap: { id: 5, tipo_objetivo: "area", area: "front-end", vaga_id: null },
      fases: [{ id: 10, nome: "Fundamentos" }, { id: 11, nome: "Avançando" }],
      etapas: [
        { fase_id: 10, titulo: "HTML semântico", status: "concluida" },
        { fase_id: 10, titulo: "CSS", status: "em_andamento" },
        { fase_id: 11, titulo: "React", status: "pendente" },
      ],
    });

    const texto = await buildUserContextBlock(USER, ["roadmapAtivo"]);

    expect(texto).toMatch(/Roadmap ativo: área de front-end/);
    expect(texto).toMatch(/fase atual "Fundamentos"/);
    expect(texto).toMatch(/etapa atual "CSS"/);
    expect(texto).toMatch(/2 etapa\(s\) restante\(s\)/);
  });

  test("COM roadmap ativo (objetivo vaga): usa o título da vaga", async () => {
    instalarFakeDb({
      roadmap: { id: 6, tipo_objetivo: "vaga", area: null, vaga_id: 99 },
      fases: [],
      etapas: [],
    });

    const texto = await buildUserContextBlock(USER, ["roadmapAtivo"]);
    expect(texto).toMatch(/Roadmap ativo: vaga "Vaga de teste"/);
  });

  test("erro ao buscar o roadmap: contexto continua funcionando com o resto (nunca propaga)", async () => {
    instalarFakeDb({ roadmapsThrow: true });

    const texto = await buildUserContextBlock(USER, ["nivel", "roadmapAtivo"]);

    expect(texto).toMatch(/Nível: iniciante/);
    expect(texto).not.toMatch(/Roadmap ativo/);
  });
});
