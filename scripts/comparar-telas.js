// Comparação visual das telas (ferramenta de desenvolvimento — não roda em produção).
//
// Tira screenshot de página inteira de cada tela do inventário
// (docs/html-semantico-inventario.md) em 3 larguras e compara com uma base,
// para garantir que a troca de <div> por HTML semântico não muda o visual.
//
// Uso (com o servidor rodando — `npm start`):
//   node scripts/comparar-telas.js base               → salva em tests/visual/base/
//   node scripts/comparar-telas.js comparar           → salva em tests/visual/atual/,
//                                                       compara e gera tests/visual/diff/
//   node scripts/comparar-telas.js comparar --so=vagas → só as telas cujo nome contém "vagas"
//
// Sessões (geradas à mão, nunca versionadas — ver .gitignore):
//   auth-dev.json, auth-empresa.json, auth-admin.json na raiz do projeto.
//   Sem o arquivo, as telas daquele papel são puladas com aviso.
//
// Variáveis opcionais: BASE_URL (padrão http://localhost:3000),
// LIMIAR (tolerância de cor do pixelmatch, 0–1; padrão 0 = qualquer diferença conta).

const fs   = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");
const { PNG } = require("pngjs");
const { PLANS, isPaidPlan } = require("../config/plans");

const ROOT     = path.join(__dirname, "..");
const OUT      = path.join(ROOT, "tests", "visual");
const DIR_BASE = path.join(OUT, "base");
const DIR_ATUAL = path.join(OUT, "atual");
const DIR_DIFF = path.join(OUT, "diff");
const IDS_FILE = path.join(DIR_BASE, "ids.json");

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const LIMIAR   = Number(process.env.LIMIAR ?? 0);

// Largura → altura do viewport (a altura só afeta o que fica "acima da dobra"
// e a posição de elementos fixos; o screenshot é sempre da página inteira).
const LARGURAS = [
  { w: 1440, h: 900 },
  { w: 768,  h: 1024 },
  { w: 375,  h: 812 },
];

// Data/hora fixa para todo `new Date()`/`Date.now()` no navegador — datas
// relativas ("há 3 dias"), ano do rodapé etc. ficam sempre iguais.
const DATA_FIXA = new Date("2026-01-15T12:00:00-03:00");

// PNG cinza 1×1 — substitui avatares do GitHub (externos, podem mudar ou demorar).
const PNG_CINZA = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqGeoBwADhQGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

// CSS injetado antes do screenshot: tira o que pisca ou muda sozinho.
// Animações/transições também são finalizadas pelo `animations: "disabled"`
// do Playwright e pelo `reducedMotion: "reduce"` do contexto (o próprio
// design-system.css e reveal.js respeitam prefers-reduced-motion).
const CSS_CONGELAR = `
  *, *::before, *::after {
    caret-color: transparent !important;
    transition: none !important;
  }
  html { scrollbar-width: none !important; }
  ::-webkit-scrollbar { display: none !important; }
  [data-visual-ignorar] { visibility: hidden !important; }
`;

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

// Elementos cobertos por uma caixa sólida no screenshot (conteúdo de
// terceiros que não controlamos). Adicione `data-visual-ignorar` a um
// elemento num template para escondê-lo também.
const MASCARAR = ["iframe"];

// ── Telas (do inventário) ─────────────────────────────────
// `{vaga}`, `{vagaEmpresa}`, `{dev}`, `{roadmap}`, `{planoDev}`, `{planoEmpresa}`
// são preenchidos por descobrirIds() no modo base e reaproveitados no modo comparar.
const MISTAS = ["/vagas", "/vagas/{vaga}", "/insights-mercado"];

const TELAS = {
  visitante: [
    "/", "/login", "/cadastro", "/esqueci-senha", "/redefinir-senha",
    ...MISTAS, "/para-devs", "/para-empresas", "/sobre",
    "/pagina-que-nao-existe-teste-visual", // 404
    // 500.ejs não tem como ser provocada de forma estável — fica de fora.
  ],
  dev: [
    "/dashboard", "/meu-progresso", "/repositorios", "/roadmap", "/mensagens",
    "/mentor", "/perfil", "/trilha", "/trilha/novo", "/trilha/{roadmap}",
    "/planos", "/planos/{planoDev}/assinar", "/assinatura/retorno", "/minha-assinatura",
    ...MISTAS,
  ],
  empresa: [
    "/empresa/dashboard", "/empresa/vagas", "/empresa/desenvolvedores", "/empresa/matchs",
    "/empresa/mensagens", "/empresa/dev/{dev}", "/empresa/vagas/nova",
    "/empresa/vagas/{vagaEmpresa}/editar", "/empresa/vagas/{vagaEmpresa}/candidaturas",
    "/empresa/perfil",
    "/planos", "/planos/{planoEmpresa}/assinar", "/assinatura/retorno", "/minha-assinatura",
    ...MISTAS,
  ],
  admin: [
    "/admin/dashboard", "/admin/usuarios", "/admin/empresas", "/admin/vagas",
    "/admin/matchs", "/admin/relatorios", "/admin/configuracoes",
  ],
};

const SESSOES = {
  visitante: null,
  dev:       path.join(ROOT, "auth-dev.json"),
  empresa:   path.join(ROOT, "auth-empresa.json"),
  admin:     path.join(ROOT, "auth-admin.json"),
};

// ── Utilidades ────────────────────────────────────────────
const slug = (rota) => (rota === "/" ? "home" : rota.replace(/^\//, "").replace(/[^a-zA-Z0-9]+/g, "-"));
const nomeArquivo = (papel, rota, w) => `${papel}__${slug(rota)}__${w}.png`;

function limparPasta(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function preencher(rota, ids) {
  let faltando = null;
  const url = rota.replace(/\{(\w+)\}/g, (_, k) => {
    if (ids[k] == null) faltando = k;
    return ids[k];
  });
  return faltando ? { faltando } : { url };
}

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
  const fim = Date.now() + max;
  while (Date.now() < fim) {
    const { pendentes, ultima } = page._rede;
    if (pendentes.size === 0 && Date.now() - ultima >= quieto) return;
    await page.waitForTimeout(100);
  }
  // Algo ficou pendurado (ex.: requisição longa): segue mesmo assim — se o
  // estado capturado variar, aparece como diferença no modo comparar.
}

async function abrir(page, url) {
  if (!page._rede) rastrearRede(page);
  await page.clock.setFixedTime(DATA_FIXA);
  const resp = await page.goto(BASE_URL + url, { waitUntil: "load", timeout: 45000 });
  await esperarRede(page);
  await page.addStyleTag({ content: CSS_CONGELAR });
  await page.evaluate(() => document.fonts.ready);

  // Rola até o fim e volta: carrega imagens lazy e dispara observers de scroll.
  await page.evaluate(async () => {
    const passo = window.innerHeight;
    for (let y = 0; y < document.documentElement.scrollHeight; y += passo) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 50));
    }
    window.scrollTo(0, 0);
  });
  await esperarRede(page);
  await page.waitForTimeout(300);
  return resp;
}

async function screenshot(page, arquivo) {
  await page.screenshot({
    path:       arquivo,
    fullPage:   true,
    animations: "disabled",
    caret:      "hide",
    mask:       MASCARAR.map((s) => page.locator(s)),
    maskColor:  "#ff00ff",
  });
}

// ── Descoberta de ids (só no modo base) ───────────────────
async function primeiroId(browser, papel, rota, regex) {
  if (papel !== "visitante" && !fs.existsSync(SESSOES[papel])) return null;
  const ctx  = await novoContexto(browser, papel, LARGURAS[0]);
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
  const ids = {
    vaga:         await primeiroId(browser, "visitante", "/vagas", /href="\/vagas\/(\d+)"/),
    vagaEmpresa:  await primeiroId(browser, "empresa", "/empresa/vagas", /\/empresa\/vagas\/(\d+)\//),
    dev:          await primeiroId(browser, "empresa", "/empresa/desenvolvedores", /\/empresa\/dev\/(\d+)/),
    roadmap:      await primeiroId(browser, "dev", "/trilha", /\/trilha\/(\d+)/),
    planoDev:     plano("dev"),
    planoEmpresa: plano("empresa"),
  };
  fs.writeFileSync(IDS_FILE, JSON.stringify(ids, null, 2) + "\n");
  return ids;
}

// ── Comparação ────────────────────────────────────────────
// Imagens de tamanhos diferentes são estendidas até o maior tamanho com
// magenta — a área nova conta como diferença.
function estender(png, w, h) {
  if (png.width === w && png.height === h) return png;
  const out = new PNG({ width: w, height: h });
  for (let i = 0; i < out.data.length; i += 4) out.data.set([255, 0, 255, 255], i);
  PNG.bitblt(png, out, 0, 0, png.width, png.height, 0, 0);
  return out;
}

async function comparar(arquivos) {
  const { default: pixelmatch } = await import("pixelmatch");
  const resultado = [];
  for (const nome of arquivos) {
    const fBase  = path.join(DIR_BASE, nome);
    const fAtual = path.join(DIR_ATUAL, nome);
    if (!fs.existsSync(fBase)) { resultado.push({ nome, status: "sem base" }); continue; }
    if (!fs.existsSync(fAtual)) { resultado.push({ nome, status: "sem screenshot atual" }); continue; }

    const a = PNG.sync.read(fs.readFileSync(fBase));
    const b = PNG.sync.read(fs.readFileSync(fAtual));
    const w = Math.max(a.width, b.width);
    const h = Math.max(a.height, b.height);
    const diff = new PNG({ width: w, height: h });
    const n = pixelmatch(estender(a, w, h).data, estender(b, w, h).data, diff.data, w, h, {
      threshold: LIMIAR,
      includeAA: true,
    });
    const tamanhoMudou = a.width !== b.width || a.height !== b.height;
    if (n > 0) fs.writeFileSync(path.join(DIR_DIFF, nome), PNG.sync.write(diff));
    resultado.push({
      nome,
      status: n > 0 ? "diferente" : "igual",
      pixels: n,
      ...(tamanhoMudou && { tamanho: `${a.width}×${a.height} → ${b.width}×${b.height}` }),
    });
  }
  return resultado;
}

// ── Principal ─────────────────────────────────────────────
async function main() {
  const modo = process.argv[2];
  if (!["base", "comparar"].includes(modo)) {
    console.error("Uso: node scripts/comparar-telas.js <base|comparar> [--so=texto]");
    process.exit(2);
  }
  const filtro = process.argv.find((a) => a.startsWith("--so="))?.slice(5) ?? "";

  // Servidor no ar?
  try { await fetch(BASE_URL + "/", { redirect: "manual" }); }
  catch { console.error(`Servidor não respondeu em ${BASE_URL}. Rode \`npm start\` antes.`); process.exit(2); }

  const destino = modo === "base" ? DIR_BASE : DIR_ATUAL;
  if (filtro) fs.mkdirSync(destino, { recursive: true });
  else limparPasta(destino);
  if (modo === "comparar") limparPasta(DIR_DIFF);

  const browser = await chromium.launch({ args: FLAGS_CHROMIUM });
  let ids;
  if (modo === "base") {
    ids = await descobrirIds(browser);
  } else {
    if (!fs.existsSync(IDS_FILE)) { console.error("Base não encontrada. Rode o modo base primeiro."); process.exit(2); }
    ids = JSON.parse(fs.readFileSync(IDS_FILE, "utf8"));
  }
  console.log("Ids usados:", ids);

  const gerados = [];
  const avisos  = [];
  for (const [papel, rotas] of Object.entries(TELAS)) {
    if (SESSOES[papel] && !fs.existsSync(SESSOES[papel])) {
      avisos.push(`${papel}: ${path.basename(SESSOES[papel])} não existe — telas puladas.`);
      continue;
    }
    for (const vp of LARGURAS) {
      const ctx  = await novoContexto(browser, papel, vp);
      const page = await ctx.newPage();
      let sessaoOk = true;
      for (const rota of rotas) {
        const nome = nomeArquivo(papel, rota, vp.w);
        if (filtro && !nome.includes(filtro)) continue;
        if (!sessaoOk) break;
        const { url, faltando } = preencher(rota, ids);
        if (faltando) {
          if (vp === LARGURAS[0]) avisos.push(`${papel} ${rota}: nenhum id para {${faltando}} — tela pulada.`);
          continue;
        }
        try {
          await abrir(page, url);
          // Sessão expirada (cookie dura 24h) → caiu no login.
          if (papel !== "visitante" && new URL(page.url()).pathname === "/login") {
            avisos.push(`${papel}: sessão expirada (redirecionou para /login) — gere ${path.basename(SESSOES[papel])} de novo.`);
            sessaoOk = false;
            continue;
          }
          await screenshot(page, path.join(destino, nome));
          gerados.push(nome);
          process.stdout.write(`  ✓ ${nome}\n`);
        } catch (err) {
          avisos.push(`${nome}: ${err.message.split("\n")[0]}`);
          process.stdout.write(`  ✗ ${nome}\n`);
        }
      }
      await ctx.close();
      if (!sessaoOk) break;
    }
  }
  await browser.close();

  console.log(`\n${gerados.length} screenshots em ${path.relative(ROOT, destino)}/`);
  if (avisos.length) console.log("\nAvisos:\n" + avisos.map((a) => "  - " + a).join("\n"));

  if (modo === "comparar") {
    // Compara tudo o que existe na base (dentro do filtro) — uma tela que
    // sumiu do modo atual também aparece como problema.
    const naBase = fs.readdirSync(DIR_BASE).filter((f) => f.endsWith(".png") && (!filtro || f.includes(filtro)));
    const res = await comparar([...new Set([...naBase, ...gerados])].sort());
    fs.writeFileSync(path.join(OUT, "relatorio.json"), JSON.stringify(res, null, 2) + "\n");

    const problemas = res.filter((r) => r.status !== "igual");
    console.log(`\nComparação: ${res.length - problemas.length} iguais, ${problemas.length} com diferença.`);
    for (const r of problemas) {
      console.log(`  ✗ ${r.nome} — ${r.status}${r.pixels ? ` (${r.pixels} px)` : ""}${r.tamanho ? ` [${r.tamanho}]` : ""}`);
    }
    if (problemas.length) {
      console.log(`\nImagens de diferença em ${path.relative(ROOT, DIR_DIFF)}/ · relatório em ${path.relative(ROOT, path.join(OUT, "relatorio.json"))}`);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
