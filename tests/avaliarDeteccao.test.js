// tests/avaliarDeteccao.test.js
// Etapa 9: partes puras de scripts/avaliar-deteccao.js (leitura do gabarito e
// comparação com o que foi detectado). A parte que fala com o GitHub e o banco
// só roda à mão.
const { lerGabarito, compararComGabarito } = require("../scripts/avaliar-deteccao");

describe("lerGabarito", () => {
  test("lê o CSV com cabeçalho, comentários, sim/não e espaços", () => {
    const { itens, erros } = lerGabarito([
      "# comentário", "github_login,skill,tem", "ana, React , sim", "ana,Python,não", "", "bia,Go,nao", "bia,Java,S",
    ].join("\r\n"));
    expect(erros).toEqual([]);
    expect(itens).toEqual([
      { login: "ana", skill: "React", tem: true },
      { login: "ana", skill: "Python", tem: false },
      { login: "bia", skill: "Go", tem: false },
      { login: "bia", skill: "Java", tem: true },
    ]);
  });

  test("aponta linhas inválidas sem quebrar", () => {
    const { itens, erros } = lerGabarito("github_login,skill,tem\nana,React\nana,Python,talvez\nbia,Go,sim");
    expect(itens).toEqual([{ login: "bia", skill: "Go", tem: true }]);
    expect(erros).toHaveLength(2);
    expect(erros[0]).toMatch(/linha 2/);
  });
});

describe("compararComGabarito", () => {
  test("conta acertos, falsos positivos e falsos negativos por skill (nome sem diferenciar caixa)", () => {
    const itens = [
      { login: "ana", skill: "React", tem: true },   // detectou → acerto
      { login: "ana", skill: "Go", tem: false },     // detectou → falso positivo
      { login: "bia", skill: "React", tem: true },   // não detectou → falso negativo
      { login: "bia", skill: "Go", tem: false },     // não detectou → acerto
    ];
    const detectadas = new Map([
      ["ana", new Map([["react", 60], ["go", 20]])],
      ["bia", new Map()],
    ]);
    const r = compararComGabarito(itens, detectadas);
    expect(r.map(({ casos, ...x }) => x)).toEqual([
      { skill: "Go", acertos: 1, falsosPositivos: 1, falsosNegativos: 0 },
      { skill: "React", acertos: 1, falsosPositivos: 0, falsosNegativos: 1 },
    ]);
    expect(r[0].casos).toEqual(["ana: detectou 20% e não tem"]);
    expect(r[1].casos).toEqual(["bia: tem e não detectou"]);
  });
});
