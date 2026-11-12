// tests/mensagensVagaPainel.test.js
// Mensagens do dev: o painel lateral mostra a vaga da conversa (aba "Vaga")
// e, em outra aba, a empresa. Renderiza o EJS e confere estrutura e regras do JS.
const fs = require("fs");
const path = require("path");
const ejs = require("ejs");

const VIEWS = path.join(__dirname, "..", "views");
const FONTE = fs.readFileSync(path.join(VIEWS, "mensagens.ejs"), "utf8").replace(/\r\n/g, "\n");
const CSS = fs.readFileSync(path.join(__dirname, "..", "public", "css", "mensagens.css"), "utf8").replace(/\r\n/g, "\n");
const render = () => ejs.renderFile(path.join(VIEWS, "mensagens.ejs"),
  { currentPage: "mensagens", user: { type: "dev", name: "Dev", email: "a@b.c" } }, { views: [VIEWS] });

describe("mensagens (dev): painel da vaga", () => {
  test("o painel tem abas Vaga | Empresa (botões com aria-pressed), escondidas até haver vaga", async () => {
    const html = await render();
    expect(html).toMatch(/<div class="msg-info-tabs" id="infoTabs" role="group" aria-label="[^"]+" hidden>/);
    expect(html).toMatch(/<button type="button" class="msg-info-tab" id="tabVaga" data-tab="vaga" aria-pressed="false">Vaga<\/button>/);
    expect(html).toMatch(/<button type="button" class="msg-info-tab" id="tabEmpresa" data-tab="empresa" aria-pressed="false">Empresa<\/button>/);
  });

  test("a vaga vem de /api/vagas/:id da própria conversa (job_id) e só abre se a conversa tem vaga", () => {
    expect(FONTE).toContain("fetch(`/api/vagas/${conv.job_id}`)");
    expect(FONTE).toMatch(/const alvo = tab === "vaga" && temVaga \? "vaga" : "empresa"/);
  });

  test("em tela larga a vaga abre sozinha ao selecionar a conversa", () => {
    expect(FONTE).toMatch(/matchMedia\("\(min-width: 981px\)"\)\.matches\) openInfoPanel\("vaga"\)/);
  });

  test("dados da vaga passam por escapeHtml; sem onclick inline", () => {
    const vaga = FONTE.match(/async function renderVagaInfo[\s\S]*?\n  }\n/)[0];
    for (const campo of ["job.title", "job.description", "k.name", "c)", "v)"]) expect(vaga).toContain(`escapeHtml(${campo}`);
    expect(vaga).not.toMatch(/onclick=/);
  });

  test("descrição longa: 'Ver mais' é botão com aria-expanded/aria-controls", () => {
    expect(FONTE).toMatch(/<button type="button" class="msg-vaga-more" id="vagaMore" aria-expanded="false" aria-controls="vagaDesc" hidden>/);
    expect(CSS).toMatch(/\.msg-vaga-desc\.is-clamped\s*\{[^}]*-webkit-line-clamp/);
  });

  test("hierarquia de headings no painel: h2 (título) > h3 (blocos); texto longo quebra", () => {
    expect(FONTE).toContain('<h2 class="msg-vaga-title">');
    expect(FONTE).not.toMatch(/<h4>/);
    expect(CSS).toMatch(/\.msg-vaga-desc\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});
