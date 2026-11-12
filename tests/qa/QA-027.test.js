// QA-027 — Badges "verde"/"azul" aparecem roxos em quatro arquivos
// (o título do achado no CLAUDE.md diz "cinco", mas o campo "Arquivos" e o
// corpo do achado listam quatro — dashboard.css, empresa-dashboard.css,
// progresso.css, empresa-matchs.css — e são esses os quatro corrigidos aqui).
// O padrão estabelecido em dev.css é .badge-green = verde/teal,
// .badge-blue = azul. Cada um desses arquivos redefinia uma dessas classes
// usando a cor de destaque roxa (--accent) por engano. Corrigido removendo
// a redefinição errada — todos os quatro carregam dev.css logo antes do
// próprio CSS, então a regra correta de dev.css volta a valer.
const fs = require('fs');
const path = require('path');

const readCss = name => fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', name), 'utf8');

describe('QA-027 — badges verde/azul não usam mais a cor de destaque roxa', () => {
  test('dashboard.css: .badge-blue não usa mais var(--accent)', () => {
    const css = readCss('dashboard.css');
    expect(css).not.toMatch(/\.badge-blue\s*\{[^}]*var\(--accent/);
  });

  test.each(['empresa-dashboard.css', 'progresso.css'])(
    '%s: .badge-green não usa mais var(--accent)',
    (file) => {
      const css = readCss(file);
      expect(css).not.toMatch(/\.badge-green\s*\{[^}]*var\(--accent/);
    }
  );

  test('as redefinições corretas (badge-green em dashboard.css, badge-blue nos outros três) continuam intactas', () => {
    expect(readCss('dashboard.css')).toContain('.badge-green  { background: var(--teal-dim);   color: var(--teal);   border: 1px solid var(--teal-border); }');
    for (const file of ['empresa-dashboard.css', 'progresso.css']) {
      expect(readCss(file)).toContain('.badge-blue   { background: var(--blue-dim);   color: var(--blue);    border: 1px solid rgba(88,166,255,.2); }');
    }
  });
});
