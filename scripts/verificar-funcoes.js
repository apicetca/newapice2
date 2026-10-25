// Verificação funcional das telas (ferramenta de desenvolvimento — não roda em produção).
//
// Para cada tela do catálogo (scripts/telas.js), executa um roteiro fixo de
// interações e registra o estado resultante: texto visível, valores dos
// campos, elementos abertos/pressionados/focados, requisições de escrita
// enviadas, diálogos e erros de JS. O modo comparar repete o MESMO roteiro e
// aponta qualquer diferença em relação à base.
//
// Toda requisição que não seja GET é BLOQUEADA: é registrada (método, caminho,
// corpo) e recebe uma resposta falsa fixa — nada é gravado no banco.
// Os roteiros encontram elementos por id, classe, name, atributo, role ou
// texto, NUNCA pelo nome da tag (as tags vão mudar na conversão semântica);
// um seletor com tag é recusado antes de rodar.
//
// Uso (com o servidor rodando — `npm start`):
//   node scripts/verificar-funcoes.js base             → todas as telas, salva em tests/funcoes/base/
//   node scripts/verificar-funcoes.js comparar         → todas as telas, compara com a base
//   node scripts/verificar-funcoes.js comparar vagas   → só as telas da página views/vagas.ejs
//   node scripts/verificar-funcoes.js roteiros         → imprime o roteiro de cada página (Markdown)
//
// Mesmas sessões e ids da comparação visual (auth-*.json; ids descobertos no modo base).

const fs   = require("fs");
const path = require("path");
const T = require("./telas");

const OUT       = path.join(T.ROOT, "tests", "funcoes");
const DIR_BASE  = path.join(OUT, "base");
const DIR_ATUAL = path.join(OUT, "atual");
const IDS_FILE  = path.join(DIR_BASE, "ids.json");
const VIEWPORT  = { w: 1440, h: 900 };

// Resposta falsa para toda requisição bloqueada (não-GET).
const RESPOSTA_FALSA = { success: true, id: 1 };

// ── Roteiros ──────────────────────────────────────────────
// alvo: seletor por id (#x), classe (.x), atributo ([x='y']), "text=..." ou
// "role=..."; `n` escolhe a n-ésima ocorrência (padrão: a primeira).
const estado     = (nome)              => ({ acao: "estado", nome });
const clicar     = (alvo, n = 0)       => ({ acao: "clicar", alvo, n });
const preencher  = (alvo, valor)       => ({ acao: "preencher", alvo, valor });
const selecionar = (alvo, indice)      => ({ acao: "selecionar", alvo, indice });
const tecla      = (alvo, t, n = 0)    => ({ acao: "tecla", alvo, tecla: t, n });

const ROTEIROS = {
  "index":            [estado("inicial")],
  "sobre":            [estado("inicial")],
  "404":              [estado("inicial")],
  "insights-mercado": [estado("inicial")],
  "para-devs":        [estado("inicial"), clicar(".pd-faq__item"), estado("primeira pergunta aberta")],
  "para-empresas":    [estado("inicial"), clicar(".pd-faq__item"), estado("primeira pergunta aberta")],
  "login": [
    estado("inicial"),
    clicar("#tab-empresa"), estado("aba empresa"),
    clicar("#tab-dev"),
    clicar("#btn"), estado("envio vazio (validação)"),
    preencher("#email", "verificacao@exemplo.com"), preencher("#password", "senha-de-teste-123"),
    clicar("#toggle-pass"), estado("senha visível"),
    clicar("#btn"), estado("após enviar"),
  ],
  "cadastro": [
    estado("inicial"),
    clicar("#tab-empresa"), estado("aba empresa"),
    clicar("#tab-dev"),
    clicar("#btn"), estado("envio vazio (validação)"),
    preencher("#email", "verificacao@exemplo.com"), preencher("#password", "SenhaTeste123"),
    preencher("#confirm", "SenhaTeste123"), preencher("#dev-nome", "Teste"),
    selecionar("#dev-nivel", 1),
    clicar("#toggle-pass-p"), estado("preenchido"),
    clicar("#btn"), estado("após enviar"),
  ],
  "esqueci-senha": [
    estado("inicial"),
    clicar("#btn"), estado("envio vazio (validação)"),
    preencher("#email", "verificacao@exemplo.com"), clicar("#btn"), estado("após enviar"),
  ],
  "redefinir-senha": [
    estado("inicial"),
    preencher("#password", "SenhaNova123"), preencher("#confirm", "SenhaNova123"),
    clicar("#toggle-pass-p"), estado("preenchido"),
    clicar("#btn"), estado("após enviar"),
  ],
  "vagas": [
    estado("inicial"),
    preencher("#q", "front"), estado("busca 'front'"),
    preencher("#q", ""),
    clicar(".filter-chip[data-filter='nivel'][data-val='junior']"), estado("filtro júnior"),
    clicar(".filter-chip[data-filter='nivel'][data-val='todos']"),
    clicar(".filter-chip[data-filter='area'][data-val='backend']"), estado("filtro backend"),
    clicar(".filter-chip[data-filter='area'][data-val='todas']"),
    selecionar("#sort-select", 1), estado("ordenado A→Z"),
  ],
  "vaga-publica": [estado("inicial"), clicar("#btn-apply"), estado("após candidatar")],

  "dashboard": [estado("inicial"), clicar(".task-btn[data-etapa-id]"), estado("após marcar etapa")],
  "progresso": [
    estado("inicial"),
    clicar(".status-tab[data-filter='concluido']"), estado("aba concluídos"),
    clicar(".status-tab[data-filter='todos']"), estado("aba todos"),
  ],
  "repositorios": [
    estado("inicial"),
    clicar("#btn-open-add"), estado("modal adicionar aberto"),
    preencher("#modal-search", "a"), estado("busca no modal"),
    clicar("#btn-close-add"),
    clicar(".js-edit"), estado("modal editar aberto"),
    clicar("#btn-cancel-edit"),
    clicar(".js-toggle-visibility"), estado("após alternar visibilidade"),
  ],
  "roadmap":       [estado("inicial"), clicar(".btn-status"), estado("após mudar status")],
  "mensagens": [
    estado("inicial"),
    clicar(".msg-filter-tab[data-f='nao-lidas']"), estado("filtro não lidas"),
    clicar(".msg-filter-tab[data-f='todas']"),
    clicar(".msg-conv-item"), estado("conversa aberta"),
    preencher("#msgInput", "Mensagem de verificação"), clicar("#msgSendBtn"), estado("após enviar"),
    clicar("#btnNewConv"), preencher("#jobSearchInput", "dev"), estado("modal nova conversa"),
  ],
  "mentor": [
    estado("inicial"),
    preencher("#mentorInput", "Pergunta de verificação"), clicar("#mentorSendBtn"), estado("após enviar"),
  ],
  "perfil-dev": [
    estado("inicial"),
    preencher("#f-sobre", "Verificação"), estado("campo alterado"),
    clicar("#btn-save"), estado("após salvar"),
    clicar("#btn-add-skill"), estado("adicionar skill sem escolher"),
  ],
  "roadmap/index": [estado("inicial")],
  "roadmap/novo": [
    estado("inicial"),
    clicar("[name='tipo']", 1), estado("tipo vaga"),
    selecionar("#rmVagaId", 1),
    clicar("[name='horasSemana']", 2),
    clicar(".rm-submit"), estado("após enviar"),
  ],
  "roadmap/detalhe": [
    estado("inicial"),
    clicar(".rm-step-toggle"), estado("etapa expandida"),
    preencher("[name='repoUrl']", "https://github.com/exemplo/repo"),
    tecla("[name='repoUrl']", "Enter"), estado("após enviar projeto"),
  ],

  "empresa-dashboard": [
    estado("inicial"),
    clicar(".filter-chip[data-f='ativas']"), estado("filtro ativas"),
    clicar(".filter-chip[data-f='todas']"),
    clicar(".btn-delete-vaga"), estado("modal excluir aberto"),
    clicar("#btn-confirm-delete"), estado("após excluir"),
  ],
  "empresa-vagas": [
    estado("inicial"),
    clicar(".filter-chip[data-f='ativas']"), estado("filtro ativas"),
    clicar(".filter-chip[data-f='todas']"),
    preencher("#q-vagas", "zzz"), estado("busca sem resultado"),
    preencher("#q-vagas", ""),
    clicar(".btn-toggle-on, .btn-toggle-off"), estado("após alternar status"),
    clicar(".btn-delete-vaga"), estado("modal excluir aberto"),
    clicar("#btn-confirm-delete"), estado("após excluir"),
  ],
  "empresa-desenvolvedores": [
    estado("inicial"),
    preencher("#dev-search", "a"), estado("busca 'a'"),
    preencher("#dev-search", ""),
    clicar(".filter-chip[data-f='junior']"), estado("filtro júnior"),
  ],
  "empresa-matchs": [
    estado("inicial"),
    clicar(".filter-chip[data-f='alta']"), estado("filtro alta compatibilidade"),
    clicar(".filter-chip[data-f='todos']"),
    selecionar("#match-sort-select", 1), estado("ordenado por menor compatibilidade"),
    clicar(".match-btn--accept"), estado("após aceitar"),
  ],
  "empresa-mensagens": [
    estado("inicial"),
    clicar(".msg-filter-tab[data-f='nao-lidas']"), estado("filtro não lidas"),
    clicar(".msg-filter-tab[data-f='todas']"),
    clicar(".msg-conv-item"), estado("conversa aberta"),
    preencher("#msgInput", "Mensagem de verificação"), clicar("#msgSendBtn"), estado("após enviar"),
  ],
  "perfil-dev-empresa": [
    estado("inicial"),
    clicar("#tab-projetos"), estado("aba projetos"),
    clicar("#tab-resumo"),
    clicar("#btn-contact"), estado("após contatar"),
  ],
  "empresa-vaga-form": [
    estado("inicial"),
    preencher("#f-title", "Vaga de verificação"), selecionar("#f-level", 1),
    preencher("#search-required", "Ja"), estado("dropdown de skills"),
    tecla("#dropdown-required [data-id]", "Enter"),
    preencher("#search-desired", "Do"), clicar("#dropdown-desired [data-id]"),
    preencher("#tag-input", "startup"), tecla("#tag-input", "Enter"),
    clicar("#chips-tags .chip-remove"), estado("skills e tags escolhidas"),
    clicar("#btn-publish"), estado("após publicar"),
  ],
  "empresa-candidaturas": [estado("inicial"), clicar(".js-gerar-resumo"), estado("após gerar resumo")],
  "perfil-empresa": [
    estado("inicial"),
    preencher("#f-cidade", "Cidade de verificação"), clicar("#btn-save"), estado("após salvar"),
  ],

  "planos":               [estado("inicial")],
  "assinar":              [estado("inicial")],
  "assinatura-resultado": [estado("inicial")],
  "minha-assinatura":     [estado("inicial")],

  "admin-dashboard":  [estado("inicial")],
  "admin-matchs":     [estado("inicial")],
  "admin-relatorios": [estado("inicial")],
  "admin-usuarios": [
    estado("inicial"),
    clicar(".filter-chip[data-f='suspensos']"), estado("filtro suspensos"),
    clicar(".filter-chip[data-f='todos']"),
    clicar("[onclick^='toggleStatus']"), estado("após alternar status"),
  ],
  "admin-empresas": [
    estado("inicial"),
    clicar(".filter-chip[data-f='suspensas']"), estado("filtro suspensas"),
    clicar(".filter-chip[data-f='todas']"),
    clicar("[onclick^='toggleStatus']"), estado("após alternar status"),
  ],
  "admin-vagas": [
    estado("inicial"),
    clicar(".filter-chip[data-f='pausadas']"), estado("filtro pausadas"),
    clicar(".filter-chip[data-f='todas']"),
    clicar("[onclick^='toggleStatus']"), estado("após alternar status"),
  ],
  "admin-configuracoes": [
    estado("inicial"),
    clicar(".btn-resources"), estado("painel de recursos aberto"),
    preencher("#f-name", "Skill de verificação"), clicar("#btn-save"), estado("após salvar skill"),
  ],
};

// Recusa seletor que dependa do nome da tag (ex.: "button", "ul > li", "div.x").
function semTag(sel) {
  if (/^(text|role)=/.test(sel)) return true;
  const semAspas = sel.replace(/(['"]).*?\1/g, "''");
  return !/(^|[\s>+~,(])[a-zA-Z][\w-]*/.test(semAspas);
}
for (const [pagina, passos] of Object.entries(ROTEIROS)) {
  for (const p of passos) {
    if (p.alvo && !semTag(p.alvo)) throw new Error(`Roteiro de "${pagina}" usa seletor com tag: ${p.alvo}`);
  }
}

function descreverPasso(p) {
  const nth = p.n ? ` (${p.n + 1}ª ocorrência)` : "";
  switch (p.acao) {
    case "estado":     return `📸 registra estado "${p.nome}"`;
    case "clicar":     return `clica em \`${p.alvo}\`${nth}`;
    case "preencher":  return p.valor === "" ? `limpa \`${p.alvo}\`` : `preenche \`${p.alvo}\` com "${p.valor}"`;
    case "selecionar": return `escolhe a opção nº ${p.indice} de \`${p.alvo}\``;
    case "tecla":      return `foca \`${p.alvo}\`${nth} e tecla ${p.tecla}`;
  }
}

// ── Execução ──────────────────────────────────────────────
// Avanço fixo do relógio (falso) da página depois de carregar e de cada
// ação: dispara do mesmo jeito, na base e na comparação, os setTimeout da
// página (redirecionamento depois de salvar, debounce de busca, foco em
// modal, texto "Salvo!" que volta ao normal…), sem depender da velocidade
// do servidor.
const AVANCO_RELOGIO_MS = 1500;

async function assentar(page) {
  await T.esperarEstavel(page);
  try { await page.clock.runFor(AVANCO_RELOGIO_MS); } catch { /* navegando */ }
  await T.esperarEstavel(page);
}

async function capturarEstado(page) {
  // A página pode estar navegando (ex.: redirecionou depois de um envio):
  // espera assentar e tenta de novo.
  for (let tentativa = 1; ; tentativa++) {
    try { return await lerEstado(page); }
    catch (err) {
      if (tentativa >= 3) throw err;
      await page.waitForLoadState("load").catch(() => {});
      await assentar(page);
    }
  }
}

async function lerEstado(page) {
  return page.evaluate(() => {
    const norm = (s) => (s || "").replace(/[ \t ]+/g, " ").replace(/ *\n[\s]*/g, "\n").trim();
    const ident = (el) => {
      if (!el || el === document.body) return null;
      if (el.id) return "#" + el.id;
      const cls = (el.getAttribute("class") || "").trim();
      if (cls) return "." + cls.split(/\s+/).join(".");
      if (el.getAttribute("name")) return `[name=${el.getAttribute("name")}]`;
      return `«${norm(el.textContent).slice(0, 40)}»`;
    };
    const campos = [...document.querySelectorAll("input, select, textarea")].map((el) => {
      const v = el.type === "checkbox" || el.type === "radio" ? (el.checked ? "marcado" : "desmarcado") : el.value;
      return `${ident(el)}=${v}`;
    });
    const marcados = [...document.querySelectorAll(
      "[aria-pressed='true'], [aria-selected='true'], [aria-checked='true'], [aria-expanded='true'], [open]"
    )].map((el) => {
      const attrs = ["aria-pressed", "aria-selected", "aria-checked", "aria-expanded", "open"].filter((a) =>
        a === "open" ? el.hasAttribute("open") : el.getAttribute(a) === "true");
      return `${ident(el)} [${attrs.join(",")}]`;
    });
    return {
      url: location.pathname + location.search,
      texto: norm(document.body.innerText),
      campos,
      marcados,
      foco: ident(document.activeElement),
    };
  });
}

async function executarPasso(page, p) {
  if (p.acao === "estado") return null;
  const loc = page.locator(p.alvo).nth(p.n || 0);
  try {
    await loc.waitFor({ state: "attached", timeout: 3000 });
  } catch {
    return "ausente";
  }
  if (!(await loc.isVisible())) return "invisível";
  try {
    if (p.acao === "clicar") await loc.click({ timeout: 3000 });
    else if (p.acao === "preencher") await loc.fill(p.valor, { timeout: 3000 });
    else if (p.acao === "selecionar") await loc.selectOption({ index: p.indice }, { timeout: 3000 });
    else if (p.acao === "tecla") { await loc.focus(); await page.keyboard.press(p.tecla); }
  } catch (err) {
    return "erro: " + err.message.split("\n")[0].slice(0, 120);
  }
  await assentar(page);
  return "ok";
}

function normalizarCorpo(req) {
  const corpo = req.postData();
  if (corpo == null) return null;
  const tipo = req.headers()["content-type"] || "";
  const boundary = tipo.match(/boundary=(.+)$/)?.[1];
  if (boundary) return corpo.split(boundary).join("BOUNDARY");
  try { return JSON.parse(corpo); } catch { return corpo; }
}

async function rodarTela(browser, tela, url) {
  const ctx  = await T.novoContexto(browser, tela.papel, VIEWPORT);
  const requisicoes = [];
  await ctx.route("**/*", (r) => {
    const req = r.request();
    if (["GET", "HEAD", "OPTIONS"].includes(req.method())) return r.fallback();
    const u = new URL(req.url());
    requisicoes.push({ metodo: req.method(), caminho: u.pathname + u.search, corpo: normalizarCorpo(req) });
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(RESPOSTA_FALSA) });
  });
  const page = await ctx.newPage();
  const errosJs  = [];
  const dialogos = [];
  page.on("pageerror", (e) => errosJs.push(e.message.split("\n")[0]));
  page.on("dialog", async (d) => { dialogos.push(`${d.type()}: ${d.message()}`); await d.accept(); });
  T.rastrearRede(page);
  await page.clock.install({ time: T.DATA_FIXA });

  const resultado = { pagina: tela.pagina, papel: tela.papel, rota: tela.rota, passos: [], estados: {} };
  await page.goto(T.BASE_URL + url, { waitUntil: "load", timeout: 45000 });
  await assentar(page);

  if (tela.papel !== "visitante" && new URL(page.url()).pathname === "/login") {
    await ctx.close();
    throw new Error(`sessão expirada (redirecionou para /login) — gere ${path.basename(T.SESSOES[tela.papel])} de novo`);
  }

  for (const p of ROTEIROS[tela.pagina]) {
    if (p.acao === "estado") {
      resultado.estados[p.nome] = await capturarEstado(page);
      continue;
    }
    resultado.passos.push(`${descreverPasso(p)} → ${await executarPasso(page, p)}`);
  }
  resultado.requisicoes = requisicoes;
  resultado.dialogos = dialogos;
  resultado.errosJs = errosJs;
  await ctx.close();
  return resultado;
}

// ── Comparação ────────────────────────────────────────────
function diferencas(a, b, caminho = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (typeof a === "string" && typeof b === "string" && (a.includes("\n") || b.includes("\n"))) {
    const la = a.split("\n"), lb = b.split("\n");
    for (let i = 0; i < Math.max(la.length, lb.length); i++) {
      if (la[i] !== lb[i]) return [`${caminho}: linha ${i + 1} — base: ${JSON.stringify(la[i] ?? "(fim)")} · atual: ${JSON.stringify(lb[i] ?? "(fim)")}`];
    }
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const chaves = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    return chaves.flatMap((k) => diferencas(a[k], b[k], caminho ? `${caminho}.${k}` : k));
  }
  return [`${caminho}: base ${JSON.stringify(a)?.slice(0, 200)} · atual ${JSON.stringify(b)?.slice(0, 200)}`];
}

// ── Principal ─────────────────────────────────────────────
const nomeArquivo = (tela) => `${tela.papel}__${T.slug(tela.rota)}.json`;

function imprimirRoteiros() {
  for (const pagina of T.PAGINAS) {
    const papeis = [...new Set(T.telas().filter((t) => t.pagina === pagina).map((t) => t.papel))];
    console.log(`#### ${pagina} (${papeis.join(", ")})\n`);
    ROTEIROS[pagina].forEach((p, i) => console.log(`${i + 1}. ${descreverPasso(p)}`));
    console.log("");
  }
}

async function main() {
  const args   = process.argv.slice(2);
  const modo   = args[0];
  const pagina = args.slice(1).find((a) => !a.startsWith("--")) ?? null;

  if (modo === "roteiros") return imprimirRoteiros();
  if (!["base", "comparar"].includes(modo)) {
    console.error("Uso: node scripts/verificar-funcoes.js <base|comparar|roteiros> [página]");
    process.exit(2);
  }
  if (modo === "base" && pagina) {
    console.error("O modo base é sempre de todas as telas (sem página).");
    process.exit(2);
  }
  if (pagina && !T.PAGINAS.includes(pagina)) {
    console.error(`Página desconhecida: "${pagina}". Páginas do catálogo:\n  ${T.PAGINAS.join("\n  ")}`);
    process.exit(2);
  }
  const semRoteiro = T.PAGINAS.filter((p) => !ROTEIROS[p]);
  if (semRoteiro.length) { console.error("Páginas sem roteiro: " + semRoteiro.join(", ")); process.exit(2); }
  if (!(await T.servidorNoAr())) {
    console.error(`Servidor não respondeu em ${T.BASE_URL}. Rode \`npm start\` antes.`);
    process.exit(2);
  }

  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch({ args: T.FLAGS_CHROMIUM });
  const destino = modo === "base" ? DIR_BASE : DIR_ATUAL;
  if (modo === "base" || !pagina) { fs.rmSync(destino, { recursive: true, force: true }); }
  fs.mkdirSync(destino, { recursive: true });

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
  const avisos = [];
  const feitos = [];
  for (const tela of selecionadas) {
    const nome = nomeArquivo(tela);
    if (!T.temSessao(tela.papel)) { avisos.push(`${nome}: ${path.basename(T.SESSOES[tela.papel])} não existe — pulada.`); continue; }
    const { url, faltando } = T.preencher(tela.rota, ids);
    if (faltando) { avisos.push(`${nome}: nenhum id para {${faltando}} — pulada.`); continue; }
    try {
      let r = await rodarTela(browser, tela, url);
      let nota = "";
      const fBase = path.join(DIR_BASE, nome);
      if (modo === "base") {
        // Base: duas execuções precisam bater; se não baterem, uma terceira
        // desempata e fica o resultado que se repetiu.
        const r2 = await rodarTela(browser, tela, url);
        if (diferencas(r, r2).length) {
          const r3 = await rodarTela(browser, tela, url);
          if (!diferencas(r, r3).length) nota = " (estabilizada na 3ª execução)";
          else if (!diferencas(r2, r3).length) { r = r2; nota = " (estabilizada na 3ª execução)"; }
          else { r = r3; nota = " (INSTÁVEL: 3 execuções diferentes)"; avisos.push(`${nome}: instável — 3 execuções diferentes entre si.`); }
        }
      } else if (fs.existsSync(fBase)) {
        // Comparação: com diferença, repete até 2 vezes e fica a mais próxima.
        const base = JSON.parse(fs.readFileSync(fBase, "utf8"));
        let n = diferencas(base, r).length;
        for (let t = 1; n > 0 && t <= 2; t++) {
          const rN = await rodarTela(browser, tela, url);
          const nN = diferencas(base, rN).length;
          if (nN < n) { r = rN; n = nN; }
          nota = ` (${t + 1} execuções)`;
        }
      }
      fs.writeFileSync(path.join(destino, nome), JSON.stringify(r, null, 2) + "\n");
      feitos.push(nome);
      const falhasPasso = r.passos.filter((p) => !p.endsWith("→ ok")).length;
      console.log(`  ✓ ${nome} — ${r.passos.length} passos (${falhasPasso} sem efeito), ${r.requisicoes.length} req. bloqueadas, ${r.errosJs.length} erros JS${nota}`);
    } catch (err) {
      avisos.push(`${nome}: ${err.message.split("\n")[0]}`);
      console.log(`  ✗ ${nome}`);
    }
  }
  await browser.close();

  console.log(`\n${feitos.length} telas registradas em ${path.relative(T.ROOT, destino)}/`);
  if (avisos.length) console.log("\nAvisos:\n" + avisos.map((a) => "  - " + a).join("\n"));

  if (modo === "comparar") {
    const esperadas = selecionadas
      .filter((t) => T.temSessao(t.papel) && !T.preencher(t.rota, ids).faltando)
      .map(nomeArquivo);
    const relatorio = [];
    for (const nome of esperadas) {
      const fBase = path.join(DIR_BASE, nome), fAtual = path.join(DIR_ATUAL, nome);
      if (!fs.existsSync(fBase))  { relatorio.push({ nome, diferencas: ["sem base"] }); continue; }
      if (!fs.existsSync(fAtual)) { relatorio.push({ nome, diferencas: ["não foi possível rodar agora"] }); continue; }
      const d = diferencas(JSON.parse(fs.readFileSync(fBase, "utf8")), JSON.parse(fs.readFileSync(fAtual, "utf8")));
      relatorio.push({ nome, diferencas: d });
    }
    fs.writeFileSync(path.join(OUT, "relatorio.json"), JSON.stringify(relatorio, null, 2) + "\n");
    const problemas = relatorio.filter((r) => r.diferencas.length);
    if (!problemas.length) {
      console.log(`\nOK — ${relatorio.length} telas iguais à base.`);
    } else {
      console.log(`\n${problemas.length} de ${relatorio.length} telas com diferença:`);
      for (const r of problemas) {
        console.log(`  ✗ ${r.nome}`);
        r.diferencas.slice(0, 8).forEach((d) => console.log(`      ${d}`));
        if (r.diferencas.length > 8) console.log(`      … +${r.diferencas.length - 8}`);
      }
      process.exitCode = 1;
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
