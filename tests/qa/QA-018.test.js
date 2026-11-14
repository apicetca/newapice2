// QA-018 — Hierarquia de headings inconsistente em seis páginas
// Três padrões quebrados: (a) nenhum <h1> na página — mensagens.ejs,
// empresa-mensagens.ejs, mentor.ejs; (b) múltiplos <h1>, um por seção —
// admin-dashboard.ejs (2), admin-configuracoes.ejs (2), admin-relatorios.ejs
// (4); (c) salto de h1 direto pra h3 sem h2 — empresa-matchs.ejs.
const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');
const readView = name => fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8');

const countTag = (content, tag) => (content.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length;

describe('QA-018 — cada página tem exatamente um <h1>', () => {
  test.each(['mensagens.ejs', 'empresa-mensagens.ejs', 'mentor.ejs'])(
    '%s: tinha zero <h1>, agora tem exatamente um',
    (file) => {
      expect(countTag(readView(file), 'h1')).toBe(1);
    }
  );

  test.each(['admin-configuracoes-catalogo.ejs'])(
    '%s: os <h1> de seção foram rebaixados para <h2> (resta só o <h1> da página, oculto)',
    (file) => {
      expect(countTag(readView(file), 'h1')).toBe(1);
    }
  );
});

describe('QA-018 — empresa-matchs.ejs não salta de h1 pra h3 sem h2', () => {
  const content = readView('empresa-matchs.ejs');

  test('mantém um único <h1> de página', () => {
    expect(countTag(content, 'h1')).toBe(1);
  });

  // Página refeita: h1 → h2 (Matches / Matches vagas) → h3 (dev no destaque; vaga no grupo) → h4 (dev no grupo).
  test('hierarquia sem saltos: h2 das seções antes dos h3, e h4 só dentro de grupo de vaga (h3)', () => {
    expect((content.match(/<h2 class="mt-title"/g) || []).length).toBe(2);
    expect(content).toContain('<h3 class="mt-nome">');
    expect(content).toContain('<h4 class="mt-nome">');
    expect(content).toMatch(/<h3>\$\{escapeHtml\(v\.title\)\}<\/h3>/);
    expect(content).not.toMatch(/<h2 class="match-/);
  });
});
