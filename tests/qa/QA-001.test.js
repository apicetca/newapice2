// QA-001 — XSS armazenado atinge diretamente a conta do administrador
// As 6 páginas do painel admin montam tabelas via `tr.innerHTML = \`...\``
// inserindo nome de devs/empresas e título de vagas sem escape.
const fs = require('fs');
const path = require('path');
const { escapeHtml } = require('../../public/js/escape-html');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');

function readView(name) {
  return fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8');
}

describe('QA-001 — escapeHtml()', () => {
  test('escapa caracteres HTML perigosos', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>'))
      .toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('não quebra com null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  test('não altera texto sem caracteres especiais', () => {
    expect(escapeHtml('João Dias')).toBe('João Dias');
  });
});

describe('QA-001 — páginas do admin usam escapeHtml() nos campos vulneráveis', () => {
  const cases = [
    { file: 'admin-dashboard.ejs', mustContain: ['escapeHtml(nome || "—")', 'escapeHtml(d.email)', 'escapeHtml(nome)'] },
    { file: 'admin-usuarios.ejs', mustContain: ['escapeHtml(nome)', 'escapeHtml(u.email)'] },
    { file: 'admin-empresas.ejs', mustContain: ['escapeHtml(nome)', 'escapeHtml(e.email)'] },
    { file: 'admin-vagas.ejs', mustContain: ['escapeHtml(j.title)', 'escapeHtml(j.company'] },
    { file: 'admin-relatorio.ejs', mustContain: ['escapeHtml(v.title)'] },
  ];

  test.each(cases)('$file carrega /js/escape-html.js', ({ file }) => {
    const content = readView(file);
    expect(content).toMatch(/<script src="\/js\/escape-html\.js"><\/script>/);
  });

  test.each(cases)('$file escapa os campos vulneráveis', ({ file, mustContain }) => {
    const content = readView(file);
    for (const snippet of mustContain) {
      expect(content).toContain(snippet);
    }
  });
});
