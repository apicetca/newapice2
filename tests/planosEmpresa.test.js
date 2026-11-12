// tests/planosEmpresa.test.js
// Página /planos no layout da empresa: cards do plano PRO (mensal e anual),
// sem o plano Básico, e a página do dev intacta. O card anual só aparece
// quando o plano tem annual_price_cents (plano anual) — por isso funciona
// antes e depois de o plano anual entrar na branch.
const fs = require("fs");
const path = require("path");
const ejs = require("ejs");

const VIEWS = path.join(__dirname, "..", "views");
const FONTE = fs.readFileSync(path.join(VIEWS, "planos.ejs"), "utf8").replace(/\r\n/g, "\n"); // o arquivo usa CRLF

const render = (userType) => ejs.renderFile(path.join(VIEWS, "planos.ejs"),
  { userType, currentPage: "planos", user: { type: userType, name: "Tech", email: "a@b.c" } }, { views: [VIEWS] });

describe("planos.ejs — empresa", () => {
  test("título com 'plano certo' destacado; um único h1; página marcada como layout da empresa", async () => {
    const html = await render("empresa");
    expect(html).toMatch(/<h1>\s*Escolha o <span class="plans-h1-accent">plano certo<\/span>(?:<br[^>]*>)? para você\s*<\/h1>/);
    expect((html.match(/<h1\b/g) || []).length).toBe(1);
    expect(html).toMatch(/<main class="page-content plans--pro plans--empresa" id="main-content">/);
    expect(html).toContain("Assinatura mensal no cartão de crédito, com cobrança automática. Cancele ou troque quando quiser.");
    expect(html).toContain("Pagamentos processados pelo Mercado Pago. Os dados do cartão não passam pelos servidores do Ápice.");
  });

  test("dev usa o mesmo layout de cards PRO, em roxo (plans--dev), com o mesmo título e um único h1", async () => {
    const html = await render("dev");
    expect(html).toMatch(/<h1>\s*Escolha o <span class="plans-h1-accent">plano certo<\/span>(?:<br[^>]*>)? para você\s*<\/h1>/);
    expect((html.match(/<h1\b/g) || []).length).toBe(1);
    expect(html).toMatch(/<main class="page-content plans--pro plans--dev" id="main-content">/);
    expect(FONTE).toMatch(/\.plans--dev\s*\{\s*--plan-cor: var\(--accent\)/);
  });

  test("dev: benefícios do PRO vêm da config (roadmap + features), sem o ramo antigo de cards", () => {
    expect(FONTE).toMatch(/function beneficiosDev\(plan\)/);
    expect(FONTE).toContain("r.max_ativos");
    expect(FONTE).toContain("f.verificacao_projetos");
    expect(FONTE).not.toContain("renderPlansLegado");
    expect(FONTE).not.toContain("IS_EMPRESA");
  });

  test("um card por período: mensal sempre; anual só se o plano tem annual_price_cents", () => {
    expect(FONTE).toMatch(/function cardEmpresa\(plan, periodo/);
    expect(FONTE).toMatch(/plan\.annual_price_cents \? \[cardEmpresa\(plan, "anual"/);
    expect(FONTE).toContain("?periodo=anual");
    expect(FONTE).toContain("Fazer upgrade");
  });

  test("só planos pagos aparecem, e o Básico (descontinuado para empresas) fica de fora", () => {
    expect(FONTE).toMatch(/plan\.price_cents > 0 && !PLANOS_DESCONTINUADOS\.includes\(plan\.code\)/);
    expect(FONTE).toContain('PLANOS_DESCONTINUADOS = ["empresa_basico"]');
  });

  test("o desconto do anual é calculado (não fixo no texto) e mostrado como tag", () => {
    expect(FONTE).toMatch(/Math\.round\(\(1 - plan\.annual_price_cents \/ \(plan\.price_cents \* 12\)\) \* 100\)/);
    expect(FONTE).toMatch(/\$\{desconto\}% Desconto/);
  });

  test("semântica: cada card é um <article> com <h2> do plano; benefícios em <ul>; sem onclick; dados escapados", () => {
    const card = FONTE.match(/function cardEmpresa[\s\S]*?\n}\n/)[0];
    expect(card).toContain('<article class="card plan-card plan-card--empresa');
    expect(card).toContain('<h2 class="plan-name">');
    expect(card).toContain('<ul class="plan-features">');
    expect(card).toContain("escapeHtml(plan.name)");
    expect(FONTE).not.toMatch(/onclick=/);
  });

  test("os benefícios vêm da configuração do plano (não são textos soltos na página)", () => {
    expect(FONTE).toMatch(/\(plan\.benefits \|\| \[\]\)\.map/);
    expect(FONTE).not.toMatch(/60 dias de exposição/);
  });
});
