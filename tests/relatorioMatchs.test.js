// Relatório "Compatibilidade de matchs": cálculo, API, exportação e página.
const path = require('path');
const ejs = require('ejs');
const request = require('supertest');
const express = require('express');

jest.mock('../database/db', () => ({ query: jest.fn(), getConnection: jest.fn(), ready: Promise.resolve() }));
const db = require('../database/db');
const adminController = require('../controllers/adminController');
const svc = require('../services/relatorioMatchs');
const { exportar } = require('../services/relatorioExport');

const PERIODO = { from: '2026-11-01', to: '2026-11-13' }; // anterior: 19/10 a 31/10

const dados = {
  jobs: [
    { id: 1, title: 'Vaga A', company: 'X', level: 'estagio' },
    { id: 2, title: 'Vaga B', company: 'Y', level: 'junior' },
    { id: 3, title: 'Vaga C', company: 'Y', level: 'pleno' }, // sem skills cadastradas: não entra nas médias
  ],
  jobSkills: [
    { job_id: 1, skill_id: 1, importance: 'obrigatoria', type: 'hard' },
    { job_id: 1, skill_id: 2, importance: 'desejavel', type: 'soft' },
    { job_id: 2, skill_id: 1, importance: 'obrigatoria', type: 'hard' },
  ],
  devs: [
    { chave: 100, user_id: 11, nome: 'Igor', sobrenome: 'Gomes', github_login: 'igor', avatar_url: null, nivel: 'iniciante' },
    { chave: 200, user_id: 12, nome: 'Lucas', sobrenome: '', github_login: 'lucas', avatar_url: null, nivel: 'avancado' },
  ],
  skills: [
    { github_id: 100, skill_id: 1, confidence: 80 }, { github_id: 100, skill_id: 2, confidence: 40 },
    { github_id: 200, skill_id: 1, confidence: 100 },
  ],
  progresso: [{ github_id: 100, job_id: 1, status: 'concluido' }, { github_id: 100, job_id: 1, status: 'em_progresso' }],
  candidaturas: [{ job_id: 1, dev: 100, d: '2026-10-30' }, { job_id: 2, dev: 200, d: '2026-11-08' }],
  actions: [
    { job_id: 1, dev: 100, action: 'aceito',   d: '2026-11-02' },
    { job_id: 2, dev: 200, action: 'aceito',   d: '2026-11-10' },
    { job_id: 1, dev: 200, action: 'recusado', d: '2026-11-05' },
    { job_id: 3, dev: 100, action: 'aceito',   d: '2026-11-06' },
    // período anterior
    { job_id: 1, dev: 100, action: 'recusado', d: '2026-10-25' },
    { job_id: 2, dev: 200, action: 'aceito',   d: '2026-10-28' },
  ],
};

describe('calcular', () => {
  const r = svc.calcular(dados, PERIODO);

  test('total, aceitos/recusados e variação sobre o período anterior', () => {
    expect(r.kpis.total).toEqual({ total: 4, aceitos: 3, recusados: 1, variacao_pct: 100 }); // antes: 2 decisões
  });
  test('taxa de aceitação com variação em p.p.', () => {
    expect(r.kpis.aceitacao).toEqual({ taxa: 75, variacao_pp: 25 }); // 3/4 · antes 1/2
  });
  test('compatibilidade média dos pares com skills cadastradas (72, 100, 72)', () => {
    expect(r.kpis.compatibilidade).toEqual({ media: 81.3, variacao_pp: -4.7 }); // antes: (72 + 100) / 2 = 86
  });
  test('tempo para aceitar: da candidatura ao aceite, ignorando quem não se candidatou', () => {
    // a1: 30/10 → 02/11 = 3 dias; a2: 08/11 → 10/11 = 2 dias; a4 não tem candidatura
    expect(r.kpis.tempo_aceite).toEqual({ dias: 2.5, variacao_dias: null });
  });
  test('perfil dev × requisitos por categoria', () => {
    const por = Object.fromEntries(r.categorias.map(c => [c.chave, c]));
    expect(por.skills).toMatchObject({ perfil: 93.3, requisito: 100, amostra: 3 });
    expect(por.senioridade).toMatchObject({ perfil: 77.7, requisito: 44.3, amostra: 3 });
    expect(por.roadmap).toMatchObject({ perfil: 16.7, requisito: 100, amostra: 3 });
    expect(por.soft).toMatchObject({ perfil: 20, requisito: 100, amostra: 2 }); // a vaga B não tem soft skills
  });
  test('taxa de aceitação por nível da vaga', () => {
    expect(r.por_nivel).toEqual([
      { level: 'estagio', label: 'Estágio', total: 2, aceitos: 1, taxa: 50 },
      { level: 'junior', label: 'Júnior', total: 1, aceitos: 1, taxa: 100 },
      { level: 'pleno', label: 'Pleno', total: 1, aceitos: 1, taxa: 100 },
    ]);
  });
  test('ranking: aceitos por compatibilidade, com o id do dev para o perfil no admin', () => {
    expect(r.ranking.map(m => [m.nome, m.score, m.dev_user_id, m.job_title, m.company])).toEqual([
      ['Lucas', 100, 12, 'Vaga B', 'Y'],
      ['Igor Gomes', 72, 11, 'Vaga A', 'X'],
    ]);
  });
  test('sem decisões: tudo nulo/zero, sem divisão por zero', () => {
    const v = svc.calcular({ ...dados, actions: [] }, PERIODO);
    expect(v.kpis.total).toEqual({ total: 0, aceitos: 0, recusados: 0, variacao_pct: null });
    expect(v.kpis.aceitacao).toEqual({ taxa: null, variacao_pp: null });
    expect(v.kpis.compatibilidade.media).toBeNull();
    expect(v.categorias.every(c => c.perfil === null && c.amostra === 0)).toBe(true);
    expect(v.ranking).toEqual([]);
  });
});

describe('paraExport e exportação (PDF/Excel)', () => {
  const rel = svc.paraExport(svc.calcular(dados, PERIODO));

  test('quatro seções e nome de arquivo com o período', () => {
    expect(rel.secoes.map(s => s.titulo)).toEqual([
      'Indicadores', 'Perfil do dev vs requisitos da vaga', 'Matchs aceitos por nível de senioridade', 'Top matchs do período',
    ]);
    expect(svc.nomeArquivo(svc.calcular(dados, PERIODO), 'pdf')).toBe('relatorio-compatibilidade-de-matchs_2026-11-01_a_2026-11-13.pdf');
  });
  test('PDF e Excel válidos', async () => {
    const pdf = await exportar(rel, 'pdf');
    expect(pdf.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const xlsx = await exportar(rel, 'xlsx');
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.buffer);
    expect(wb.worksheets).toHaveLength(4);
  });
});

describe('carregarDados', () => {
  test('sem decisões no período, só uma consulta é feita', async () => {
    db.query = jest.fn().mockResolvedValueOnce([[]]);
    const d = await svc.carregarDados(db, PERIODO);
    expect(d.actions).toEqual([]);
    expect(db.query).toHaveBeenCalledTimes(1);
    // inclui o período anterior para a comparação
    expect(db.query.mock.calls[0][1]).toEqual(['2026-10-19', '2026-11-13']);
  });
});

describe('API /api/admin/reports/compatibilidade-de-matchs', () => {
  const app = express();
  app.get('/r', adminController.getRelatorioMatchs);
  app.get('/r.:formato', adminController.exportRelatorio(svc));

  const hoje = require('../services/relatorioCrescimento').hojeSP(); // mesmo fuso do relatório
  beforeEach(() => {
    db.query = jest.fn()
      .mockResolvedValueOnce([[{ job_id: 1, dev: 100, action: 'aceito', d: hoje }]])
      .mockResolvedValueOnce([[{ id: 1, title: 'A', company: 'X', level: 'estagio' }]])
      .mockResolvedValueOnce([[{ job_id: 1, skill_id: 1, importance: 'obrigatoria', type: 'hard' }]])
      .mockResolvedValueOnce([[{ user_id: 11, chave: 100, nome: 'Igor', sobrenome: '', github_login: 'igor', nivel: 'iniciante', avatar_url: null }]])
      .mockResolvedValueOnce([[{ github_id: 100, skill_id: 1, confidence: 90 }]])
      .mockResolvedValue([[]]);
  });

  test('devolve indicadores, categorias, níveis e ranking', async () => {
    const r = await request(app).get('/r?periodo=30');
    expect(r.status).toBe(200);
    expect(r.body.kpis.total.total).toBe(1);
    expect(r.body.categorias).toHaveLength(4);
    expect(r.body.por_nivel).toHaveLength(3);
    expect(r.body.ranking[0]).toMatchObject({ nome: 'Igor', job_title: 'A' });
  });
  test('período inválido → 400 sem consultar o banco', async () => {
    db.query = jest.fn();
    expect((await request(app).get('/r?periodo=abc')).status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });
  test('exporta PDF pela rota', async () => {
    const r = await request(app).get('/r.pdf?periodo=30').buffer(true).parse((res, cb) => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/relatorio-compatibilidade-de-matchs_.*\.pdf/);
  });
});

describe('página admin-relatorio-matchs.ejs', () => {
  const { porSlug } = require('../config/relatorios');
  let html;
  beforeAll(async () => {
    html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin-relatorio-matchs.ejs'),
      { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-relatorios', categoria: porSlug('compatibilidade-de-matchs') });
  });
  test('um main, um h1 e as seções do protótipo', () => {
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    ['Total de matchs realizados', 'Taxa geral de aceitação', 'Compatibilidade média', 'Tempo médio para match aceito',
      'Análise de compatibilidade', 'Perfil dev vs Requisitos da vaga', 'Matchs aceitos por nível de senioridade',
      'Ranking de matchs', 'Top matchs recentes', 'Gerar relatório'].forEach(t => expect(html).toContain(t));
  });
  test('tabela com th scope, formatos PDF/Excel e dados escapados', () => {
    ['Dev', 'Empresa', 'Vaga', 'Compatibilidade', 'Ações'].forEach(c => expect(html).toContain(`>${c}</th>`));
    expect(html).toContain('value="pdf"');
    expect(html).toContain('value="xlsx"');
    expect(html).toContain('escapeHtml(m.job_title)');
    expect(html.slice(html.indexOf('<main'))).not.toMatch(/\son(click|change)=/);
  });
  test('eye do ranking leva ao perfil do dev e a vaga ao detalhe da vaga', () => {
    expect(html).toContain('href="/admin/usuarios/${Number(m.dev_user_id)}"');
    expect(html).toContain('href="/admin/vagas/${Number(m.job_id)}"');
  });
});
