// tests/paginasPlanosPublicas.test.js
// /para-devs e /para-empresas renderizadas com o MESMO formato de dados que o
// server.js envia (precosPro → { mensal, anual, anualTotal }). A versão "tablet"
// de cada página tinha ficado com o formato antigo (planos.premium.preco,
// planos.basico, prices.pro como número): em /para-empresas a página inteira
// dava erro de render, e em /para-devs aparecia "R$[object Object]".
const path = require("path");
const ejs = require("ejs");

const VIEWS = path.join(__dirname, "..", "views");
const render = (view, locals) => ejs.renderFile(path.join(VIEWS, view), { user: null, ...locals }, { views: [VIEWS] });

const PRO_DEV = { mensal: "24,90", anual: "19,90", anualTotal: "238,80" };
const PRO_EMPRESA = { mensal: "99,99", anual: "79,90", anualTotal: "958,80" };

const paraDevs = () => render("para-devs.ejs", { currentPage: "para-devs", prices: { free: 0, pro: PRO_DEV, maxParcelas: 12 } });
const paraEmpresas = () => render("para-empresas.ejs", { currentPage: "para-empresas", planos: { free: { vagas: 1 }, premium: PRO_EMPRESA, maxParcelas: 12 } });

describe.each([
  ["para-devs", paraDevs, PRO_DEV],
  ["para-empresas", paraEmpresas, PRO_EMPRESA],
])("%s", (nome, renderizar, pro) => {
  test("renderiza sem erro e sem lixo de template (undefined / [object Object] / NaN)", async () => {
    const html = await renderizar();
    expect(html).not.toMatch(/\[object Object\]/);
    expect(html).not.toMatch(/R\$\s*(undefined|NaN|null)\b/);
    expect(html).not.toMatch(/>\s*undefined\s*</);
  });

  test("o preço mensal do PRO aparece nas duas versões (desktop e tablet)", async () => {
    const html = await renderizar();
    const tablet = html.slice(html.indexOf("VERSÃO TABLET"));
    const desktop = html.slice(0, html.indexOf("VERSÃO TABLET"));
    expect(desktop).toContain(pro.mensal);
    expect(tablet).toMatch(new RegExp(`R\\$${pro.mensal}</strong><span>/mês`));
  });

  test("a versão tablet também informa o plano anual (equivalente mensal e total)", async () => {
    const html = await renderizar();
    const tablet = html.slice(html.indexOf("VERSÃO TABLET"));
    expect(tablet).toContain(pro.anual);
    expect(tablet).toContain(pro.anualTotal);
  });
});

describe("para-empresas: o plano Básico deixou de existir para empresas", () => {
  test("nenhuma menção ao Básico (nota de preço nem FAQ)", async () => {
    const html = await paraEmpresas();
    expect(html).not.toMatch(/B[áa]sico/);
    expect(html).not.toMatch(/meio-termo/i);
  });

  test("o plano pago se chama PRO nas duas versões (nunca 'Premium'); no tablet o título é só 'PRO' para caber ao lado do selo", async () => {
    const html = await paraEmpresas();
    expect(html).not.toMatch(/<h[23][^>]*>\s*Premium\s*<\/h[23]>/);
    expect(html).toMatch(/<h2[^>]*>\s*Empresa PRO\s*<\/h2>/);
    expect(html).toMatch(/<h3[^>]*>\s*PRO\s*<\/h3>/);
  });
});
