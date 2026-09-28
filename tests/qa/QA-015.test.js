// QA-015 — Modais abrem sem mover o foco e fecham sem devolvê-lo
// `openAddModal()`/`openDeleteModal()` deixavam o foco no botão de fundo;
// ao fechar, o foco não voltava pra quem abriu o modal. `openEdit()` (no
// mesmo repositorios.ejs) já fazia a metade certa (`editDesc.focus()`),
// mostrando que é inconsistência, não limitação técnica. Corrigido: guarda
// `document.activeElement` em `lastFocused` ao abrir, move o foco pra dentro
// do modal, e devolve o foco em `lastFocused` ao fechar.
const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');
// Normaliza CRLF -> LF.
const readView = name => fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8').replace(/\r\n/g, '\n');

describe('QA-015 — repositorios.ejs move e devolve o foco nos dois modais', () => {
  const content = readView('repositorios.ejs');

  test('openAddModal() guarda o foco anterior e move o foco pra dentro do modal', () => {
    const fn = content.match(/async function openAddModal\(\) \{[\s\S]*?\n    \}/)[0];
    expect(fn).toContain('lastFocused = document.activeElement;');
    expect(fn).toMatch(/searchInput\.focus\(\)/);
  });

  test('openEdit() guarda o foco anterior (além de já focar o campo de título)', () => {
    const fn = content.match(/function openEdit\(id, desc, title\) \{[\s\S]*?\n    \}/)[0];
    expect(fn).toContain('lastFocused = document.activeElement;');
    expect(fn).toContain('editTitle.focus()');
  });

  test('closeModals() devolve o foco a lastFocused', () => {
    const fn = content.match(/function closeModals\(\) \{[\s\S]*?\n    \}/)[0];
    expect(fn).toMatch(/lastFocused\.focus\(\)/);
  });
});

describe.each(['empresa-dashboard.ejs', 'empresa-vagas.ejs'])(
  '%s move e devolve o foco no modal de exclusão',
  (file) => {
    const content = readView(file);

    test('openDeleteModal() guarda o foco anterior e move o foco pro botão Cancelar', () => {
      const fn = content.match(/function openDeleteModal\(id, title\) \{[\s\S]*?\n(?:  )?\}/)[0];
      expect(fn).toContain('lastFocused = document.activeElement;');
      expect(fn).toMatch(/\.btn-cancel.*\.focus\(\)/);
    });

    test('closeDeleteModal() devolve o foco a lastFocused', () => {
      const fn = content.match(/function closeDeleteModal\(\) \{[\s\S]*?\n(?:  )?\}/)[0];
      expect(fn).toMatch(/lastFocused\.focus\(\)/);
    });
  }
);
