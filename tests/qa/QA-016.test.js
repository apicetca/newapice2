// QA-016 — <dialog> usado sem a API nativa correspondente
// Os elementos são <dialog role="dialog" aria-modal="true"> de verdade, mas
// o JS só fazia classList.add/remove('open') — nunca chamava .showModal()
// nem .close(). Sem .showModal(), o elemento nunca ganha o atributo `open`
// nativo: sem inert no fundo, sem tab-trap, sem Esc nativo, apesar do
// aria-modal="true" prometer isso. Corrigido chamando showModal()/close(),
// com um listener do evento nativo "close" mantendo a classe "open" (usada
// pelas transições CSS existentes) sincronizada mesmo quando o dialog fecha
// via Esc nativo, não só via closeXModal().
const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');
const readView = name => fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8').replace(/\r\n/g, '\n');

describe.each([
  { file: 'mensagens.ejs',          openFn: 'openNewConvModal', closeFn: 'closeNewConvModal', dialogGetter: '$("modalNewConv")' },
])('$file — modal "nova conversa" usa a API nativa de <dialog>', ({ file, openFn, closeFn, dialogGetter }) => {
  const content = readView(file);

  test(`${openFn}() chama showModal()`, () => {
    const fn = content.match(new RegExp(`function ${openFn}\\(\\) \\{[\\s\\S]*?\\n  \\}`))[0];
    expect(fn).toContain(`${dialogGetter}.showModal()`);
  });

  test(`${closeFn}() chama close() em vez de só remover a classe`, () => {
    const fn = content.match(new RegExp(`function ${closeFn}\\(\\) \\{[\\s\\S]*?\\}`))[0];
    expect(fn).toBe(`function ${closeFn}() { ${dialogGetter}.close(); }`);
  });

  test('um listener do evento nativo "close" remove a classe "open"', () => {
    expect(content).toMatch(new RegExp(
      `${dialogGetter.replace(/[()$]/g, '\\$&')}\\.addEventListener\\("close", \\(\\) => ${dialogGetter.replace(/[()$]/g, '\\$&')}\\.classList\\.remove\\("open"\\)\\)`
    ));
  });
});

describe.each(['empresa-dashboard.ejs', 'empresa-vagas.ejs'])(
  '%s — modal de exclusão usa a API nativa de <dialog>',
  (file) => {
    const content = readView(file);

    test('openDeleteModal() chama showModal()', () => {
      const fn = content.match(/function openDeleteModal\(id, title\) \{[\s\S]*?\n(?: {0,2})\}/)[0];
      expect(fn).toContain('.showModal();');
    });

    test('closeDeleteModal() chama close() em vez de só remover a classe', () => {
      const fn = content.match(/function closeDeleteModal\(\) \{[\s\S]*?\n(?: {0,2})\}/)[0];
      expect(fn).toContain('.close();');
      expect(fn).not.toContain('classList.remove("open")');
    });

    test('um listener do evento nativo "close" remove a classe "open"', () => {
      expect(content).toMatch(/addEventListener\("close",\s*\(\)\s*=>\s*\{\s*document\.getElementById\("modal-delete"\)\.classList\.remove\("open"\);\s*\}\);/);
    });
  }
);
