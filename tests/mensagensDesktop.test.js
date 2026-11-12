// tests/mensagensDesktop.test.js
// Mensagens do dev no desktop (protótipos de 1440px: conversa e "Mostrar
// vaga"). Só o desktop muda — celular e tablet continuam com mensagens.css,
// e a tela de mensagens da empresa (mesmo CSS base) não é afetada.
const fs   = require("fs");
const path = require("path");
const vm   = require("vm");

const ROOT = path.join(__dirname, "..");
const ler  = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");
const view = ler("views/mensagens.ejs");
const css  = ler("public/css/mensagens-desktop.css");

// Recorta do <script> da página uma função (pelas chaves) ou uma const de uma linha.
function trecho(nome) {
  const inicioFn = view.indexOf(`function ${nome}(`);
  if (inicioFn !== -1) {
    let i = view.indexOf("{", inicioFn), nivel = 0;
    for (; i < view.length; i++) {
      if (view[i] === "{") nivel++;
      else if (view[i] === "}" && --nivel === 0) break;
    }
    return view.slice(inicioFn, i + 1);
  }
  const linha = view.match(new RegExp(`^\\s*const ${nome}\\s*=.*;$`, "m"));
  if (!linha) throw new Error(`não achei ${nome} em mensagens.ejs`);
  return linha[0];
}

// As funções puras do desktop rodando fora do navegador.
function carregar(globais = {}) {
  const nomes = ["hora", "dataDoDia", "initials", "grupoHtml", "mensagensDesktop",
    "NIVEL", "MODALIDADE", "INGLES", "reais", "faixaSalarial", "cidade", "painelDaVaga"];
  const ctx = vm.createContext({
    escapeHtml: s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    activeConversation: { company_name: "AZYRA" },
    ...globais,
  });
  vm.runInContext(nomes.map(trecho).join("\n") + `\n;({ ${nomes.join(", ")} })`, ctx);
  return vm.runInContext(`({ ${nomes.join(", ")} })`, ctx);
}

const ANO = new Date().getFullYear();
const em = (mes, dia, h, min, s = 0) => new Date(ANO, mes, dia, h, min, s).toISOString();
const msg = (mine, body, iso) => ({ mine, body, created_at: iso });

describe("CSS e marcação", () => {
  test("a página do dev carrega o CSS de desktop depois do mensagens.css", () => {
    expect(view.indexOf('href="/css/mensagens-desktop.css"')).toBeGreaterThan(view.indexOf('href="/css/mensagens.css"'));
    expect(view).toMatch(/<main class="page-content msg-page msg-page--dev" id="main-content">/);
  });

  test("a tela de mensagens da empresa não carrega o CSS de desktop do dev", () => {
    const empresa = ler("views/empresa-mensagens.ejs");
    expect(empresa).not.toMatch(/mensagens-desktop\.css|msg-page--dev/);
  });

  test("fora do @media de desktop, o CSS só esconde os elementos novos", () => {
    const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const inicioMedia = semComentarios.indexOf("@media (min-width: 1024px)");
    expect(inicioMedia).toBeGreaterThan(-1);
    expect(semComentarios.slice(0, inicioMedia).trim())
      .toBe(".msg-thread-empresa-btn, .msg-thread-vaga-btn, .msg-info-head { display: none; }");
    const bloco = semComentarios.slice(inicioMedia);
    expect((bloco.match(/\{/g) || []).length).toBe((bloco.match(/\}/g) || []).length);
    expect(bloco.trim().endsWith("}")).toBe(true);
  });

  test("toda regra do desktop é presa à página do dev (.msg-page--dev)", () => {
    const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const corpo = semComentarios.slice(semComentarios.indexOf("@media (min-width: 1024px)"));
    const dentro = corpo.slice(corpo.indexOf("{") + 1, corpo.lastIndexOf("}"));
    const seletores = [...dentro.matchAll(/([^{}]+)\{[^{}]*\}/g)]
      .flatMap(m => m[1].split(","))
      .map(s => s.trim())
      .filter(Boolean);
    expect(seletores.length).toBeGreaterThan(50);
    for (const s of seletores) expect(s).toMatch(/^(\.page-content\.msg-page)?\.msg-page--dev\b/);
  });

  test("cabeçalho: botão da empresa (›) e \"Mostrar vaga\", que começa escondido", () => {
    expect(view).toMatch(/<button class="msg-thread-empresa-btn" id="threadEmpresaBtn" type="button" aria-label="Ver informações da empresa">/);
    expect(view).toMatch(/<button class="msg-thread-vaga-btn" id="threadVagaBtn" type="button" hidden>Mostrar vaga<\/button>/);
    // só aparece quando a conversa é sobre uma vaga, e some com o painel da vaga aberto
    expect(view).toMatch(/\$\("threadVagaBtn"\)\.hidden = !activeConversation\?\.job_id \|\| painelAtual === "vaga";/);
  });

  test("painel da vaga: busca a vaga pública e ignora respostas de outra conversa", () => {
    expect(view).toMatch(/fetch\(`\/api\/vagas\/\$\{encodeURIComponent\(conversa\.job_id\)\}`\)/);
    expect(view).toMatch(/if \(conversa !== activeConversation \|\| painelAtual !== "vaga"\) return;/);
    expect(view).toMatch(/Esta vaga não está mais disponível\./);
    // ao sair do desktop o painel da vaga (que só existe lá) fecha
    expect(view).toMatch(/if \(!DESKTOP\.matches && painelAtual === "vaga"\) fecharPainel\(\);/);
  });
});

describe("mensagens agrupadas por remetente (desktop)", () => {
  test("mensagens seguidas do mesmo lado formam um grupo, com o separador do dia", () => {
    const { mensagensDesktop } = carregar();
    const html = mensagensDesktop([
      msg(false, "Olá Igor", em(9, 20, 12, 34)),
      msg(false, "Podemos conversar?", em(9, 20, 12, 34, 30)),
      msg(true, "Claro!", em(9, 20, 13, 40)),
      msg(true, "Fico no aguardo.", em(9, 20, 13, 40, 20)),
      msg(false, "Sexta às 11:00.", em(9, 20, 17, 8)),
    ]);
    expect(html.match(/class="msg-dia"/g)).toHaveLength(1);
    expect(html).toMatch(/<p class="msg-dia">20 de out\.<\/p>/);
    const grupos = html.split('<section class="msg-grupo').slice(1);
    expect(grupos).toHaveLength(3);
    // empresa: avatar, nome e hora da primeira mensagem, dois balões
    expect(grupos[0]).toMatch(/msg-grupo-avatar/);
    expect(grupos[0]).toMatch(/<p class="msg-grupo-autor">AZYRA <time [^>]*>12:34<\/time><\/p>/);
    expect(grupos[0].match(/class="msg-bubble"/g)).toHaveLength(2);
    // as minhas: à direita, sem avatar e só com a hora
    expect(grupos[1]).toMatch(/^ msg-grupo--eu"/);
    expect(grupos[1]).not.toMatch(/msg-grupo-avatar/);
    expect(grupos[1]).toMatch(/<p class="msg-grupo-autor"><time [^>]*>13:40<\/time><\/p>/);
    expect(grupos[1].match(/class="msg-bubble-row mine"/g)).toHaveLength(2);
    expect(grupos[2]).toMatch(/AZYRA <time [^>]*>17:08<\/time>/);
  });

  test("5 minutos ou mais de intervalo abrem outro grupo; outro dia, outro separador", () => {
    const { mensagensDesktop } = carregar();
    const html = mensagensDesktop([
      msg(false, "a", em(9, 20, 12, 0)),
      msg(false, "b", em(9, 20, 12, 5)),
      msg(false, "c", em(9, 21, 9, 0)),
    ]);
    expect(html.match(/<section class="msg-grupo/g)).toHaveLength(3);
    expect(html.match(/class="msg-dia"/g)).toHaveLength(2);
    expect(html).toMatch(/21 de out\./);
  });

  test("o texto das mensagens e o nome da empresa são escapados", () => {
    const { mensagensDesktop } = carregar({ activeConversation: { company_name: "<b>X</b>" } });
    const html = mensagensDesktop([msg(false, "<img src=x onerror=alert(1)>", em(9, 20, 12, 0))]);
    expect(html).not.toMatch(/<img|<b>/);
    expect(html).toMatch(/&lt;img src=x onerror=alert\(1\)&gt;/);
    expect(html).toMatch(/&lt;b&gt;X&lt;\/b&gt; <time/);
  });

  test("separador de dia mostra o ano quando não é o atual", () => {
    const { dataDoDia } = carregar();
    expect(dataDoDia(new Date(ANO - 1, 9, 20, 12).toISOString())).toMatch(new RegExp(`^20 de out\\. de ${ANO - 1}$`));
  });
});

describe("painel \"Vaga\"", () => {
  const vaga = {
    id: 5, title: "Estágio Dev de Software", level: "estagio", modality: "hibrido",
    location: "Rio de Janeiro - RJ", tags: "Inclusiva", salary_min: 1800, salary_max: 2500,
    english_level: "intermediario", created_at: new Date(2026, 9, 15, 12).toISOString(),
    description: "Buscamos estudantes.", responsibilities: "Desenvolvimento: APIs.",
  };

  test("etiquetas na ordem do protótipo, com só a cidade no local", () => {
    const { painelDaVaga } = carregar();
    const html = painelDaVaga(vaga, "AZYRA");
    const etiquetas = [...html.matchAll(/<li><span>([^<]*)<\/span><\/li>/g)].map(m => m[1]);
    expect(etiquetas).toEqual(["Rio de Janeiro", "Híbrido", "Inclusiva", "Estágio"]);
    // o local completo fica em "Outras informações"
    expect(html).toMatch(/<dt>Local<\/dt><dd>Rio de Janeiro - RJ<\/dd>/);
  });

  test("descrição, responsabilidades, \"Ver mais\" e outras informações", () => {
    const { painelDaVaga } = carregar();
    const html = painelDaVaga(vaga, "AZYRA");
    expect(html).toMatch(/<h3 class="msg-vaga-titulo">Estágio Dev de Software<\/h3>/);
    expect(html).toMatch(/Publicação: 15\/10\/2026/);
    expect(html).toMatch(/<h4>Descrição da vaga<\/h4><p class="msg-vaga-texto">Buscamos estudantes\.<\/p>/);
    expect(html).toMatch(/<h4>Responsabilidades<\/h4><p class="msg-vaga-texto msg-vaga-resp">Desenvolvimento: APIs\.<\/p>/);
    expect(html).toMatch(/<a class="msg-vaga-mais" href="\/vagas\/5" target="_blank" rel="noopener">Ver mais<\/a>/);
    expect(html).toMatch(/<dd class="msg-vaga-salario">R\$\s1\.800 – R\$\s2\.500<\/dd>/);
    expect(html).toMatch(/<dt>Inglês<\/dt><dd>Intermediário<\/dd>/);
  });

  test("sem salário nem inglês exigido, esses itens não aparecem; o texto da vaga é escapado", () => {
    const { painelDaVaga } = carregar();
    const html = painelDaVaga({ ...vaga, title: "<script>x</script>", salary_min: null, salary_max: null, english_level: "nenhum" }, "AZYRA");
    expect(html).not.toMatch(/Faixa salarial|Inglês|<script>/);
    expect(html).toMatch(/&lt;script&gt;x&lt;\/script&gt;/);
  });

  test("faixa salarial com só um dos limites", () => {
    const { faixaSalarial } = carregar();
    expect(faixaSalarial({ salary_min: 1500 })).toMatch(/^a partir de R\$\s1\.500$/);
    expect(faixaSalarial({ salary_max: 3000 })).toMatch(/^até R\$\s3\.000$/);
    expect(faixaSalarial({})).toBeNull();
  });

  test("cidade da etiqueta: tira só a UF do fim", () => {
    const { cidade } = carregar();
    expect(cidade("São Paulo, SP")).toBe("São Paulo");
    expect(cidade("Rio de Janeiro - RJ")).toBe("Rio de Janeiro");
    expect(cidade("Belo Horizonte/MG")).toBe("Belo Horizonte");
    expect(cidade("Remoto")).toBe("Remoto");
    expect(cidade("SP")).toBe("SP");
  });
});
