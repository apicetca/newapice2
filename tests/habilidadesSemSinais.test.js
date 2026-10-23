// tests/habilidadesSemSinais.test.js
// Etapa 3: o script scripts/habilidades-sem-sinais.js lista as habilidades
// das etapas que a verificação automática não consegue checar. Testa a
// classificação (parte pura); a consulta ao banco é só leitura.
const { classificar, CONSULTA } = require("../scripts/habilidades-sem-sinais");

describe("habilidades-sem-sinais — classificar", () => {
  test("separa 'sem skill com esse nome' e 'skill sem github_signals', e ignora as verificáveis", () => {
    const lista = classificar([
      { habilidade: "JavaScript", etapas: 12, skill_id: 1, github_signals: "javascript,js" },
      { habilidade: "Comunicação", etapas: 3, skill_id: null, github_signals: null },
      { habilidade: "Git", etapas: 7, skill_id: 2, github_signals: "" },
      { habilidade: "Scrum", etapas: 7, skill_id: 3, github_signals: " , " },
    ]);
    expect(lista).toEqual([
      { habilidade: "Git", etapas: 7, motivo: "skill sem github_signals" },
      { habilidade: "Scrum", etapas: 7, motivo: "skill sem github_signals" },
      { habilidade: "Comunicação", etapas: 3, motivo: "sem skill com esse nome" },
    ]);
  });

  test("ordena pelas mais usadas primeiro (contagem de etapas)", () => {
    const lista = classificar([
      { habilidade: "A", etapas: 1, skill_id: null },
      { habilidade: "B", etapas: "9", skill_id: null }, // COUNT(*) pode vir como string
    ]);
    expect(lista.map(h => h.habilidade)).toEqual(["B", "A"]);
    expect(lista[0].etapas).toBe(9);
  });

  test("lista vazia quando tudo é verificável", () => {
    expect(classificar([{ habilidade: "JavaScript", etapas: 1, skill_id: 1, github_signals: "js" }])).toEqual([]);
  });

  test("a consulta é só leitura", () => {
    expect(CONSULTA.trim()).toMatch(/^SELECT/i);
    expect(CONSULTA).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i);
  });
});
