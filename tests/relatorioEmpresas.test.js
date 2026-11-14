// Relatório "Atividade das empresas": cálculo, API, exportação e página.
const path = require('path');
const ejs = require('ejs');
const request = require('supertest');
const express = require('express');

jest.mock('../database/db', () => ({ query: jest.fn(), getConnection: jest.fn(), ready: Promise.resolve() }));
const db = require('../database/db');
const adminController = require('../controllers/adminController');
const svc = require('../services/relatorioEmpresas');
const { exportar } = require('../services/relatorioExport');

const PERIODO = { from: '2026-11-01', to: '2026-11-13' }; // anterior: 19/10 a 31/10

const dados = {
  empresas: [
    { id: 1, active: true,  created: '2026-01-10', nome_fantasia: 'Azyra', razao_social: 'Azyra LTDA', cnpj: '75512359000147' },
    { id: 2, active: true,  created: '2026-10-25', nome_fantasia: null, razao_social: 'Fuse SA', cnpj: null },
    { id: 3, active: false, created: '2026-11-05', nome_fantasia: 'Lumin', razao_social: 'Lumin', cnpj: null },
    { id: 4, active: true,  created: '2026-11-07', nome_fantasia: 'Cube', razao_social: 'Cube', cnpj: null },
  ],
  proIds: [1, 3],
  jobs: [
    { id: 1, company_id: 1, modality: 'presencial', created: '2026-11-02' },
    { id: 2, company_id: 1, modality: 'hibrido',    created: '2026-11-08' },
    { id: 3, company_id: 2, modality: 'remoto',     created: '2026-11-10' },
    { id: 4, company_id: 2, modality: 'presencial', created: '2026-10-25' }, // período anterior
    { id: 5, company_id: 4, modality: 'hibrido',    created: '2026-10-20' }, // período anterior
  ],
  candidaturas: [
    { job_id: 1, d: '2026-11-03', n: 10 }, { job_id: 2, d: '2026-11-09', n: 4 }, { job_id: 3, d: '2026-11-11', n: 2 },
    { job_id: 4, d: '2026-10-30', n: 6 },
    { job_id: 99, d: '2026-11-05', n: 50 }, // vaga inexistente: ignorada
  ],
  matchs: [
    { company_id: 1, d: '2026-11-04', n: 3 }, { company_id: 2, d: '2026-11-12', n: 1 },
    { company_id: 1, d: '2026-10-27', n: 2 },
  ],
};

describe('calcular', () => {
  const r = svc.calcular(dados, PERIODO);

  test('empresas ativas (conta não suspensa), FREE/PRO pelo plano e variação da base', () => {
    // ativas: 1, 2, 4 · PRO entre elas: só a 1 · base: 2 empresas no fim do período anterior → 4
    expect(r.kpis.empresas).toEqual({ total: 3, pro: 1, free: 2, variacao_pct: 100 });
  });
  test('vagas publicadas no período, por modalidade, com variação', () => {
    expect(r.kpis.vagas).toEqual({ total: 3, presenciais: 1, hibridas: 1, remotas: 1, variacao_pct: 50 }); // antes: 2
  });
  test('candidaturas ignoram vagas que não existem e comparam com o período anterior', () => {
    expect(r.kpis.candidaturas).toEqual({ total: 16, variacao_pct: 167 }); // 10+4+2 · antes: 6
  });
  test('conexões = matchs aceitos; média por empresa ativa', () => {
    expect(r.kpis.conexoes).toEqual({ media: 1.3, total: 4, variacao_pct: 100 }); // 4 / 3 ativas · antes: 2
  });
  test('gráfico: empresas com mais candidaturas no período', () => {
    expect(r.grafico).toEqual([
      { id: 1, nome: 'Azyra', candidaturas: 14, vagas: 2 },
      { id: 2, nome: 'Fuse SA', candidaturas: 2, vagas: 1 }, // sem nome fantasia: usa a razão social
    ]);
  });
  test('ranking: por vagas publicadas, depois matchs; só quem teve atividade', () => {
    expect(r.ranking).toEqual([
      { id: 1, nome: 'Azyra', cnpj: '75512359000147', plano: 'PRO', vagas: 2, matchs: 3, candidaturas: 14 },
      { id: 2, nome: 'Fuse SA', cnpj: null, plano: 'FREE', vagas: 1, matchs: 1, candidaturas: 2 },
    ]);
  });
  test('sem dados: zeros e nulos, sem divisão por zero', () => {
    const v = svc.calcular({ empresas: [], proIds: [], jobs: [], candidaturas: [], matchs: [] }, PERIODO);
    expect(v.kpis.empresas).toEqual({ total: 0, pro: 0, free: 0, variacao_pct: null });
    expect(v.kpis.vagas.total).toBe(0);
    expect(v.kpis.conexoes).toEqual({ media: 0, total: 0, variacao_pct: null });
    expect(v.grafico).toEqual([]);
    expect(v.ranking).toEqual([]);
  });
});

describe('paraExport e exportação (PDF/Excel)', () => {
  const rel = svc.paraExport(svc.calcular(dados, PERIODO));

  test('três seções e nome de arquivo com o período', () => {
    expect(rel.secoes.map(s => s.titulo)).toEqual(['Indicadores', 'Candidaturas por empresa', 'Empresas mais ativas']);
    expect(rel.secoes[2].linhas[0]).toEqual(['Azyra', '75.512.359/0001-47', 2, 3, 'PRO']);
    expect(svc.nomeArquivo(svc.calcular(dados, PERIODO), 'xlsx')).toBe('relatorio-atividade-das-empresas_2026-11-01_a_2026-11-13.xlsx');
  });
  test('PDF e Excel válidos', async () => {
    const pdf = await exportar(rel, 'pdf');
    expect(pdf.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const xlsx = await exportar(rel, 'xlsx');
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.buffer);
    expect(wb.worksheets.map(w => w.name)).toEqual(rel.secoes.map(s => s.titulo));
  });
});

describe('API /api/admin/reports/atividade-das-empresas', () => {
  const app = express();
  app.get('/r', adminController.getRelatorioEmpresas);
  app.get('/r.:formato', adminController.exportRelatorio(svc));

  const hoje = require('../services/relatorioCrescimento').hojeSP();
  beforeEach(() => {
    db.query = jest.fn()
      .mockResolvedValueOnce([[{ id: 1, active: 1, created: '2026-01-01', nome_fantasia: 'Azyra', razao_social: 'Azyra', cnpj: null }]])
      .mockResolvedValueOnce([[{ user_id: 1 }]])
      .mockResolvedValueOnce([[{ id: 1, company_id: 1, modality: 'remoto', created: hoje }]])
      .mockResolvedValueOnce([[{ job_id: 1, d: hoje, n: 3 }]])
      .mockResolvedValueOnce([[]]);
  });

  test('devolve indicadores, gráfico e ranking', async () => {
    const r = await request(app).get('/r?periodo=30');
    expect(r.status).toBe(200);
    expect(r.body.kpis.empresas).toMatchObject({ total: 1, pro: 1, free: 0 });
    expect(r.body.kpis.candidaturas.total).toBe(3);
    expect(r.body.grafico[0]).toMatchObject({ nome: 'Azyra', candidaturas: 3 });
    expect(r.body.ranking[0]).toMatchObject({ plano: 'PRO', vagas: 1 });
  });
  test('período inválido → 400 sem consultar o banco', async () => {
    db.query = jest.fn();
    expect((await request(app).get('/r?periodo=abc')).status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });
  test('exporta Excel pela rota', async () => {
    const r = await request(app).get('/r.xlsx?periodo=30').buffer(true).parse((res, cb) => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/relatorio-atividade-das-empresas_.*\.xlsx/);
    expect(r.body.subarray(0, 2).toString('latin1')).toBe('PK');
  });
});

describe('página admin-relatorio-empresas.ejs', () => {
  const { porSlug } = require('../config/relatorios');
  let html;
  beforeAll(async () => {
    html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin-relatorio-empresas.ejs'),
      { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-relatorios', categoria: porSlug('atividade-das-empresas') });
  });
  test('um main, um h1 e as seções do protótipo', () => {
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    ['Total de empresas ativas', 'Vagas publicadas', 'Candidaturas enviadas', 'Média de conexões por empresa',
      'Dinâmica e engajamento', 'Comparativo de candidaturas por empresa', 'Ranking de empresas', 'Empresas mais ativas', 'Gerar relatório']
      .forEach(t => expect(html).toContain(t));
  });
  test('tabela com th scope, formatos PDF/Excel e dados escapados', () => {
    ['Empresa', 'Vagas', 'Matchs', 'Plano', 'Ações'].forEach(c => expect(html).toContain(`>${c}</th>`));
    expect(html).toContain('value="pdf"');
    expect(html).toContain('value="xlsx"');
    expect(html).toContain('escapeHtml(e.nome)');
    expect(html.slice(html.indexOf('<main'))).not.toMatch(/\son(click|change)=/);
  });
  test('o olho do ranking leva ao perfil da empresa no admin', () => {
    expect(html).toContain('href="/admin/empresas/${Number(e.id)}"');
  });
});
