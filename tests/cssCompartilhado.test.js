// tests/cssCompartilhado.test.js
// Guarda contra regressão: alguns CSS são compartilhados por várias telas (ex.:
// empresa-dashboard.css é carregado por todas as admin-*, empresa-vagas, mensagens,
// planos, assinatura...). Reescrever um deles "só para a tela que estou mexendo"
// já quebrou outras telas sem nenhum teste falhar. Aqui:
//   1) todo <link rel="stylesheet" href="/css/x.css"> das views aponta para um arquivo que existe;
//   2) as classes de que telas compartilhadas dependem continuam definidas no CSS que elas carregam.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ler = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function viewsDoProjeto(dir = "views") {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? viewsDoProjeto(path.join(dir, e.name)) : e.name.endsWith(".ejs") ? [path.join(dir, e.name)] : []);
}

describe("CSS carregado pelas views", () => {
  test("todo /css/*.css citado em uma view existe em public/css", () => {
    const faltando = [];
    for (const view of viewsDoProjeto()) {
      for (const [, href] of ler(view).matchAll(/href="\/css\/([^"?]+\.css)"/g)) {
        if (!fs.existsSync(path.join(ROOT, "public", "css", href))) faltando.push(`${view} → ${href}`);
      }
    }
    expect(faltando).toEqual([]);
  });
});

describe("telas que dependem de CSS compartilhado", () => {
  const css = (...arquivos) => arquivos.map(a => ler(`public/css/${a}`)).join("\n");
  const define = (texto, classe) => new RegExp(`\\.${classe}(?![\\w-])`).test(texto);

  // [view, CSS que ela carrega, classes que ela usa e que vêm desse CSS]
  const dependencias = [
    ["views/empresa-vagas.ejs",
      ["empresa-dashboard.css", "empresa-vagas.css"],
      ["jobs-table", "jobs-table-wrap", "filter-chip", "btn-nova-vaga", "modal-overlay", "confirm-modal", "btn-icon", "mini-bar-fill", "job-actions", "table-empty"]],
    ["views/admin-vagas.ejs",
      ["admin-dashboard.css", "admin-vagas.css"],
      ["adm-main", "adm-badge", "adm-empty", "adv-table", "adv-chip", "adv-dialog", "adv-icon-btn"]],
    ["views/empresa-candidaturas.ejs",
      ["empresa-desenvolvedores.css"],
      ["devs-header", "page-title", "page-subtitle", "devs-grid", "dev-card", "dev-btn", "devs-empty"]],
  ];

  test.each(dependencias)("%s: as classes que ela usa continuam definidas em %j", (view, arquivos, classes) => {
    const fonte = ler(view);
    for (const a of arquivos) expect(fonte).toContain(`/css/${a}`);
    const texto = css(...arquivos);
    const semDefinicao = classes.filter(c => fonte.includes(c) && !define(texto, c));
    expect(semDefinicao).toEqual([]);
  });

  test("o dashboard da empresa tem CSS próprio (não reescreve o compartilhado)", () => {
    const dashboard = ler("views/empresa-dashboard.ejs");
    expect(dashboard).toContain("/css/empresa-painel.css");
    expect(dashboard).not.toContain("/css/empresa-dashboard.css");
  });
});
