// Admin → Configurações: índice de categorias, páginas e catálogo de skills preservado.
const path = require('path');
const ejs = require('ejs');
const { CATEGORIAS, porSlug } = require('../config/configuracoes');

const render = (view, locals) => ejs.renderFile(path.join(__dirname, '..', 'views', `${view}.ejs`),
  { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-configuracoes', ...locals });

describe('config/configuracoes', () => {
  test('duas categorias do protótipo, slugs únicos', () => {
    expect(CATEGORIAS.map(c => c.titulo)).toEqual(['Categorias e vagas', 'Administração e segurança']);
    expect(new Set(CATEGORIAS.map(c => c.slug)).size).toBe(2);
  });
  test('porSlug devolve a categoria ou undefined; todas têm tela própria', () => {
    expect(porSlug('administracao-e-seguranca').titulo).toBe('Administração e segurança');
    expect(porSlug('algoritmo-de-match')).toBeUndefined();
    expect(CATEGORIAS.filter(c => !c.view)).toEqual([]);
  });
});

describe('admin-configuracoes.ejs (índice)', () => {
  let html;
  beforeAll(async () => { html = await render('admin-configuracoes', { categorias: CATEGORIAS }); });

  test('um main, um h1 (oculto) e os dois cards com título e descrição', () => {
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('class="visually-hidden">Configurações</h1>');
    ['Categorias e vagas', 'Áreas profissionais, modalidades e níveis.', 'Administração e segurança', 'Acessos, gerenciamento e histórico.']
      .forEach(t => expect(html).toContain(t));
    expect(html.match(/<a class="adr-card"/g)).toHaveLength(2);
  });
  test('cada card leva à página da categoria', () => {
    CATEGORIAS.forEach(c => expect(html).toContain(`href="/admin/configuracoes/${c.slug}"`));
  });
  test('Configurações fica no menu do usuário (aria-current) e fora da navegação principal', () => {
    expect(html).toMatch(/<a role="menuitem" href="\/admin\/configuracoes" aria-current="page">Configurações<\/a>/);
    const nav = html.match(/<nav class="header-nav"[\s\S]*?<\/nav>/)[0];
    expect(nav).not.toContain('Configurações');
  });
});

describe('catálogo de skills (Categorias e vagas)', () => {
  test('mantém o catálogo e ganhou o voltar para Configurações', async () => {
    const html = await render('admin-configuracoes-catalogo', { categoria: porSlug('categorias-e-vagas') });
    expect(html).toContain('href="/admin/configuracoes/categorias-e-vagas" class="catalog-back"');
    expect(html).toContain('/api/admin/skills');
    expect(html).toContain('Carregando catálogo de skills');
  });
});
