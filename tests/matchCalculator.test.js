// tests/matchCalculator.test.js
// Prova que calculateJobMatch funciona COM e SEM profileData.habilidadesAdquiridas
// (usado pra calcular "compatibilidade ao concluir o roadmap" —
// docs/roadmap-spec.md, "Integrações") — sem esse campo, comportamento
// idêntico ao de antes (todo chamador existente não passa esse campo).
jest.mock("../database/db", () => ({ query: jest.fn() }));

const db = require("../database/db");
const { calculateJobMatch } = require("../services/matchCalculator");

const JOB_SKILLS = [
  { skill_id: 1, importance: "obrigatoria", learn_order: 1, name: "JavaScript", type: "hard" },
  { skill_id: 2, importance: "obrigatoria", learn_order: 2, name: "React",      type: "hard" },
];

function instalarFakeDb(userSkillRows = []) {
  db.query.mockImplementation(async (sql) => {
    const s = sql.toLowerCase();
    if (s.includes("from job_skills")) return [JOB_SKILLS];
    if (s.includes("from user_skills")) return [userSkillRows];
    throw new Error(`fakeDb: rota não mapeada: ${sql}`);
  });
}

beforeEach(() => jest.clearAllMocks());

describe("calculateJobMatch", () => {
  test("SEM habilidadesAdquiridas: comportamento igual ao de sempre (sem o campo)", async () => {
    instalarFakeDb([]); // usuário não tem nenhuma das duas skills

    const resultado = await calculateJobMatch(1, 10, { nivel: "iniciante", jobLevel: "estagio" });

    expect(resultado.match).toBe(15); // skills 0% (peso .85) + senioridade neutra 100% (peso .15) = 15
  });

  test("COM habilidadesAdquiridas: projeta as skills do roadmap como 100% adquiridas", async () => {
    instalarFakeDb([]); // continua sem nenhuma skill de verdade

    const semRoadmap = await calculateJobMatch(1, 10, { nivel: "iniciante", jobLevel: "estagio" });
    const comRoadmap  = await calculateJobMatch(1, 10, {
      nivel: "iniciante", jobLevel: "estagio",
      habilidadesAdquiridas: ["JavaScript", "React"],
    });

    expect(semRoadmap.match).toBe(15);
    expect(comRoadmap.match).toBe(100); // as duas skills da vaga, projetadas como já sabidas
    expect(comRoadmap.match).toBeGreaterThan(semRoadmap.match);
  });

  test("habilidadesAdquiridas que não batem com nenhuma skill da vaga: sem efeito no match", async () => {
    instalarFakeDb([]);

    const resultado = await calculateJobMatch(1, 10, {
      habilidadesAdquiridas: ["Uma Habilidade Que Não Existe Nessa Vaga"],
    });

    expect(resultado.match).toBe(15); // sem bater nenhuma skill, mesmo baseline de senioridade
  });
});
