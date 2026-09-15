// QA-042 — og:image/twitter:image da landing page usam caminho relativo em
// vez de URL absoluta. Especificação Open Graph e a maioria dos crawlers de
// redes sociais esperam uma URL absoluta — corrigido para usar o mesmo
// domínio de produção já usado em og:url/canonical (confirmado no QA-022).
const fs = require('fs');
const path = require('path');

const indexContent = fs.readFileSync(
  path.join(__dirname, '..', '..', 'views', 'index.ejs'),
  'utf8'
);

describe('QA-042 — og:image/twitter:image usam URL absoluta', () => {
  test('og:image usa a URL absoluta do domínio de produção', () => {
    expect(indexContent).toContain('<meta property="og:image"       content="https://newapice22.onrender.com/images/principal.webp" />');
  });

  test('twitter:image usa a URL absoluta do domínio de produção', () => {
    expect(indexContent).toContain('<meta name="twitter:image"       content="https://newapice22.onrender.com/images/principal.webp" />');
  });

  test('não sobra caminho relativo para a imagem de compartilhamento', () => {
    expect(indexContent).not.toContain('content="/images/principal.webp"');
  });
});
