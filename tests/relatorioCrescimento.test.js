// Relatório "Crescimento de usuários": cálculo, API, CSV e páginas.
const path = require('path');
const ejs = require('ejs');
const request = require('supertest');
const express = require('express');

jest.mock('../database/db', () => ({ query: jest.fn(), getConnection: jest.fn(), ready: Promise.resolve() }));
const db = require('../database/db');
const adminController = require('../controllers/adminController');
const svc = require('../services/relatorioCrescimento');

const HOJE = '2026-11-13';

describe('resolverPeriodo', () => {
  test('atalhos de 7, 30 e 90 dias terminam hoje (inclusivo)', () => {
    expect(svc.resolverPeriodo({ periodo: '7' }, HOJE)).toEqual({ from: '2026-11-07', to: HOJE });
    expect(svc.resolverPeriodo({ periodo: '30' }, HOJE)).toEqual({ from: '2026-10-15', to: HOJE });
    expect(svc.resolverPeriodo({ periodo: '90' }, HOJE).from).toBe('2026-08-16');
  });
  test('período personalizado válido', () => {
    expect(svc.resolverPeriodo({ from: '2026-07-01', to: '2026-11-13' }, HOJE)).toEqual({ from: '2026-07-01', to: '2026-11-13' });
  });
  test.each([
    [{}], [{ periodo: '15' }], [{ from: '2026-13-01', to: '2026-11-01' }], [{ from: '2026-11-10', to: '2026-11-01' }],
    [{ from: '2026-11-01', to: '2026-12-01' }], [{ from: '2024-01-01', to: '2026-11-13' }], [{ from: 'x', to: 'y' }],
  ])('rejeita %j', (q) => {
    expect(() => svc.resolverPeriodo(q, HOJE)).toThrow();
  });
});

describe('gerarBuckets', () => {
  test('até 14 dias: um ponto por dia', () => {
    const { granularidade, buckets } = svc.gerarBuckets('2026-11-07', '2026-11-13');
    expect(granularidade).toBe('dia');
    expect(buckets).toHaveLength(7);
    expect(buckets[0]).toEqual({ inicio: '2026-11-07', fim: '2026-11-07', label: '07/11' });
  });
  test('até 120 dias: por semana, cobrindo o período inteiro sem sobrepor', () => {
    const { granularidade, buckets } = svc.gerarBuckets('2026-08-16', '2026-11-13');
    expect(granularidade).toBe('semana');
    expect(buckets[0].inicio).toBe('2026-08-16');
    expect(buckets[buckets.length - 1].fim).toBe('2026-11-13');
    buckets.slice(1).forEach((b, i) => {
      expect(new Date(b.inicio) - new Date(buckets[i].fim)).toBe(86400000);
    });
  });
  test('acima disso: por mês, com rótulo "Mês Ano" e pontas recortadas no período', () => {
    const { granularidade, buckets } = svc.gerarBuckets('2026-07-10', '2026-11-13');
    expect(granularidade).toBe('mes');
    expect(buckets.map(b => b.label)).toEqual(['Jul 2026', 'Ago 2026', 'Set 2026', 'Out 2026', 'Nov 2026']);
    expect(buckets[0].inicio).toBe('2026-07-10');
    expect(buckets[0].fim).toBe('2026-07-31');
    expect(buckets[4].fim).toBe('2026-11-13');
  });
});

describe('calcular', () => {
  const dados = {
    cadastros: [
      { d: '2026-10-01', type: 'dev', n: 100 }, { d: '2026-10-01', type: 'empresa', n: 10 },
      { d: '2026-11-08', type: 'dev', n: 20 }, { d: '2026-11-10', type: 'dev', n: 10 },
      { d: '2026-11-10', type: 'empresa', n: 2 },
    ],
    primeiroPro: [{ d: '2026-10-05', type: 'dev', n: 10 }, { d: '2026-11-09', type: 'dev', n: 5 }, { d: '2026-11-11', type: 'empresa', n: 1 }],
    atual: { dev: { ativos: 125, pro: 14 }, empresa: { ativos: 12, pro: 1 } },
  };
  const r = svc.calcular(dados, { from: '2026-11-07', to: HOJE }, HOJE);

  test('cadastros são acumulados dentro do período (não contam o que veio antes)', () => {
    expect(r.cadastros[0]).toMatchObject({ label: '07/11', devs: 0, empresas: 0 });
    expect(r.cadastros.find(c => c.label === '08/11').devs).toBe(20);
    expect(r.cadastros[r.cadastros.length - 1]).toMatchObject({ devs: 30, empresas: 2 });
  });
  test('KPIs: totais, FREE/PRO, variação da base e proporção', () => {
    // base de devs foi de 100 (antes do período) para 130 → +30%; empresas de 10 para 12 → +20%
    expect(r.kpis.devs).toMatchObject({ total: 125, pro: 14, free: 111, variacao_pct: 30 });
    expect(r.kpis.empresas).toMatchObject({ total: 12, pro: 1, free: 11, variacao_pct: 20 });
    expect(r.kpis.proporcao).toEqual({ devs: 125, empresas: 12, razao: 10 });
  });
  test('conversão = PRO ÷ contas ativas, com variação em p.p. sobre o início', () => {
    expect(r.kpis.conversao.taxa).toBe(10.9);          // 15 PRO / 137 contas ativas
    expect(r.kpis.conversao.variacao_pp).toBe(1.8);    // antes do período: 10 PRO / 110 contas = 9,1%
  });
  test('evolução FREE × PRO: pontos antigos pelo 1º plano pago; hoje usa o número real', () => {
    const p09 = r.planos.find(p => p.label === '09/11');
    expect(p09).toMatchObject({ devs_pro: 15, devs_free: 105 }); // 120 devs até 09/11, 15 já com plano pago
    const hoje = r.planos[r.planos.length - 1];
    expect(hoje).toMatchObject({ devs_pro: 14, devs_free: 116, empresas_pro: 1, empresas_free: 11 });
  });
  test('sem empresas: proporção nula e sem divisão por zero', () => {
    const vazio = svc.calcular({ cadastros: [], primeiroPro: [], atual: { dev: { ativos: 0, pro: 0 }, empresa: { ativos: 0, pro: 0 } } },
      { from: '2026-11-07', to: HOJE }, HOJE);
    expect(vazio.kpis.proporcao.razao).toBeNull();
    expect(vazio.kpis.conversao).toEqual({ taxa: 0, variacao_pp: null });
    expect(vazio.kpis.devs.variacao_pct).toBeNull();
  });
});

describe('paraExport', () => {
  const r = svc.calcular({
    cadastros: [{ d: '2026-11-10', type: 'dev', n: 3 }], primeiroPro: [],
    atual: { dev: { ativos: 3, pro: 0 }, empresa: { ativos: 0, pro: 0 } },
  }, { from: '2026-11-07', to: HOJE }, HOJE);
  const rel = svc.paraExport(r);

  test('três seções com título, período e colunas do relatório', () => {
    expect(rel.titulo).toBe('Crescimento de usuários');
    expect(rel.periodo).toBe('07/11/2026 a 13/11/2026');
    expect(rel.secoes.map(s => s.titulo)).toEqual(['Indicadores', 'Novos cadastros no período', 'Evolução FREE x PRO']);
    expect(rel.secoes[2].colunas).toEqual(['Ponto', 'Devs PRO', 'Devs FREE', 'Empresas PRO', 'Empresas FREE']);
    expect(rel.secoes[1].linhas).toHaveLength(7);
  });
  test('nome do arquivo traz o período e a extensão', () => {
    expect(svc.nomeArquivo(r, 'pdf')).toBe('relatorio-crescimento-de-usuarios_2026-11-07_a_2026-11-13.pdf');
  });
});

describe('API /api/admin/reports/crescimento-de-usuarios', () => {
  const app = express();
  app.get('/r', adminController.getRelatorioCrescimento);
  app.get('/r.:formato', adminController.exportRelatorio(svc));

  beforeEach(() => {
    db.query = jest.fn()
      .mockResolvedValueOnce([[{ d: '2026-11-01', type: 'dev', n: 5 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ type: 'dev', n: 5 }, { type: 'empresa', n: 1 }]])
      .mockResolvedValueOnce([[{ type: 'dev', n: 1 }]]);
  });

  test('devolve período, indicadores e as duas séries', async () => {
    const r = await request(app).get('/r?periodo=7');
    expect(r.status).toBe(200);
    expect(r.body.kpis.devs).toMatchObject({ total: 5, pro: 1, free: 4 });
    expect(r.body.cadastros).toHaveLength(7);
    expect(r.body.planos).toHaveLength(7);
  });
  test('período inválido → 400 sem consultar o banco', async () => {
    db.query = jest.fn();
    const r = await request(app).get('/r?periodo=abc');
    expect(r.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });
  test.each([['pdf', 'application/pdf', '%PDF'], ['xlsx', 'spreadsheetml', 'PK']])(
    'exporta em %s como anexo com nome do período', async (ext, mime, magic) => {
      const r = await request(app).get(`/r.${ext}?periodo=7`).buffer(true).parse((res, cb) => {
        const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain(mime);
      expect(r.headers['content-disposition']).toMatch(new RegExp(`attachment; filename="relatorio-crescimento-de-usuarios_.*\.${ext}"`));
      expect(r.body.subarray(0, magic.length).toString('latin1')).toBe(magic);
    });
  test('formato desconhecido → 400', async () => {
    expect((await request(app).get('/r.docx?periodo=7')).status).toBe(400);
  });
});

describe('páginas', () => {
  const render = (view, locals) => ejs.renderFile(path.join(__dirname, '..', 'views', view),
    { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-relatorios', ...locals });
  const { porSlug } = require('../config/relatorios');

  test('página: um main, um h1, indicadores, gráficos com legenda e tabela, gerador', async () => {
    const html = await render('admin-relatorio-crescimento.ejs', { categoria: porSlug('crescimento-de-usuarios') });
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    ['Total de desenvolvedores ativos', 'Total de empresas ativas', 'Taxa de conversão de FREE para PRO', 'Proporção Dev/Empresa',
      'Aquisição e evolução', 'Crescimento de novos cadastros', 'Evolução FREE vs PRO', 'Gerar relatório']
      .forEach(t => expect(html).toContain(t));
    expect(html.match(/class="adc-tbl-btn"/g)).toHaveLength(2);
    ['7 dias', '30 dias', '90 dias', 'Personalizado'].forEach(t => expect(html).toContain(t));
    expect(html).toContain('PDF');
    expect(html).toContain('value="xlsx"');
    expect(html).toMatch(/href="\/admin\/relatorios"\s+class="header-link is-active"/);
  });
  test('os dados entram no DOM sem innerHTML cru (escapeHtml nas tabelas)', async () => {
    const html = await render('admin-relatorio-crescimento.ejs', { categoria: porSlug('crescimento-de-usuarios') });
    expect(html).toContain('escapeHtml(h)');
    expect(html.slice(html.indexOf('<main'))).not.toMatch(/\son(click|change)=/);
  });
  test('rota do índice usa a view dedicada', () => {
    expect(porSlug('crescimento-de-usuarios').view).toBe('admin-relatorio-crescimento');
  });
});
