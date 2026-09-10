// QA-037 — aria-label num <span> decorativo sem role compatível.
// <span class="unsaved-dot" id="unsaved-dot" hidden aria-label="...">
// não tem conteúdo textual nem role explícito — um <span> genérico não
// está na lista de elementos que a especificação ARIA-in-HTML permite
// nomear via aria-label (regra aria-prohibited-attr do axe-core).
// Corrigido adicionando role="status": além de resolver a violação, esse
// role suporta nomeação por aria-label e faz o indicador ser efetivamente
// anunciado a leitores de tela quando aparece (o objetivo real do
// elemento — sinalizar "alterações não salvas" — não é só decorativo).
const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');
const readView = name => fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8');

const FILES = ['perfil-dev.ejs', 'perfil-empresa.ejs'];

describe('QA-037 — #unsaved-dot usa um role que suporta aria-label', () => {
  test.each(FILES)('%s: #unsaved-dot tem role="status" junto do aria-label', (file) => {
    const content = readView(file);
    const spanMatch = content.match(/<span class="unsaved-dot"[^>]*>/);
    expect(spanMatch).not.toBeNull();
    expect(spanMatch[0]).toMatch(/role="status"/);
    expect(spanMatch[0]).toMatch(/aria-label="Alterações não salvas"/);
  });
});
