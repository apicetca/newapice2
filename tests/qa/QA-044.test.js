// QA-044 — Menu inferior (pílula) removido da área de visitante.
// O header público (partials/header.ejs) renderizava uma .bottom-nav com
// "Como funciona / Entrar / Criar conta" no mobile. Ela foi removida; como no
// mobile o topo escondia .header-actions (e a pílula era o único acesso a
// Entrar/Criar conta), os botões do topo passam a aparecer também no mobile
// só para visitante (.site-header--visitante), e o body deixa de reservar o
// espaço da pílula quando não há .bottom-nav na página.
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const ROOT = path.join(__dirname, '..', '..');
const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'header.css'), 'utf8');

// Conteúdo de um bloco @media (max-width: 860px) que contenha o trecho dado.
const mediaBlockWith = (needle) => {
  const re = /@media \(max-width: 860px\) \{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1, i = re.lastIndex;
    while (depth && i < css.length) { depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0; i++; }
    const block = css.slice(re.lastIndex, i - 1);
    if (block.includes(needle)) return block;
  }
  return null;
};

describe('QA-044 — header de visitante sem menu inferior', () => {
  let html;
  beforeAll(async () => {
    html = await ejs.renderFile(path.join(ROOT, 'views', 'partials', 'header.ejs'), {});
  });

  test('não renderiza .bottom-nav nem seus itens', () => {
    expect(html).not.toMatch(/bottom-nav/);
  });

  test('mantém o header com Entrar e Cadastrar-se (acesso à conta)', () => {
    expect(html).toMatch(/<header class="site-header site-header--visitante"/);
    expect(html).toMatch(/<a href="\/login"[^>]*>Entrar<\/a>/);
    expect(html).toMatch(/<a href="\/cadastro"[^>]*>Cadastrar-se<\/a>/);
  });

  test('o script do header não depende mais de .bottom-nav-item', () => {
    expect(html).not.toMatch(/bottom-nav-item/);
    expect(html).toMatch(/\.header-link\[data-path\]/);
  });

  test('no mobile os botões do topo aparecem só para visitante', () => {
    const block = mediaBlockWith('.site-header--visitante');
    expect(block).not.toBeNull();
    expect(block).toMatch(/\.site-header--visitante\s+\.header-actions\s*\{[^}]*display:\s*flex/);
  });

  test('o body só reserva espaço da pílula quando a página tem .bottom-nav', () => {
    const block = mediaBlockWith(':not(:has(.bottom-nav))');
    expect(block).not.toBeNull();
    expect(block).toMatch(/body:not\(:has\(\.bottom-nav\)\)\s*\{[^}]*padding-bottom:\s*0/);
  });

  test('a reserva de espaço das páginas autenticadas continua (QA-026)', () => {
    expect(css).toMatch(/body\s*\{\s*padding-bottom:\s*calc\(80px \+ env\(safe-area-inset-bottom\)\)/);
  });
});
