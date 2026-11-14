// Admin · Relatórios: índice de categorias e páginas de detalhe.
const path = require('path');
const ejs = require('ejs');
const { CATEGORIAS, porSlug } = require('../config/relatorios');

const render = (view, locals) => ejs.renderFile(path.join(__dirname, '..', 'views', view),
  { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-relatorios', ...locals });

describe('config/relatorios', () => {
  test('seis categorias do protótipo, slugs únicos', () => {
    expect(CATEGORIAS.map(c => c.titulo)).toEqual([
      'Crescimento de usuários', 'Desempenho das vagas', 'Compatibilidade de matchs',
      'Atividade das empresas', 'Uso da plataforma', 'Planos e assinaturas',
    ]);
    expect(new Set(CATEGORIAS.map(c => c.slug)).size).toBe(6);
  });
  test('porSlug devolve a categoria ou undefined', () => {
    expect(porSlug('desempenho-das-vagas').titulo).toBe('Desempenho das vagas');
    expect(porSlug('nao-existe')).toBeUndefined();
  });
});

describe('admin-relatorios.ejs (índice)', () => {
  let html;
  beforeAll(async () => { html = await render('admin-relatorios.ejs', { categorias: CATEGORIAS }); });

  test('um main, um h1 "Visualizar relatórios" e a lista de categorias', () => {
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Visualizar relatórios');
    expect(html).toContain('Selecione uma categoria');
    expect(html.match(/<li>\s*<a class="adr-card"/g)).toHaveLength(6);
  });
  test('cada card é um link para a página da categoria', () => {
    CATEGORIAS.forEach(c => expect(html).toContain(`href="/admin/relatorios/${c.slug}"`));
  });
  test('header do admin com "Relatórios" como página atual', () => {
    expect(html).toMatch(/href="\/admin\/relatorios"\s+class="header-link is-active"/);
  });
});

describe('admin-relatorio.ejs (detalhe)', () => {
  test('categoria com dados: seções, tabelas com th scope e h1 > h2', async () => {
    const html = await render('admin-relatorio.ejs', { categoria: { slug: 'x', titulo: 'Teste', descricao: 'd', secoes: ['vagasPorNivel', 'candidaturas'] } });
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Vagas ativas por nível');
    expect(html).toContain('<th scope="col">Candidaturas</th>');
    expect(html).toContain('href="/admin/relatorios" class="adr-back"');
    expect(html).toContain('escapeHtml(v.title)');
  });
  test('categoria sem dados mostra aviso e não carrega o script de relatório', async () => {
    const html = await render('admin-relatorio.ejs', { categoria: { slug: 'x', titulo: 'Sem dados', descricao: 'd', secoes: [] } });
    expect(html).toContain('Este relatório ainda não está disponível.');
    expect(html).not.toContain('/api/admin/reports');
  });
});
