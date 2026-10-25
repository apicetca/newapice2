// Bug: em /empresa/vagas/:id/candidaturas, o aviso "Fazer upgrade"
// (#premium-upsell) aparecia também para empresas que já são Premium.
// O JS faz `upsell.hidden = IS_PREMIUM`, mas o elemento tem
// `style="display:flex;..."` inline — e um estilo inline vence o
// `[hidden] { display: none }` do navegador, então o aviso continuava
// visível. Corrigido com uma regra `[hidden]` com !important (a única forma
// de vencer o estilo inline) em empresa-desenvolvedores.css, sem mexer no
// estilo inline — o aviso continua idêntico para quem não é Premium.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const view = fs.readFileSync(path.join(ROOT, 'views', 'empresa-candidaturas.ejs'), 'utf8');
const css  = fs.readFileSync(path.join(ROOT, 'public', 'css', 'empresa-desenvolvedores.css'), 'utf8');

describe('Aviso de upgrade some para empresas Premium', () => {
  test('empresa-candidaturas.ejs carrega empresa-desenvolvedores.css', () => {
    expect(view).toMatch(/href="\/css\/empresa-desenvolvedores\.css"/);
  });

  test('o JS esconde o aviso via atributo hidden quando a empresa é Premium', () => {
    expect(view).toMatch(/getElementById\("premium-upsell"\)\.hidden\s*=\s*IS_PREMIUM/);
  });

  test('#premium-upsell tem display inline — por isso a regra [hidden] precisa de !important', () => {
    expect(view).toMatch(/id="premium-upsell"[^>]*style="[^"]*display:\s*flex/);
    expect(css).toMatch(/#premium-upsell\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });
});
