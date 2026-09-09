// Bug reportado pelo usuário: "quando clico para ver a senha ela não fica
// visível". A CSP configurada em server.js (via helmet) definia scriptSrc
// com 'unsafe-inline', mas nunca configurava scriptSrcAttr — o helmet 8
// aplica, por padrão, "script-src-attr": ["'none'"] quando essa diretiva não
// é explicitada (ver node_modules/helmet: getDefaultDirectives()).
// script-src-attr governa especificamente atributos inline de evento
// (onclick="...", etc.), separado de script-src (que só cobre tags
// <script>) — então TODO onclick="" do site (20 arquivos em views/,
// incluindo o toggle de senha em login.ejs/redefinir-senha.ejs, o toggle de
// modo escuro/alto contraste no menu do usuário, etc.) era silenciosamente
// bloqueado pelo navegador, sem erro visível na tela.
//
// Confirmado com um teste manual via Playwright (chromium real, não
// jsdom): antes da correção, clicar no botão de mostrar senha em
// login.ejs e redefinir-senha.ejs não mudava o `type` do input (o
// console do navegador reportava a violação de CSP); depois da correção,
// os três fluxos testados (login, cadastro, redefinir-senha) passaram a
// alternar corretamente entre `type="password"` e `type="text"`.
const fs = require('fs');
const path = require('path');

const serverContent = fs.readFileSync(
  path.join(__dirname, '..', 'server.js'),
  'utf8'
);

describe('Bug — CSP bloqueava todo onclick="" inline (script-src-attr default do helmet)', () => {
  test('server.js define scriptSrcAttr explicitamente, não dependendo do default "none" do helmet', () => {
    const cspBlockMatch = serverContent.match(/contentSecurityPolicy:\s*\{[\s\S]*?\n\s*\},/);
    expect(cspBlockMatch).not.toBeNull();
    expect(cspBlockMatch[0]).toMatch(/scriptSrcAttr:\s*\[[^\]]*\]/);
  });

  test('scriptSrcAttr permite execução inline (não é só \'none\')', () => {
    const scriptSrcAttrMatch = serverContent.match(/scriptSrcAttr:\s*\[([^\]]*)\]/);
    expect(scriptSrcAttrMatch).not.toBeNull();
    expect(scriptSrcAttrMatch[1]).toMatch(/unsafe-inline/);
  });
});
