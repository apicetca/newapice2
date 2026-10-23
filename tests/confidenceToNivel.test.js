// tests/confidenceToNivel.test.js
// Rede de segurança (Etapa 1 do plano de melhorias da análise de perfil):
// confidenceToNivel (services/roadmapService.js) NÃO é exportada e a etapa
// proíbe alterar código, então as faixas são exercitadas pelo caminho
// público que a usa: montarGap (objetivo "vaga") devolve `nivel_atual`
// = confidenceToNivel(confiança da skill). Faixas do doc (seção 2):
//   0 ou menos → null | 1–40 → iniciante | 41–70 → intermediario | >70 → avancado
jest.mock("../database/db", () => ({ query: jest.fn() }));

const db = require("../database/db");
const { montarGap } = require("../services/roadmapService");

const GITHUB_ID = 99;

function instalarFakeDb(confidence) {
  db.query.mockImplementation(async (sql) => {
    const s = sql.toLowerCase();
    if (s.includes("from user_dev_profiles")) return [[{ github_id: GITHUB_ID, nivel: "iniciante" }]];
    if (s.includes("from user_skills")) {
      return [confidence == null ? [] : [{ skill_id: 1, confidence }]];
    }
    if (s.includes("from job_skills")) {
      return [[{ skill_id: 1, importance: "obrigatoria", habilidade: "JavaScript" }]];
    }
    throw new Error(`fakeDb: rota não mapeada: ${sql}`);
  });
}

async function nivelPara(confidence) {
  instalarFakeDb(confidence);
  const gap = await montarGap(1, { tipo: "vaga", vagaId: 10 });
  return gap.requisitos[0];
}

beforeEach(() => jest.clearAllMocks());

describe("confidenceToNivel (via montarGap)", () => {
  test.each([
    [0,   null],
    [1,   "iniciante"],
    [40,  "iniciante"],
    [41,  "intermediario"],
    [70,  "intermediario"],
    [71,  "avancado"],
    [100, "avancado"],
  ])("confiança %i → %s", async (confianca, nivelEsperado) => {
    const req = await nivelPara(confianca);
    expect(req.nivel_atual).toBe(nivelEsperado);
  });

  test("skill ausente em user_skills equivale a confiança 0 → null", async () => {
    const req = await nivelPara(null);
    expect(req.nivel_atual).toBeNull();
  });

  test("na vaga o gap é binário: tem_gap só quando a confiança é 0", async () => {
    expect((await nivelPara(0)).tem_gap).toBe(true);
    expect((await nivelPara(1)).tem_gap).toBe(false);
    expect((await nivelPara(100)).tem_gap).toBe(false);
  });
});
