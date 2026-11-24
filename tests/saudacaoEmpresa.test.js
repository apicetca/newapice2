// tests/saudacaoEmpresa.test.js
// Dashboard da empresa: "Olá, <nome da empresa>!". Com o nome fantasia vazio ("")
// a saudação ficava "Olá, !", porque o "??" só pula null/undefined; agora cai
// para a razão social e, sem ela, para o nome da conta (o mesmo do cabeçalho).
const path = require("path");
const vm = require("vm");
const ejs = require("ejs");

const VIEWS = path.join(__dirname, "..", "views");
const render = (user) => ejs.renderFile(path.join(VIEWS, "empresa-dashboard.ejs"),
  { user, currentPage: "empresa-dashboard" }, { views: [VIEWS] });

function saudacao(html, profile) {
  const script = html.slice(html.indexOf("const NOME_DA_CONTA"), html.indexOf("const AREA_LABEL"));
  const inicio = html.indexOf("function renderHeader(");
  const fim = html.indexOf('document.getElementById("welcome-title").textContent', inicio);
  const fn = html.slice(inicio, html.indexOf("\n", fim)) + "\n}";
  const h1 = { dataset: { nome: (html.match(/id="welcome-title" data-nome="([^"]*)"/) || [])[1] }, textContent: "" };
  const ctx = vm.createContext({ document: { getElementById: () => h1 } });
  vm.runInContext(`${script}\n${fn}\nrenderHeader(${JSON.stringify(profile)});`, ctx);
  return h1.textContent;
}

test("já vem do servidor com o nome da conta, sem esperar a API", async () => {
  const html = await render({ type: "empresa", name: "CUBE" });
  expect(html).toContain('<h1 id="welcome-title" data-nome="CUBE">Olá, CUBE!</h1>');
});

test.each([
  [{ nome_fantasia: "Azul Tech", razao_social: "Azul Tecnologia Ltda" }, "Olá, Azul Tech!"],
  [{ nome_fantasia: "", razao_social: "Cube Software Ltda" }, "Olá, Cube Software Ltda!"],
  [{ nome_fantasia: "   ", razao_social: null }, "Olá, CUBE!"],
  [null, "Olá, CUBE!"],
])("perfil %j → %s", async (profile, esperado) => {
  const html = await render({ type: "empresa", name: "CUBE" });
  expect(saudacao(html, profile)).toBe(esperado);
});

test("sem nome em lugar nenhum, 'Olá, Empresa!' (nunca 'Olá, !')", async () => {
  const html = await render({ type: "empresa", name: "" });
  expect(html).toContain('<h1 id="welcome-title" data-nome="">Olá!</h1>');
  expect(saudacao(html, { nome_fantasia: "", razao_social: "" })).toBe("Olá, Empresa!");
});

test("o nome é escapado no HTML", async () => {
  const html = await render({ type: "empresa", name: '<b>"X"</b>' });
  expect(html).toContain('data-nome="&lt;b&gt;&#34;X&#34;&lt;/b&gt;"');
  expect(html).not.toContain("<b>\"X\"</b>");
});
