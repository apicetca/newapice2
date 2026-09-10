// QA-035 — Páginas de autenticação não têm landmark <main>. login.ejs,
// cadastro.ejs, esqueci-senha.ejs e redefinir-senha.ejs usavam <section
// class="lp-left"> para a coluna do formulário (conteúdo principal da
// página) sem nenhum elemento <main>/role="main" em lugar nenhum —
// violação da regra landmark-one-main do axe-core. Corrigido trocando a
// tag de <section class="lp-left"> para <main class="lp-left">, já que
// essa coluna sempre teve o papel semântico de conteúdo principal.
const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');
const readView = name => fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8');

const FILES = ['login.ejs', 'cadastro.ejs', 'esqueci-senha.ejs', 'redefinir-senha.ejs'];

describe('QA-035 — páginas de autenticação têm landmark <main>', () => {
  test.each(FILES)('%s: a coluna do formulário (.lp-left) é um elemento <main>', (file) => {
    const content = readView(file);
    expect(content).toMatch(/<main class="lp-left"/);
    expect(content).not.toMatch(/<section class="lp-left"/);
  });

  test.each(FILES)('%s: o <main> tem seu fechamento correspondente (</main>)', (file) => {
    const content = readView(file);
    const mainOpenCount  = (content.match(/<main\b/g) || []).length;
    const mainCloseCount = (content.match(/<\/main>/g) || []).length;
    expect(mainOpenCount).toBeGreaterThan(0);
    expect(mainOpenCount).toBe(mainCloseCount);
  });
});
