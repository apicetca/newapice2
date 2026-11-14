// Pop-up "Gerar relatório" (partial + AR.initGerar) nas seis telas de Admin → Relatórios.
const path = require('path');
const fs = require('fs');
const ejs = require('ejs');
const { CATEGORIAS } = require('../config/relatorios');

const COM_VIEW = CATEGORIAS.filter(c => c.view);
const render = (view, categoria) => ejs.renderFile(path.join(__dirname, '..', 'views', `${view}.ejs`),
  { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-relatorios', categoria });

test('as seis categorias do índice têm tela própria', () => {
  expect(COM_VIEW.map(c => c.slug)).toEqual(CATEGORIAS.map(c => c.slug));
});

describe.each(COM_VIEW.map(c => [c.slug, c]))('%s', (slug, categoria) => {
  let html;
  beforeAll(async () => { html = await render(categoria.view, categoria); });

  test('o cartão tem um botão que abre um <dialog> modal rotulado', () => {
    expect(html).toContain('id="gen-open" aria-haspopup="dialog"');
    expect(html).toMatch(/<dialog class="adg-dialog" id="gen-dialog" aria-labelledby="gen-title">/);
    expect(html).toContain('aria-label="Fechar"');
  });
  test('o pop-up traz período (7/30/90/personalizado) e formato (PDF/Excel), 7 dias marcado', () => {
    ['7', '30', '90', 'custom'].forEach(v => expect(html).toContain(`name="gp" value="${v}"`));
    expect(html).toMatch(/name="gp" value="7" checked/);
    expect(html).toContain('name="gf" value="pdf" checked');
    expect(html).toContain('name="gf" value="xlsx"');
    expect(html).toContain('for="g-from"');
    expect(html).toContain('for="g-to"');
  });
  test('só o relatório de planos tem "Tipo de plano" (Dev marcado, Empresa)', () => {
    if (slug === 'planos-e-assinaturas') {
      expect(html).toContain('<legend>Tipo de plano</legend>');
      expect(html).toContain('name="gt" value="dev" checked');
      expect(html).toContain('name="gt" value="empresa"');
      expect(html).toContain('comTipo: true');
    } else {
      expect(html).not.toContain('name="gt"');
      expect(html).toContain('comTipo: false');
    }
  });
  test('a página inicializa o pop-up e não tem mais o formulário inline antigo', () => {
    expect(html).toMatch(/AR\.initGerar\(\{ api: API, comTipo: (true|false), toast \}\)/);
    expect(html).not.toContain('const genSel');
    expect(html).not.toContain('adc-gen');
  });
});

describe('AR.initGerar (public/js/admin-relatorio.js)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin-relatorio.js'), 'utf8');
  test('abre com showModal, fecha por X e clique no fundo, devolve o foco e envia o tipo só quando pedido', () => {
    expect(src).toContain('dlg.showModal()');
    expect(src).toContain('dlg.close()');
    expect(src).toContain('e.target === dlg');
    expect(src).toContain('open.focus()');
    expect(src).toMatch(/comTipo \? `tipo=/);
  });
});
