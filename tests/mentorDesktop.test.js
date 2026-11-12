// tests/mentorDesktop.test.js
// Tela do Mentor no desktop (protótipo de 1440px): barra lateral, estado vazio
// "Por onde começamos?" e campo "Pergunte ao Mentor". Só o desktop muda —
// celular e tablet continuam com o layout de mensagens.css.
const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ler  = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");
const view = ler("views/mentor.ejs");
const css  = ler("public/css/mentor-desktop.css");

test("a página carrega o CSS de desktop depois do mensagens.css", () => {
  expect(view.indexOf('href="/css/mentor-desktop.css"')).toBeGreaterThan(view.indexOf('href="/css/mensagens.css"'));
});

test("fora do @media de desktop, o CSS só esconde a barra lateral", () => {
  const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const inicioMedia = semComentarios.indexOf("@media (min-width: 1024px)");
  expect(inicioMedia).toBeGreaterThan(-1);
  expect(semComentarios.slice(0, inicioMedia).trim()).toBe(".mentor-sidebar { display: none; }");
  // o bloco do @media vai até o fim do arquivo
  const bloco = semComentarios.slice(inicioMedia);
  const abre = (bloco.match(/\{/g) || []).length;
  const fecha = (bloco.match(/\}/g) || []).length;
  expect(abre).toBe(fecha);
  expect(bloco.trim().endsWith("}")).toBe(true);
});

test("barra lateral: título, busca, Nova conversa e histórico", () => {
  expect(view).toMatch(/<aside class="mentor-sidebar"/);
  expect(view).toMatch(/class="mentor-sidebar-titulo">Mentor</);
  expect(view).toMatch(/id="mentorBusca" placeholder="Pesquisar conversas"/);
  expect(view).toMatch(/id="btn-mentor-nova"/);
  expect(view).toMatch(/Histórico de conversas/);
  // "Nova conversa" não apaga nada no servidor: só abre uma conversa em branco
  expect(view).not.toMatch(/nova-conversa|confirm\(/);
});

test("histórico de conversas: lista do servidor, cada item abre a conversa para continuar", () => {
  expect(view).toMatch(/fetch\("\/api\/ai\/mentor\/conversas"\)/);
  expect(view).toMatch(/\/api\/ai\/mentor\/historico\?conversa=\$\{encodeURIComponent\(id\)\}/);
  expect(view).toMatch(/<button type="button" class="mentor-historico-item\$\{aberta \? " ativo" : ""\}" data-conversa="\$\{c\.id\}"/);
  expect(view).toMatch(/\$\("mentorHistorico"\)\.addEventListener\("click"/);
  // o título (primeira pergunta do usuário) vai num atributo: aspas também são escapadas
  expect(view).toMatch(/title="\$\{escapeHtml\(c\.titulo\)\.replace\(\/"\/g, "&quot;"\)\}"/);
  // a pergunta vai com a conversa aberta; sem ela, o servidor começa uma nova
  expect(view).toMatch(/if \(conversaAtual\) formData\.append\("conversa", conversaAtual\);/);
  // desktop abre em "Por onde começamos?"; celular/tablet, na conversa mais recente
  expect(view).toMatch(/!DESKTOP\.matches && conversas\.length \? await buscarConversa\(conversas\[0\]\.id\) : null/);
});

test("estado vazio e placeholder do desktop escolhidos por matchMedia", () => {
  expect(view).toMatch(/window\.matchMedia\("\(min-width: 1024px\)"\)/);
  expect(view).toMatch(/Por onde começamos\?/);
  expect(view).toMatch(/Seu assistente para impulsionar sua carreira e superar seus gaps técnicos\./);
  expect(view).toMatch(/"Pergunte ao Mentor"/);
});

test("o atalho da entrevista fica só no estado vazio de celular/tablet", () => {
  const desktop = view.slice(view.indexOf('class="mentor-vazio"'), view.indexOf("</div>`", view.indexOf('class="mentor-vazio"')));
  expect(desktop).toMatch(/Por onde começamos\?/);
  expect(desktop).not.toMatch(/btn-mentor-entrevista|Simular uma entrevista/);
  expect(view.match(/id="btn-mentor-entrevista"/g)).toHaveLength(1);
  // sem o botão no desktop, o clique é ligado só quando ele existe
  expect(view).toMatch(/\$\("btn-mentor-entrevista"\)\?\.addEventListener/);
});

test("barra de digitação menor que a do protótipo: 34px nos botões e 16px no texto", () => {
  expect(css).toMatch(/#mentorChat \.msg-thread-input button \{ width: calc\(34 \* var\(--u\)\); height: calc\(34 \* var\(--u\)\); \}/);
  expect(css).toMatch(/font-size: calc\(16 \* var\(--u\)\);\s*line-height: calc\(20 \* var\(--u\)\);/);
});
