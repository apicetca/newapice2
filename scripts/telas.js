// Catálogo de telas e preparação do navegador compartilhados por
// scripts/comparar-telas.js (visual) e scripts/verificar-funcoes.js (funções).
// Ferramenta de desenvolvimento — não roda em produção.

const fs   = require("fs");
const path = require("path");
const { PLANS, isPaidPlan } = require("../config/plans");

const ROOT     = path.join(__dirname, "..");
const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");

const SESSOES = {
  visitante: null,
  dev:       path.join(ROOT, "auth-dev.json"),
  empresa:   path.join(ROOT, "auth-empresa.json"),
  admin:     path.join(ROOT, "auth-admin.json"),
};

// ── Catálogo: página (view sem .ejs) → papéis e rotas ─────
// `{vaga}`, `{vagaEmpresa}`, `{dev}`, `{roadmap}`, `{roadmapVaga}`, `{planoDev}`,
// `{planoEmpresa}` são preenchidos por descobrirIds().
// 500.ejs fica de fora: não há como provocá-la de forma estável.
const MISTAS = ["visitante", "dev", "empresa"];
const CATALOGO = [
  { pagina: "index",                   papeis: ["visitante"], rota: "/" },
  { pagina: "login",                   papeis: ["visitante"], rota: "/login" },
  { pagina: "cadastro",                papeis: ["visitante"], rota: "/cadastro" },
  { pagina: "esqueci-senha",           papeis: ["visitante"], rota: "/esqueci-senha" },
  { pagina: "redefinir-senha",         papeis: ["visitante"], rota: "/redefinir-senha" },
  { pagina: "vagas",                   papeis: MISTAS,        rota: "/vagas" },
  { pagina: "vaga-publica",            papeis: MISTAS,        rota: "/vagas/{vaga}" },
  { pagina: "insights-mercado",        papeis: MISTAS,        rota: "/insights-mercado" },
  { pagina: "para-devs",               papeis: ["visitante"], rota: "/para-devs" },
  { pagina: "para-empresas",           papeis: ["visitante"], rota: "/para-empresas" },
  { pagina: "sobre",                   papeis: ["visitante"], rota: "/sobre" },
  { pagina: "404",                     papeis: ["visitante"], rota: "/pagina-que-nao-existe-teste-visual" },

  { pagina: "dashboard",               papeis: ["dev"], rota: "/dashboard" },
  { pagina: "progresso",               papeis: ["dev"], rota: "/meu-progresso" },
  { pagina: "repositorios",            papeis: ["dev"], rota: "/repositorios" },
  { pagina: "roadmap",                 papeis: ["dev"], rota: "/roadmap?job={roadmapVaga}" },
  { pagina: "mensagens",               papeis: ["dev"], rota: "/mensagens" },
  { pagina: "mentor",                  papeis: ["dev"], rota: "/mentor" },
  { pagina: "perfil-dev",              papeis: ["dev"], rota: "/perfil" },
  { pagina: "roadmap/index",           papeis: ["dev"], rota: "/trilha" },
  { pagina: "roadmap/novo",            papeis: ["dev"], rota: "/trilha/novo" },
  { pagina: "roadmap/detalhe",         papeis: ["dev"], rota: "/trilha/{roadmap}" },

  { pagina: "empresa-dashboard",       papeis: ["empresa"], rota: "/empresa/dashboard" },
  { pagina: "empresa-vagas",           papeis: ["empresa"], rota: "/empresa/vagas" },
  { pagina: "empresa-desenvolvedores", papeis: ["empresa"], rota: "/empresa/desenvolvedores" },
  { pagina: "empresa-matchs",          papeis: ["empresa"], rota: "/empresa/matchs" },
  { pagina: "empresa-mensagens",       papeis: ["empresa"], rota: "/empresa/mensagens" },
  { pagina: "perfil-dev-empresa",      papeis: ["empresa"], rota: "/empresa/dev/{dev}" },
  { pagina: "empresa-vaga-form",       papeis: ["empresa"], rota: "/empresa/vagas/nova" },
  { pagina: "empresa-vaga-form",       papeis: ["empresa"], rota: "/empresa/vagas/{vagaEmpresa}/editar" },
  { pagina: "empresa-candidaturas",    papeis: ["empresa"], rota: "/empresa/vagas/{vagaEmpresa}/candidaturas" },
  { pagina: "perfil-empresa",          papeis: ["empresa"], rota: "/empresa/perfil" },

  { pagina: "planos",                  papeis: ["dev", "empresa"], rota: "/planos" },
  { pagina: "assinar",                 papeis: ["dev"],     rota: "/planos/{planoDev}/assinar" },
  { pagina: "assinar",                 papeis: ["empresa"], rota: "/planos/{planoEmpresa}/assinar" },
  { pagina: "assinatura-resultado",    papeis: ["dev", "empresa"], rota: "/assinatura/retorno" },
  { pagina: "minha-assinatura",        papeis: ["dev", "empresa"], rota: "/minha-assinatura" },

  { pagina: "admin-dashboard",         papeis: ["admin"], rota: "/admin/dashboard" },
  { pagina: "admin-usuarios",          papeis: ["admin"], rota: "/admin/usuarios" },
  { pagina: "admin-empresas",          papeis: ["admin"], rota: "/admin/empresas" },
  { pagina: "admin-vagas",             papeis: ["admin"], rota: "/admin/vagas" },
  { pagina: "admin-matchs",            papeis: ["admin"], rota: "/admin/matchs" },
  { pagina: "admin-relatorios",        papeis: ["admin"], rota: "/admin/relatorios" },
  { pagina: "admin-configuracoes",     papeis: ["admin"], rota: "/admin/configuracoes" },
];

// Uma entrada por (papel, rota), na ordem do catálogo.
function telas() {
  const out = [];
  for (const t of CATALOGO) for (const papel of t.papeis) out.push({ pagina: t.pagina, papel, rota: t.rota });
  return out;
}

const PAGINAS = [...new Set(CATALOGO.map((t) => t.pagina))];

const slug = (rota) => (rota === "/" ? "home" : rota.replace(/^\//, "").replace(/[^a-zA-Z0-9]+/g, "-"));

function preencher(rota, ids) {
  let faltando = null;
  const url = rota.replace(/\{(\w+)\}/g, (_, k) => {
    if (ids[k] == null) faltando = k;
    return ids[k];
  });
  return faltando ? { faltando } : { url };
}

const temSessao = (papel) => papel === "visitante" || fs.existsSync(SESSOES[papel]);

// ── Navegador ─────────────────────────────────────────────
// Renderização determinística (sem GPU, perfil de cor fixo, raster inteiro)
// — sem isso, cantos arredondados variam ±1 de cor entre duas capturas.
const FLAGS_CHROMIUM = [
  "--disable-gpu",
  "--force-color-profile=srgb",
  "--disable-partial-raster",
  "--disable-skia-runtime-opts",
  "--font-render-hinting=none",
  "--disable-lcd-text",
];

// Data/hora fixa para todo `new Date()`/`Date.now()` no navegador.
const DATA_FIXA = new Date("2026-01-15T12:00:00-03:00");

// PNG cinza 1×1 — substitui avatares do GitHub (externos, podem mudar ou demorar).
const PNG_CINZA = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqGeoBwADhQGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

async function novoContexto(browser, papel, viewport) {
  const ctx = await browser.newContext({
    viewport:          { width: viewport.w, height: viewport.h },
    deviceScaleFactor: 1,
    storageState:      SESSOES[papel] || undefined,
    reducedMotion:     "reduce",
    colorScheme:       "dark",
    locale:            "pt-BR",
    timezoneId:        "America/Sao_Paulo",
  });

  // Conta mutações do DOM — esperarEstavel() só segue quando a página para de
  // mudar (o JS terminou de desenhar o que chegou da API).
  await ctx.addInitScript(() => {
    window.__mutacoes = 0;
    new MutationObserver(() => { window.__mutacoes++; })
      .observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  });

  // Avatares externos → imagem fixa.
  await ctx.route("https://avatars.githubusercontent.com/**", (r) =>
    r.fulfill({ status: 200, contentType: "image/png", body: PNG_CINZA })
  );
  // Explicação de match por IA (texto gerado, muda e custa tokens) → texto fixo.
  await ctx.route(/\/api\/ai\/jobs\/\d+\/match-explicacao/, (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ explicacao: "Texto fixo do teste visual." }) })
  );
  // Insights de mercado: sem cache no banco, o endpoint gera via IA a cada
  // visita (custo + texto variável). Com cache, o servidor já renderiza o
  // conteúdo e a página nem faz o fetch — então isto só fixa o estado de erro.
  await ctx.route("**/api/ai/insights-mercado", (r) =>
    r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Indisponível no teste visual." }) })
  );
  return ctx;
}

// Espera a rede ficar quieta. Não usa o "networkidle" do Playwright: o
// Chromium não considera concluída uma resposta cujo corpo a página nunca
// lê (ex.: o 401 de /api/user para visitante em /vagas), e ele nunca dispara.
// Aqui uma requisição conta como concluída ao receber a resposta.
function rastrearRede(page) {
  const estado = { pendentes: new Set(), ultima: Date.now() };
  const tocar = () => { estado.ultima = Date.now(); };
  page.on("request",       (r) => { estado.pendentes.add(r); tocar(); });
  page.on("response",      (r) => { estado.pendentes.delete(r.request()); tocar(); });
  page.on("requestfailed", (r) => { estado.pendentes.delete(r); tocar(); });
  page._rede = estado;
}

async function esperarRede(page, { quieto = 700, max = 20000 } = {}) {
  if (!page._rede) rastrearRede(page);
  const fim = Date.now() + max;
  while (Date.now() < fim) {
    const { pendentes, ultima } = page._rede;
    if (pendentes.size === 0 && Date.now() - ultima >= quieto) return;
    await page.waitForTimeout(100);
  }
  // Algo ficou pendurado (ex.: requisição longa): segue mesmo assim — se o
  // estado capturado variar, aparece como diferença no modo comparar.
}

// Espera a página estabilizar: rede quieta E nenhuma mutação no DOM por
// `quieto` ms (medido no Node, então funciona mesmo com o relógio da página
// congelado). Devolve false se estourar `max` sem estabilizar.
async function esperarEstavel(page, { quieto = 800, max = 45000 } = {}) {
  if (!page._rede) rastrearRede(page);
  const fim = Date.now() + max;
  let ultimaContagem = -1;
  let desde = Date.now();
  while (Date.now() < fim) {
    let contagem;
    try { contagem = await page.evaluate(() => window.__mutacoes ?? 0); }
    catch { contagem = -2; } // navegando: conta como mudança
    const { pendentes, ultima } = page._rede;
    if (contagem !== ultimaContagem || pendentes.size > 0) { ultimaContagem = contagem; desde = Date.now(); }
    if (pendentes.size === 0 && Date.now() - desde >= quieto && Date.now() - ultima >= quieto) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

// ── Descoberta de ids (só no modo base) ───────────────────
async function primeiroId(browser, papel, rota, regex) {
  if (!temSessao(papel)) return null;
  const ctx  = await novoContexto(browser, papel, { w: 1440, h: 900 });
  const page = await ctx.newPage();
  try {
    rastrearRede(page);
    await page.goto(BASE_URL + rota, { waitUntil: "load", timeout: 45000 });
    await esperarRede(page);
    const m = (await page.content()).match(regex);
    return m ? m[1] : null;
  } catch {
    return null;
  } finally {
    await ctx.close();
  }
}

async function descobrirIds(browser) {
  const plano = (tipo) => Object.values(PLANS).find((p) => p.type === tipo && isPaidPlan(p))?.code ?? null;
  return {
    vaga:         await primeiroId(browser, "visitante", "/vagas", /href="\/vagas\/(\d+)"/),
    vagaEmpresa:  await primeiroId(browser, "empresa", "/empresa/vagas", /\/empresa\/vagas\/(\d+)\//),
    dev:          await primeiroId(browser, "empresa", "/empresa/desenvolvedores", /\/empresa\/dev\/(\d+)/),
    roadmap:      await primeiroId(browser, "dev", "/trilha", /\/trilha\/(\d+)/),
    roadmapVaga:  await primeiroId(browser, "dev", "/meu-progresso", /\/roadmap\?job=(\d+)/),
    planoDev:     plano("dev"),
    planoEmpresa: plano("empresa"),
  };
}

async function servidorNoAr() {
  try { await fetch(BASE_URL + "/", { redirect: "manual" }); return true; }
  catch { return false; }
}

module.exports = {
  ROOT, BASE_URL, SESSOES, CATALOGO, PAGINAS, telas, slug, preencher, temSessao,
  FLAGS_CHROMIUM, DATA_FIXA, novoContexto, rastrearRede, esperarRede, esperarEstavel, descobrirIds, servidorNoAr,
};
