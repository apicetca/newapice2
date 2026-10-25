// Comparação visual das telas (ferramenta de desenvolvimento — não roda em produção).
//
// Tira screenshot de página inteira de cada tela do catálogo (scripts/telas.js)
// em 3 larguras e compara com uma base, para garantir que a troca de <div>
// por HTML semântico não muda o visual.
//
// Uso (com o servidor rodando — `npm start`):
//   node scripts/comparar-telas.js base                → todas as telas, salva em tests/visual/base/
//   node scripts/comparar-telas.js comparar            → todas as telas, salva em tests/visual/atual/,
//                                                        compara e gera tests/visual/diff/
//   node scripts/comparar-telas.js comparar vagas      → só as telas da página views/vagas.ejs
//                                                        (todos os papéis e larguras)
//   node scripts/comparar-telas.js comparar --so=vagas → só as telas cujo arquivo contém "vagas"
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
const T = require("./telas");

const OUT       = path.join(T.ROOT, "tests", "visual");
const DIR_BASE  = path.join(OUT, "base");
const DIR_ATUAL = path.join(OUT, "atual");
const DIR_DIFF  = path.join(OUT, "diff");
const IDS_FILE  = path.join(DIR_BASE, "ids.json");

const LIMIAR = Number(process.env.LIMIAR ?? 0);

// Largura → altura do viewport (a altura só afeta o que fica "acima da dobra"
// e a posição de elementos fixos; o screenshot é sempre da página inteira).
const LARGURAS = [
  { w: 1440, h: 900 },
  { w: 768,  h: 1024 },
  { w: 375,  h: 812 },
];

// CSS injetado antes do screenshot: tira o que pisca ou muda sozinho.
// Animações vão direto ao estado final (duração e atraso zero): sem isso, uma
// entrada com atraso (ex.: .msg-thread, fadeUp com 40 ms de delay e opacidade
// 0 no início) às vezes era capturada ainda invisível. O `reducedMotion:
// "reduce"` do contexto encurta a duração, mas não o atraso.
const CSS_CONGELAR = `
  *, *::before, *::after {
    caret-color: transparent !important;
    transition: none !important;
    animation-duration: 0s !important;
    animation-delay: 0s !important;
  }
  html { scrollbar-width: none !important; }
  ::-webkit-scrollbar { display: none !important; }
  [data-visual-ignorar] { visibility: hidden !important; }
`;

// Elementos cobertos por uma caixa sólida no screenshot (conteúdo de
// terceiros que não controlamos). Adicione `data-visual-ignorar` a um
// elemento num template para escondê-lo também.
const MASCARAR = ["iframe"];

const nomeArquivo = (papel, rota, w) => `${papel}__${T.slug(rota)}__${w}.png`;

function limparPasta(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

async function abrir(page, url) {
  await page.clock.setFixedTime(T.DATA_FIXA);
  const resp = await page.goto(T.BASE_URL + url, { waitUntil: "load", timeout: 45000 });
  await T.esperarEstavel(page);
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
  await T.esperarEstavel(page);
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

// Quantos pixels diferem entre dois PNGs (tamanhos diferentes contam a área nova).
let pixelmatch = null;
function pixelsDiferentes(fa, fb) {
  const a = PNG.sync.read(fs.readFileSync(fa));
  const b = PNG.sync.read(fs.readFileSync(fb));
  const w = Math.max(a.width, b.width);
  const h = Math.max(a.height, b.height);
  return pixelmatch(estender(a, w, h).data, estender(b, w, h).data, null, w, h, { threshold: LIMIAR, includeAA: true });
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
  const args   = process.argv.slice(2);
  const modo   = args[0];
  const pagina = args.slice(1).find((a) => !a.startsWith("--")) ?? null;
  const filtro = args.find((a) => a.startsWith("--so="))?.slice(5) ?? "";

  if (!["base", "comparar"].includes(modo)) {
    console.error("Uso: node scripts/comparar-telas.js <base|comparar> [página] [--so=texto]");
    process.exit(2);
  }
  if (modo === "base" && (pagina || filtro)) {
    console.error("O modo base é sempre de todas as telas (sem página nem --so).");
    process.exit(2);
  }
  if (pagina && !T.PAGINAS.includes(pagina)) {
    console.error(`Página desconhecida: "${pagina}". Páginas do catálogo:\n  ${T.PAGINAS.join("\n  ")}`);
    process.exit(2);
  }
  if (!(await T.servidorNoAr())) {
    console.error(`Servidor não respondeu em ${T.BASE_URL}. Rode \`npm start\` antes.`);
    process.exit(2);
  }

  const destino = modo === "base" ? DIR_BASE : DIR_ATUAL;
  if (modo === "base" || (!pagina && !filtro)) limparPasta(destino);
  else fs.mkdirSync(destino, { recursive: true });
  if (modo === "comparar") limparPasta(DIR_DIFF);

  pixelmatch = (await import("pixelmatch")).default;
  const browser = await chromium.launch({ args: T.FLAGS_CHROMIUM });
  let ids;
  if (modo === "base") {
    ids = await T.descobrirIds(browser);
    fs.writeFileSync(IDS_FILE, JSON.stringify(ids, null, 2) + "\n");
  } else {
    if (!fs.existsSync(IDS_FILE)) { console.error("Base não encontrada. Rode o modo base primeiro."); process.exit(2); }
    ids = JSON.parse(fs.readFileSync(IDS_FILE, "utf8"));
  }
  console.log("Ids usados:", ids);

  const selecionadas = T.telas().filter((t) => !pagina || t.pagina === pagina);
  const esperados = [];
  const gerados   = [];
  const avisos    = [];
  const papeis    = [...new Set(selecionadas.map((t) => t.papel))];

  for (const papel of papeis) {
    const rotas = selecionadas.filter((t) => t.papel === papel);
    if (!T.temSessao(papel)) {
      avisos.push(`${papel}: ${path.basename(T.SESSOES[papel])} não existe — telas puladas.`);
      continue;
    }
    for (const vp of LARGURAS) {
      const ctx  = await T.novoContexto(browser, papel, vp);
      const page = await ctx.newPage();
      let sessaoOk = true;
      for (const { rota } of rotas) {
        const nome = nomeArquivo(papel, rota, vp.w);
        if (filtro && !nome.includes(filtro)) continue;
        const { url, faltando } = T.preencher(rota, ids);
        if (faltando) {
          if (vp === LARGURAS[0]) avisos.push(`${papel} ${rota}: nenhum id para {${faltando}} — tela pulada.`);
          continue;
        }
        esperados.push(nome);
        if (!sessaoOk) continue;
        try {
          await abrir(page, url);
          // Sessão expirada (cookie dura 24h) → caiu no login.
          if (papel !== "visitante" && new URL(page.url()).pathname === "/login") {
            avisos.push(`${papel}: sessão expirada (redirecionou para /login) — gere ${path.basename(T.SESSOES[papel])} de novo.`);
            sessaoOk = false;
            continue;
          }
          const final = path.join(destino, nome);
          await screenshot(page, final);
          const extra = path.join(destino, "_tentativa.png");
          let nota = "";
          if (modo === "base") {
            // Base: duas capturas precisam bater; se não baterem, uma terceira
            // desempata e fica a imagem que se repetiu.
            await abrir(page, url); await screenshot(page, extra);
            if (pixelsDiferentes(final, extra) > 0) {
              const terceira = path.join(destino, "_tentativa3.png");
              await abrir(page, url); await screenshot(page, terceira);
              if (pixelsDiferentes(final, terceira) === 0) nota = " (estabilizada na 3ª captura)";
              else if (pixelsDiferentes(extra, terceira) === 0) { fs.copyFileSync(extra, final); nota = " (estabilizada na 3ª captura)"; }
              else { fs.copyFileSync(terceira, final); nota = " (INSTÁVEL: 3 capturas diferentes)"; avisos.push(`${nome}: instável — 3 capturas diferentes entre si.`); }
              fs.rmSync(terceira, { force: true });
            }
          } else if (fs.existsSync(path.join(DIR_BASE, nome))) {
            // Comparação: com diferença, recaptura até 2 vezes e fica a menor.
            let n = pixelsDiferentes(path.join(DIR_BASE, nome), final);
            for (let t = 1; n > 0 && t <= 2; t++) {
              await abrir(page, url); await screenshot(page, extra);
              const n2 = pixelsDiferentes(path.join(DIR_BASE, nome), extra);
              if (n2 < n) { fs.copyFileSync(extra, final); n = n2; }
              nota = ` (${t + 1} capturas)`;
            }
          }
          fs.rmSync(extra, { force: true });
          gerados.push(nome);
          process.stdout.write(`  ✓ ${nome}${nota}\n`);
        } catch (err) {
          avisos.push(`${nome}: ${err.message.split("\n")[0]}`);
          process.stdout.write(`  ✗ ${nome}\n`);
        }
      }
      await ctx.close();
    }
  }
  await browser.close();

  console.log(`\n${gerados.length} screenshots em ${path.relative(T.ROOT, destino)}/`);
  if (avisos.length) console.log("\nAvisos:\n" + avisos.map((a) => "  - " + a).join("\n"));

  if (modo === "comparar") {
    // Sem página nem filtro, compara tudo o que existe na base — uma tela que
    // sumiu do modo atual também aparece como problema.
    const naBase = !pagina && !filtro ? fs.readdirSync(DIR_BASE).filter((f) => f.endsWith(".png")) : [];
    const res = await comparar([...new Set([...naBase, ...esperados])].sort());
    fs.writeFileSync(path.join(OUT, "relatorio.json"), JSON.stringify(res, null, 2) + "\n");

    const problemas = res.filter((r) => r.status !== "igual");
    console.log(`\nComparação: ${res.length - problemas.length} iguais, ${problemas.length} com diferença.`);
    for (const r of problemas) {
      console.log(`  ✗ ${r.nome} — ${r.status}${r.pixels ? ` (${r.pixels} px)` : ""}${r.tamanho ? ` [${r.tamanho}]` : ""}`);
    }
    if (problemas.length) {
      console.log(`\nImagens de diferença em ${path.relative(T.ROOT, DIR_DIFF)}/ · relatório em ${path.relative(T.ROOT, path.join(OUT, "relatorio.json"))}`);
      process.exitCode = 1;
    } else {
      console.log("OK");
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
