// Reformulação do dashboard/menu do ADM (desktop). Renderiza o EJS e confere
// landmarks, headings, links dos cards e o novo header.
const path = require('path');
const ejs = require('ejs');

const VIEWS = path.join(__dirname, '..', 'views');
const user = { name: 'Arthur Maeda', email: 'a@a.com', type: 'admin' };

describe('ADM — header', () => {
  let html;
  beforeAll(async () => {
    html = await ejs.renderFile(path.join(VIEWS, 'partials', 'header-admin.ejs'),
      { user, currentPage: 'admin-dashboard' });
  });

  test('nav desktop tem os 5 itens do protótipo, sem Configurações', () => {
    const nav = html.match(/<nav class="header-nav"[\s\S]*?<\/nav>/)[0];
    ['Dashboard', 'Usuários', 'Empresas', 'Vagas', 'Relatórios']
      .forEach(t => expect(nav).toContain(t));
    expect(nav).not.toContain('Configurações');
    expect(nav).toMatch(/aria-current="page"/);
  });

  test('Configurações fica no menu do usuário; bloco mostra nome e "Administrador"', () => {
    expect(html).toMatch(/<ul class="user-menu-list user-menu-list--admin"[\s\S]*href="\/admin\/configuracoes"/);
    expect(html).toContain('Arthur Maeda');
    expect(html).toContain('<small>Administrador</small>');
  });
});

describe('ADM — dashboard', () => {
  let html;
  beforeAll(async () => {
    html = await ejs.renderFile(path.join(VIEWS, 'admin-dashboard.ejs'), { user, currentPage: 'admin-dashboard' });
  });

  test('um <main id="main-content"> e um único <h1>', () => {
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toContain('id="main-content"');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });

  test('headings sem salto: h1 → h2, sem h3', () => {
    expect(html.match(/<h2\b/g)).toHaveLength(2);
    expect(html).not.toMatch(/<h3\b/);
  });

  test('6 cards de métrica são links para as telas certas', () => {
    const lis = html.match(/<a class="adm-stat" href="[^"]+"/g);
    expect(lis).toHaveLength(6);
    ['/admin/usuarios', '/admin/empresas', '/admin/vagas', '/admin/relatorios/compatibilidade-de-matchs', '/admin/relatorios']
      .forEach(h => expect(html).toContain(`href="${h}"`));
  });

  test('tabela com th scope e colunas Nome/E-mail/Nível/Cadastro', () => {
    ['Nome', 'E-mail', 'Nível', 'Cadastro'].forEach(c =>
      expect(html).toContain(`<th scope="col">${c}</th>`));
  });

  test('dados do banco passam por escapeHtml', () => {
    expect(html).toContain('/js/escape-html.js');
    expect(html).toMatch(/escapeHtml\(d\.email\)/);
    expect(html).toMatch(/escapeHtml\(nome\)/);
  });
});
