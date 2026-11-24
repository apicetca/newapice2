// tests/pesosDasFontes.test.js
// Títulos e botões usam Roboto Mono 600/700 e Montserrat 800. Se esses pesos não forem
// baixados, o navegador "engorda" a letra sozinho (negrito falso) e o branco fica borrado,
// com aspecto brilhante. DM Mono não existe em negrito (só 300/400/500).
const fs = require("fs");
const path = require("path");

const ler = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

test("design-system.css baixa todos os pesos usados", () => {
  const css = ler("public/css/design-system.css");
  expect(css).toContain("family=Montserrat:wght@400;500;600;700;800");
  expect(css).toContain("family=Roboto+Mono:wght@400;500;600;700");
});

test("'% de match' da vitrine de vagas não pede negrito à DM Mono", () => {
  const css = ler("public/css/vagas.css");
  const regra = css.slice(css.indexOf(".vagas-card__match {"), css.indexOf("}", css.indexOf(".vagas-card__match {")));
  expect(regra).toMatch(/font-weight: 500;/);
});
