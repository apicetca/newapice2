// tests/assinarResponsivo.test.js
// /planos/:id/assinar no celular: com "1fr" a coluna única cresce com o conteúdo
// (o cartão do Mercado Pago é largo) e o card do plano sai da tela.
const fs = require("fs");
const path = require("path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "public", "css", "assinatura.css"), "utf8").replace(/\r\n/g, "\n");

describe("assinatura.css — checkout responsivo", () => {
  test("no celular a coluna única é minmax(0, 1fr) (nunca 1fr sozinho)", () => {
    const bloco = CSS.match(/@media \(max-width: 860px\) \{[\s\S]*?\n\}/)[0];
    expect(bloco).toMatch(/\.sub-layout \{ grid-template-columns: minmax\(0, 1fr\);/);
    expect(bloco).not.toMatch(/grid-template-columns: 1fr;/);
  });

  test("os filhos do grid podem encolher e o texto do resumo quebra", () => {
    expect(CSS).toMatch(/\.sub-layout > \* \{ min-width: 0; \}/);
    expect(CSS).toMatch(/\.sub-summary \{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere;/);
  });
});
