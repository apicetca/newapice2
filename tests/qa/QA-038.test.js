// QA-038 — Barras de progresso sem nome acessível. Elementos role="progressbar"
// sem aria-label/aria-labelledby — um leitor de tela anuncia só um número,
// sem contexto do que está progredindo.
//
// Nota: o achado original listava progresso.ejs (#gp-bar-wrap e .card-track)
// e empresa-desenvolvedores.ejs (.dev-stat-bar). Na revisão, `.card-track`
// já tinha `aria-label="Progresso em ${r.title}"` — não tinha o bug descrito,
// não foi tocado. Corrigidos: #gp-bar-wrap (progresso.ejs) e as duas
// .dev-stat-bar (empresa-desenvolvedores.ejs).
const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');
const readView = name => fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8');

describe('QA-038 — barras de progresso têm nome acessível', () => {
  test('progresso.ejs: #gp-bar-wrap tem aria-label', () => {
    const content = readView('progresso.ejs');
    const match = content.match(/<div class="gp-track"[^>]*id="gp-bar-wrap"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match[0]).toMatch(/aria-label="[^"]+"/);
  });

  test('progresso.ejs: .card-track já tinha aria-label (fora do escopo desta correção)', () => {
    const content = readView('progresso.ejs');
    const match = content.match(/<div class="card-track"[\s\S]*?>/);
    expect(match).not.toBeNull();
    expect(match[0]).toMatch(/aria-label="/);
  });

  test('empresa-desenvolvedores.ejs: as duas .dev-stat-bar têm aria-label distinto', () => {
    const content = readView('empresa-desenvolvedores.ejs');
    const matches = [...content.matchAll(/<span class="dev-stat-bar"[^>]*>/g)];
    expect(matches.length).toBe(2);
    matches.forEach(m => expect(m[0]).toMatch(/aria-label="[^"]+"/));
    // labels distintos entre as duas barras (roadmap vs. match)
    const labels = matches.map(m => m[0].match(/aria-label="([^"]+)"/)[1]);
    expect(new Set(labels).size).toBe(2);
  });
});
