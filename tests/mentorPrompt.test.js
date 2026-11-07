// tests/mentorPrompt.test.js
// Prompt de sistema do Mentor (services/mentorPrompt.js): descreve cada área
// do site sem inventar recursos — toda rota citada existe de verdade e preço
// e limites batem com config/plans.js.
const fs   = require("fs");
const path = require("path");
const { montarPromptDoMentor } = require("../services/mentorPrompt");
const { PLANS } = require("../config/plans");

const ROOT   = path.join(__dirname, "..");
const ler    = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");
const prompt = montarPromptDoMentor("DADOS DO USUÁRIO\nNível: iniciante");

test.each([
  ["Dashboard", "/dashboard"],
  ["Vagas", "/vagas"],
  ["Repositórios", "/repositorios"],
  ["Roadmap", "/trilha"],
  ["Mentor de carreira", "/mentor"],
  ["Planos", "/planos"],
])("descreve a área %s (%s)", (area, rota) => {
  expect(prompt).toContain(`${area} (${rota})`);
});

test("toda rota citada no prompt existe no site", () => {
  const server = ler("server.js");
  const trilha = ler("routes/trilha.js");
  const rotas  = [...prompt.matchAll(/\((\/[a-z-]+(?:\/[a-z-]+)?)\)/g)].map(m => m[1]);
  expect(rotas.length).toBeGreaterThanOrEqual(8);
  for (const rota of rotas) {
    const existe = rota.startsWith("/trilha")
      ? trilha.includes(`router.get("${rota.slice("/trilha".length) || "/"}"`)
      : server.includes(`app.get("${rota}"`);
    expect({ rota, existe }).toEqual({ rota, existe: true });
  }
});

test("preço e limites do roadmap vêm de config/plans.js", () => {
  expect(prompt).toContain("R$ 19,90/mês");
  expect(PLANS.dev_pro.price_cents).toBe(1990);
  expect(prompt).toContain(`Gratuito — ${PLANS.dev_free.roadmap.max_ativos} roadmap ativo`);
  expect(prompt).toContain(`PRO — até ${PLANS.dev_pro.roadmap.max_ativos} ativos`);
});

test("explica como criar um roadmap para quem não tem", () => {
  expect(prompt).toMatch(/Novo roadmap/);
  expect(prompt).toMatch(/Se ele perguntar sobre o roadmap e não tiver nenhum, diga isso e explique como criar/);
});

test("pede texto simples, porque o chat não formata markdown", () => {
  expect(prompt).toMatch(/Escreva em texto simples/);
  // a tela mostra o texto escapado, sem converter markdown
  expect(ler("views/mentor.ejs")).toMatch(/<span class="msg-bubble">\$\{escapeHtml\(m\.content\)\}<\/span>/);
});

test("regras: português, objetivo, não inventar e admitir quando não souber", () => {
  expect(prompt).toMatch(/português do Brasil/);
  expect(prompt).toMatch(/objetiva/);
  expect(prompt).toMatch(/Nunca invente dados, vagas nem recursos do site/);
  expect(prompt).toMatch(/diga que não sabe/);
});

test("mantém a simulação de entrevista técnica", () => {
  expect(prompt).toMatch(/entrevistador técnico/);
  expect(prompt).toMatch(/UMA pergunta técnica/);
  expect(prompt).toMatch(/3 a 5 frases/);
  expect(prompt).toMatch(/buscarRequisitosVaga/);
});

test("os dados do usuário entram no fim; sem eles, o prompt avisa que estão indisponíveis", () => {
  expect(prompt.endsWith("DADOS DO USUÁRIO\nNível: iniciante")).toBe(true);
  expect(montarPromptDoMentor("")).toMatch(/DADOS DO USUÁRIO\nIndisponíveis agora/);
});
