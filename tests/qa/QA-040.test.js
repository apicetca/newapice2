// QA-040 — CSP bloqueia o preconnect para os domínios de fontes em toda
// página. Toda página inclui <link rel="preconnect" href="https://fonts.
// googleapis.com"> e para fonts.gstatic.com, mas connectSrc só permitia
// 'self' — o Chromium trata o hint de preconnect como sujeito a
// connect-src, e bloqueava, gerando um erro de CSP no console em toda
// página carregada (sem quebra visual, já que a stylesheet em si é
// governada por style-src, que já permitia fonts.googleapis.com).
// Corrigido liberando os dois domínios de fonte em connectSrc.
const fs = require('fs');
const path = require('path');

const serverContent = fs.readFileSync(
  path.join(__dirname, '..', '..', 'server.js'),
  'utf8'
);

describe('QA-040 — CSP libera connect-src para os domínios de fontes usados no preconnect', () => {
  test('connectSrc inclui fonts.googleapis.com e fonts.gstatic.com', () => {
    const connectSrcMatch = serverContent.match(/connectSrc:\s*\[([^\]]*)\]/);
    expect(connectSrcMatch).not.toBeNull();
    expect(connectSrcMatch[1]).toMatch(/https:\/\/fonts\.googleapis\.com/);
    expect(connectSrcMatch[1]).toMatch(/https:\/\/fonts\.gstatic\.com/);
  });

  test('connectSrc continua exigindo \'self\' (não afrouxa além do necessário)', () => {
    const connectSrcMatch = serverContent.match(/connectSrc:\s*\[([^\]]*)\]/);
    expect(connectSrcMatch[1]).toMatch(/'self'/);
  });
});
