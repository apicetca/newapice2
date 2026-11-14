// Relatório "Desempenho das vagas": cálculo, API, exportação (PDF/Excel) e página.
const path = require('path');
const ejs = require('ejs');
const request = require('supertest');
const express = require('express');

jest.mock('../database/db', () => ({ query: jest.fn(), getConnection: jest.fn(), ready: Promise.resolve() }));
const db = require('../database/db');
const adminController = require('../controllers/adminController');
const svc = require('../services/relatorioDesempenho');
const { exportar } = require('../services/relatorioExport');

const PERIODO = { from: '2026-11-01', to: '2026-11-13' }; // 13 dias; período anterior: 19/10 a 31/10

const dados = {
  jobs: [
    { id: 1, title: 'Vaga A', company: 'X', level: 'estagio', area: 'front-end', active: true,  created: '2026-10-10', closed: null },
    { id: 2, title: 'Vaga B', company: 'X', level: 'junior',  area: 'back-end',  active: true,  created: '2026-11-05', closed: null },
    { id: 3, title: 'Vaga C', company: 'Y', level: 'pleno',   area: 'dados',     active: true,  created: '2026-11-06', closed: null },
    { id: 4, title: 'Vaga D', company: 'Y', level: 'estagio', area: null,        active: false, created: '2026-10-01', closed: '2026-11-10' },
  ],
  candidaturas: [
    { job_id: 1, d: '2026-11-02', n: 10 }, { job_id: 2, d: '2026-11-08', n: 4 },
    { job_id: 3, d: '2026-10-25', n: 5 },  { job_id: 1, d: '2026-10-30', n: 5 },
  ],
  matchs: [
    { job_id: 1, d: '2026-11-03', n: 3 }, { job_id: 2, d: '2026-11-09', n: 1 }, { job_id: 1, d: '2026-10-28', n: 2 },
  ],
};

describe('calcular', () => {
  const r = svc.calcular(dados, PERIODO);

  test('vagas ativas, preenchidas/abertas e variação da base de vagas', () => {
    // preenchida = ativa com ao menos um match aceito (vagas 1 e 2); base foi de 2 para 4 vagas → +100%
    expect(r.kpis.vagas_ativas).toEqual({ total: 3, preenchidas: 2, abertas: 1, variacao_pct: 100 });
  });
  test('média de candidatos por vaga ativa e variação sobre o período anterior', () => {
    expect(r.kpis.candidatos_por_vaga).toEqual({ media: 4.7, total: 14, variacao_pct: 40 }); // 14 / 3 · antes: 10
  });
  test('taxa de match = aceitos ÷ candidaturas, com variação em p.p.', () => {
    expect(r.kpis.taxa_match).toEqual({ taxa: 28.6, variacao_pp: 8.6 }); // 4/14 · antes 2/10
  });
  test('tempo médio de fechamento só conta vagas pausadas dentro do período', () => {
    expect(r.kpis.tempo_fechamento).toEqual({ dias: 40, amostra: 1 });
  });
  test('stacks: vagas ativas (hoje) e candidaturas (período) por área, incluindo "não informada"', () => {
    expect(r.stacks).toEqual([
      { area: 'front-end', label: 'Front-end', vagas: 1, candidaturas: 10 },
      { area: 'back-end', label: 'Back-end', vagas: 1, candidaturas: 4 },
      { area: 'full-stack', label: 'Full-stack', vagas: 0, candidaturas: 0 },
      { area: 'dados', label: 'Dados', vagas: 1, candidaturas: 0 },
      { area: 'nao-informada', label: 'Não informada', vagas: 0, candidaturas: 0 },
    ]);
  });
  test('taxa de preenchimento por nível', () => {
    expect(r.preenchimento).toEqual([
      { level: 'estagio', label: 'Estágio', total: 1, preenchidas: 1, taxa: 100 },
      { level: 'junior', label: 'Júnior', total: 1, preenchidas: 1, taxa: 100 },
      { level: 'pleno', label: 'Pleno', total: 1, preenchidas: 0, taxa: 0 },
    ]);
  });
  test('ranking ordena por candidatos e ignora vagas sem atividade no período', () => {
    expect(r.ranking).toEqual([
      { id: 1, title: 'Vaga A', company: 'X', candidatos: 10, matchs: 3 },
      { id: 2, title: 'Vaga B', company: 'X', candidatos: 4, matchs: 1 },
    ]);
  });
  test('sem dados: zeros e nulos, sem divisão por zero', () => {
    const v = svc.calcular({ jobs: [], candidaturas: [], matchs: [] }, PERIODO);
    expect(v.kpis.vagas_ativas).toEqual({ total: 0, preenchidas: 0, abertas: 0, variacao_pct: null });
    expect(v.kpis.candidatos_por_vaga.media).toBe(0);
    expect(v.kpis.taxa_match).toEqual({ taxa: null, variacao_pp: null });
    expect(v.kpis.tempo_fechamento).toEqual({ dias: null, amostra: 0 });
    expect(v.preenchimento.every(p => p.taxa === null)).toBe(true);
    expect(v.ranking).toEqual([]);
  });
  test('taxa de match nunca passa de 100%', () => {
    const x = svc.calcular({ ...dados, matchs: [{ job_id: 1, d: '2026-11-03', n: 99 }] }, PERIODO);
    expect(x.kpis.taxa_match.taxa).toBe(100);
  });
});

describe('paraExport', () => {
  const rel = svc.paraExport(svc.calcular(dados, PERIODO));
  test('quatro seções, período e nome do arquivo', () => {
    expect(rel.secoes.map(s => s.titulo)).toEqual([
      'Indicadores', 'Vagas e candidaturas por stack', 'Taxa de preenchimento por nível', 'Vagas com maior engajamento',
    ]);
    expect(rel.periodo).toBe('01/11/2026 a 13/11/2026');
    expect(svc.nomeArquivo(svc.calcular(dados, PERIODO), 'xlsx')).toBe('relatorio-desempenho-das-vagas_2026-11-01_a_2026-11-13.xlsx');
  });
});

describe('exportação (pdfkit / exceljs)', () => {
  const rel = svc.paraExport(svc.calcular(dados, PERIODO));

  test('PDF válido (cabeçalho %PDF) com conteúdo', async () => {
    const { buffer, mime, ext } = await exportar(rel, 'pdf');
    expect(mime).toBe('application/pdf');
    expect(ext).toBe('pdf');
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1500);
  });
  test('Excel válido: uma aba por seção, números como número', async () => {
    const { buffer, ext } = await exportar(rel, 'xlsx');
    expect(ext).toBe('xlsx');
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    expect(wb.worksheets.map(w => w.name)).toEqual(rel.secoes.map(s => s.titulo));
    const ranking = wb.getWorksheet('Vagas com maior engajamento');
    expect(ranking.getRow(4).values.slice(1)).toEqual(['Vaga', 'Empresa', 'Candidatos', 'Matchs']);
    expect(ranking.getRow(5).values.slice(1)).toEqual(['Vaga A', 'X', 10, 3]);
  });
  test('PDF com muitas linhas quebra de página sem erro', async () => {
    const grande = { ...rel, secoes: [{ titulo: 'Muitas', colunas: ['A', 'B'], linhas: Array.from({ length: 120 }, (_, i) => [`linha ${i}`, i]) }] };
    const { buffer } = await exportar(grande, 'pdf');
    expect((buffer.toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(1);
  });
  test('formato inválido → erro 400', async () => {
    await expect(exportar(rel, 'docx')).rejects.toMatchObject({ status: 400 });
  });
});

describe('API /api/admin/reports/desempenho-das-vagas', () => {
  const app = express();
  app.get('/r', adminController.getRelatorioDesempenho);
  app.get('/r.:formato', adminController.exportRelatorio(svc));

  beforeEach(() => {
    db.query = jest.fn()
      .mockResolvedValueOnce([[{ id: 1, title: 'A', company: 'X', level: 'estagio', area: 'front-end', active: 1, created: '2026-10-10', closed: null }]])
      .mockResolvedValueOnce([[{ job_id: 1, d: require('../services/relatorioCrescimento').hojeSP(), n: 2 }]])
      .mockResolvedValueOnce([[]]);
  });

  test('devolve indicadores, stacks, preenchimento e ranking', async () => {
    const r = await request(app).get('/r?periodo=30');
    expect(r.status).toBe(200);
    expect(r.body.kpis.vagas_ativas.total).toBe(1);
    expect(r.body.stacks).toHaveLength(4);
    expect(r.body.preenchimento).toHaveLength(3);
  });
  test('período inválido → 400', async () => {
    db.query = jest.fn();
    expect((await request(app).get('/r?periodo=abc')).status).toBe(400);
  });
  test('PDF direto pela rota', async () => {
    const r = await request(app).get('/r.pdf?periodo=30').buffer(true).parse((res, cb) => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/relatorio-desempenho-das-vagas_.*\.pdf/);
    expect(r.body.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});

describe('página admin-relatorio-desempenho.ejs', () => {
  const { porSlug } = require('../config/relatorios');
  let html;
  beforeAll(async () => {
    html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin-relatorio-desempenho.ejs'),
      { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-relatorios', categoria: porSlug('desempenho-das-vagas') });
  });
  test('um main, um h1 e as seções do protótipo', () => {
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    ['Total de vagas ativas', 'Média de candidatos por vaga', 'Taxa de match por vaga', 'Tempo médio de fechamento',
      'Volume e conversão por stacks', 'Vagas vs Candidaturas por Stack', 'Taxa de preenchimento por nível',
      'Ranking de vagas', 'Vagas com maior engajamento', 'Gerar relatório'].forEach(t => expect(html).toContain(t));
  });
  test('tabela do ranking com th scope; formatos PDF e Excel; dados escapados', () => {
    ['Título', 'Empresa', 'Candidatos', 'Matchs', 'Ações'].forEach(c => expect(html).toContain(`>${c}</th>`));
    expect(html).toContain('value="pdf"');
    expect(html).toContain('value="xlsx"');
    expect(html).toContain('escapeHtml(v.title)');
    expect(html.slice(html.indexOf('<main'))).not.toMatch(/\son(click|change)=/);
  });
  test('cada vaga do ranking leva ao detalhe no admin', () => {
    expect(html).toContain('href="/admin/vagas/${Number(v.id)}"');
  });
});
