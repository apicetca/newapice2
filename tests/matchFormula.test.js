// tests/matchFormula.test.js
// Rede de segurança (Etapa 1 do plano de melhorias da análise de perfil):
// registra o comportamento ATUAL das três funções puras do match
// (docs/analise-perfil.md, seção 3). Se uma mudança futura alterar algum
// destes números sem querer, o teste pega.
jest.mock("../database/db", () => ({ query: jest.fn() }));
jest.mock("../services/geminiClient", () => ({ askGeminiJSON: jest.fn() }));

const {
  computeSkillsScore, computeSeniorityScore, computeMatch,
} = require("../services/matchCalculator");

const obrig = (skill_id) => ({ skill_id, importance: "obrigatoria" });
const desej = (skill_id) => ({ skill_id, importance: "desejavel" });

// Exemplo da seção 3 do doc: JavaScript(1) e React(2) obrigatórias,
// SQL(3) e Git(4) desejáveis.
const VAGA_EXEMPLO = [obrig(1), obrig(2), desej(3), desej(4)];
const DEV_EXEMPLO = { 1: 80, 2: 80, 3: 0, 4: 70 };

describe("computeSkillsScore", () => {
  test("exemplo do doc: média ponderada 3,9 / 6 → 65", () => {
    expect(computeSkillsScore(DEV_EXEMPLO, VAGA_EXEMPLO)).toBe(65);
  });

  test("com SQL = 100 o total vai a 4,9 / 6 → 82 (arredondado)", () => {
    expect(computeSkillsScore({ ...DEV_EXEMPLO, 3: 100 }, VAGA_EXEMPLO)).toBe(82);
  });

  test("a nota sai de 0 a 100 (não de 0 a 1)", () => {
    expect(computeSkillsScore({ 1: 100 }, [obrig(1)])).toBe(100);
    expect(computeSkillsScore({}, [obrig(1)])).toBe(0);
  });

  test("skill obrigatória pesa o dobro da desejável", () => {
    // só a obrigatória (peso 2) com 100: 2/3 → 67
    expect(computeSkillsScore({ 1: 100 }, [obrig(1), desej(2)])).toBe(67);
    // só a desejável (peso 1) com 100: 1/3 → 33
    expect(computeSkillsScore({ 2: 100 }, [obrig(1), desej(2)])).toBe(33);
  });

  test("vaga sem skills cadastradas → 100", () => {
    expect(computeSkillsScore({ 1: 10 }, [])).toBe(100);
  });

  test("skill ausente do mapa do dev conta como 0", () => {
    expect(computeSkillsScore({}, [obrig(1), desej(2)])).toBe(0);
  });
});

describe("computeSeniorityScore", () => {
  test.each([
    // [nivel do dev, level da vaga, nota esperada]
    ["iniciante",     "estagio", 100], // diferença 0
    ["intermediario", "junior",  100],
    ["avancado",      "pleno",   100],
    ["avancado",      "estagio", 100], // dev acima da vaga (diferença negativa)
    ["iniciante",     "junior",   55], // diferença 1
    ["intermediario", "pleno",    55],
    ["iniciante",     "pleno",    10], // diferença 2
  ])("dev %s × vaga %s → %i", (nivel, level, esperado) => {
    expect(computeSeniorityScore(nivel, level)).toBe(esperado);
  });

  test("nível do dev desconhecido → 100", () => {
    expect(computeSeniorityScore("guru", "junior")).toBe(100);
    expect(computeSeniorityScore(undefined, "junior")).toBe(100);
  });

  test("nível da vaga desconhecido → 100", () => {
    expect(computeSeniorityScore("iniciante", "senior")).toBe(100);
    expect(computeSeniorityScore("iniciante", undefined)).toBe(100);
  });
});

describe("computeMatch", () => {
  test("exemplo do doc: vaga júnior, dev iniciante → skills 65, senioridade 55, match 64", () => {
    expect(computeSkillsScore(DEV_EXEMPLO, VAGA_EXEMPLO)).toBe(65);
    expect(computeSeniorityScore("iniciante", "junior")).toBe(55);
    expect(computeMatch(DEV_EXEMPLO, VAGA_EXEMPLO, "iniciante", "junior")).toBe(64);
  });

  test("exemplo do doc com SQL = 100 (projeção do roadmap) → match 78", () => {
    expect(computeMatch({ ...DEV_EXEMPLO, 3: 100 }, VAGA_EXEMPLO, "iniciante", "junior")).toBe(78);
  });

  test("pesos 85% skills + 15% senioridade", () => {
    // skills 0, senioridade 100 → 15
    expect(computeMatch({}, [obrig(1)], "avancado", "estagio")).toBe(15);
    // skills 100, senioridade 10 → round(85 + 1,5) = 87
    expect(computeMatch({ 1: 100 }, [obrig(1)], "iniciante", "pleno")).toBe(87);
  });

  test("vaga sem skills → só a senioridade decide a nota de skills (100)", () => {
    expect(computeMatch({}, [], "iniciante", "estagio")).toBe(100);
    expect(computeMatch({}, [], "iniciante", "pleno")).toBe(87);
  });

  test("sem nível do dev, a senioridade não penaliza (100)", () => {
    expect(computeMatch({ 1: 100 }, [obrig(1)], undefined, "pleno")).toBe(100);
    expect(computeMatch({ 1: 100 }, [obrig(1)], null, "pleno")).toBe(100);
  });

  test("nível da vaga desconhecido não penaliza", () => {
    expect(computeMatch({ 1: 100 }, [obrig(1)], "iniciante", "senior")).toBe(100);
  });

  test("teto de 100 mesmo com confiança acima de 100 no mapa", () => {
    expect(computeMatch({ 1: 500 }, [obrig(1)], "avancado", "estagio")).toBe(100);
  });
});
