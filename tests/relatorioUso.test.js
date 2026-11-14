// Relatório "Uso da plataforma": cálculo, coleta de eventos, API, exportação e página.
const path = require('path');
const ejs = require('ejs');
const request = require('supertest');
const express = require('express');

jest.mock('../database/db', () => ({ query: jest.fn(), getConnection: jest.fn(), ready: Promise.resolve() }));
const db = require('../database/db');
const adminController = require('../controllers/adminController');
const svc = require('../services/relatorioUso');
const { exportar } = require('../services/relatorioExport');
const tracker = require('../middlewares/usageTracker');

const PERIODO = { from: '2026-11-01', to: '2026-11-13' }; // anterior: 19/10 a 31/10

const base = {
  sessoes: [
    { session_key: 'a', user_id: 1,  user_type: 'dev',     inicio: '2026-11-02T13:00:00Z', fim: '2026-11-02T13:20:00Z' }, // SP 10h · 25 min
    { session_key: 'b', user_id: 2,  user_type: 'dev',     inicio: '2026-11-02T22:10:00Z', fim: '2026-11-02T22:10:00Z' }, // SP 19h · 5 min
    { session_key: 'c', user_id: 10, user_type: 'empresa', inicio: '2026-11-03T02:30:00Z', fim: '2026-11-03T02:30:00Z' }, // SP 02/11 23h
    { session_key: 'd', user_id: 1,  user_type: 'dev',     inicio: '2026-11-05T12:00:00Z', fim: '2026-11-05T12:10:00Z' }, // SP 09h · 15 min
    { session_key: 'e', user_id: 1,  user_type: 'dev',     inicio: '2026-10-25T15:00:00Z', fim: '2026-10-25T15:00:00Z' }, // período anterior
    { session_key: 'f', user_id: 3,  user_type: 'dev',     inicio: '2026-10-26T15:00:00Z', fim: '2026-10-26T15:00:00Z' }, // período anterior
    { session_key: 'g', user_id: 4,  user_type: 'dev',     inicio: '2026-09-01T12:00:00Z', fim: '2026-09-01T12:00:00Z' }, // fora de qualquer período
  ],
  modulos: [{ module: 'vagas', usuarios: 2 }, { module: 'roadmap', usuarios: 1 }, { module: 'mentor', usuarios: 3 }],
  mentor: { atual: 3, anterior: 2 },
  devsAtivos: 10,
  retencao: { atual: { coorte: 8, retidos: 6 }, anterior: { coorte: 10, retidos: 5 } },
  coletaDesde: '2026-10-20',
};

describe('calcular', () => {
  const r = svc.calcular(base, PERIODO);

  test('sessões diárias (por dia de São Paulo), usuários únicos por dia e variação', () => {
    // 4 sessões em 13 dias; a da empresa começa 02:30 UTC = 23:30 de 02/11 em SP · antes: 2 sessões
    expect(r.kpis.sessoes_diarias).toEqual({ media: 0.3, total: 4, usuarios_dia: 2, variacao_pct: 100 }); // dias: {1,2,10} e {1}
  });
  test('tempo por sessão = último − primeiro evento + 5 min', () => {
    // (1500 + 300 + 300 + 900) / 4 = 750 s · antes: 300 s
    expect(r.kpis.tempo_sessao).toEqual({ segundos: 750, variacao_pct: 150 });
  });
  test('utilização do mentor sobre os devs ativos, em p.p.', () => {
    expect(r.kpis.mentor).toEqual({ taxa: 30, usuarios: 3, devs_ativos: 10, variacao_pp: 10 });
  });
  test('retenção de 30 dias da coorte, em p.p.', () => {
    expect(r.kpis.retencao).toEqual({ taxa: 75, coorte: 8, retidos: 6, variacao_pp: 25 });
  });
  test('horários de pico em faixas de 2h no fuso de São Paulo', () => {
    expect(r.horarios).toHaveLength(12);
    expect(r.horarios[4]).toEqual({ label: '8h', devs: 1, empresas: 0 });   // 09h
    expect(r.horarios[5]).toEqual({ label: '10h', devs: 1, empresas: 0 });  // 10h
    expect(r.horarios[9]).toEqual({ label: '18h', devs: 1, empresas: 0 });  // 19h
    expect(r.horarios[11]).toEqual({ label: '22h', devs: 0, empresas: 1 }); // 23h
  });
  test('módulos como % dos usuários ativos (3), do mais para o menos usado', () => {
    expect(r.usuarios_ativos).toBe(3);
    expect(r.modulos.map(m => [m.chave, m.usuarios, m.taxa])).toEqual([
      ['mentor', 3, 100], ['vagas', 2, 67], ['roadmap', 1, 33], ['chat', 0, 0],
    ]);
  });
  test('aviso de coleta parcial só quando a coleta começou depois do início do período', () => {
    expect(r.coleta).toEqual({ desde: '2026-10-20', parcial: false });
    expect(svc.calcular({ ...base, coletaDesde: '2026-11-05' }, PERIODO).coleta.parcial).toBe(true);
    expect(svc.calcular({ ...base, coletaDesde: null }, PERIODO).coleta).toEqual({ desde: null, parcial: true });
  });
  test('sem dados: nulos e zeros, sem divisão por zero', () => {
    const v = svc.calcular({ sessoes: [], modulos: [], mentor: { atual: 0, anterior: 0 }, devsAtivos: 0,
      retencao: { atual: { coorte: 0, retidos: 0 }, anterior: { coorte: 0, retidos: 0 } }, coletaDesde: null }, PERIODO);
    expect(v.kpis.sessoes_diarias).toEqual({ media: 0, total: 0, usuarios_dia: 0, variacao_pct: null });
    expect(v.kpis.tempo_sessao).toEqual({ segundos: null, variacao_pct: null });
    expect(v.kpis.mentor.taxa).toBeNull();
    expect(v.kpis.retencao.taxa).toBeNull();
    expect(v.modulos.every(m => m.taxa === null)).toBe(true);
  });
});

describe('duracaoTexto', () => {
  test('formata em minutos e segundos', () => {
    expect(svc.duracaoTexto(1110)).toBe('18min30s');
    expect(svc.duracaoTexto(300)).toBe('5min00s');
    expect(svc.duracaoTexto(null)).toBe('—');
  });
});

describe('carregarDados', () => {
  test('sem coleta registrada: janela em UTC (São Paulo −3h) e sem consultar a retenção', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce([[]])               // sessões
      .mockResolvedValueOnce([[]])               // módulos
      .mockResolvedValueOnce([[{ d: null }]])    // início da coleta
      .mockResolvedValueOnce([[{ n: 5 }]])       // devs ativos
      .mockResolvedValueOnce([[{ n: 2 }]])       // mentor atual
      .mockResolvedValueOnce([[{ n: 1 }]]);      // mentor anterior
    const d = await svc.carregarDados(db, PERIODO);
    expect(db.query.mock.calls[0][1]).toEqual(['2026-10-19 03:00:00', '2026-11-14 03:00:00']);
    expect(db.query).toHaveBeenCalledTimes(6);
    expect(d).toMatchObject({ coletaDesde: null, devsAtivos: 5, mentor: { atual: 2, anterior: 1 },
      retencao: { atual: { coorte: 0, retidos: 0 }, anterior: { coorte: 0, retidos: 0 } } });
  });
});

describe('usageTracker', () => {
  beforeEach(() => { tracker._ultimo.clear(); db.query = jest.fn().mockResolvedValue([{}]); });
  const run = (req) => new Promise(resolve => tracker.trackUsage({ originalUrl: '/vagas', ...req }, {}, resolve));
  const dev = { id: 7, type: 'dev' };

  test('mapeia caminhos para módulos', () => {
    expect(tracker.moduloDe('/vagas')).toBe('vagas');
    expect(tracker.moduloDe('/vagas/12')).toBe('vagas');
    expect(tracker.moduloDe('/api/vagas/12')).toBe('vagas');
    expect(tracker.moduloDe('/roadmap')).toBe('roadmap');
    expect(tracker.moduloDe('/meu-progresso')).toBe('roadmap');
    expect(tracker.moduloDe('/api/user/repos')).toBe('roadmap');
    expect(tracker.moduloDe('/mensagens')).toBe('chat');
    expect(tracker.moduloDe('/empresa/matchs')).toBe('chat');
    expect(tracker.moduloDe('/api/messages/conversations')).toBe('chat');
    expect(tracker.moduloDe('/mentor')).toBe('mentor');
    expect(tracker.moduloDe('/api/ai/mentor/mensagem')).toBe('mentor');
    expect(tracker.moduloDe('/dashboard')).toBe('outros');
  });
  test('ignora verificação de sessão, login e saúde', () => {
    ['/api/user', '/api/auth/login', '/health', '/favicon.ico'].forEach(p => expect(tracker.moduloDe(p)).toBeNull());
  });
  test('grava um evento por sessão e módulo a cada 5 min, com chave de sessão com hash', async () => {
    await run({ session: { user: dev }, sessionID: 'segredo-da-sessao' });
    await run({ session: { user: dev }, sessionID: 'segredo-da-sessao' });
    await run({ session: { user: dev }, sessionID: 'segredo-da-sessao', originalUrl: '/mentor' });
    expect(db.query).toHaveBeenCalledTimes(2);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO usage_events/);
    expect(sql).toMatch(/UTC_TIMESTAMP\(\)/);
    expect(params.slice(0, 2)).toEqual([7, 'dev']);
    expect(params[2]).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(params)).not.toContain('segredo-da-sessao');
    expect(params[3]).toBe('vagas');
  });
  test('visitante e admin não geram evento', async () => {
    await run({ session: undefined, sessionID: 'x' });
    await run({ session: { user: { id: 1, type: 'admin' } }, sessionID: 'y' });
    expect(db.query).not.toHaveBeenCalled();
  });
  test('erro do banco não derruba a requisição', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    db.query = jest.fn().mockRejectedValue(new Error('banco fora'));
    await expect(run({ session: { user: dev }, sessionID: 'z' })).resolves.toBeUndefined();
  });
});

describe('paraExport e exportação (PDF/Excel)', () => {
  const rel = svc.paraExport(svc.calcular(base, PERIODO));
  test('três seções e nome de arquivo com o período', () => {
    expect(rel.secoes.map(s => s.titulo)).toEqual(['Indicadores', 'Picos de acesso por horário', 'Módulos mais acessados']);
    expect(rel.secoes[0].linhas[1][1]).toBe('12min30s');
    expect(svc.nomeArquivo(svc.calcular(base, PERIODO), 'pdf')).toBe('relatorio-uso-da-plataforma_2026-11-01_a_2026-11-13.pdf');
  });
  test('PDF e Excel válidos', async () => {
    expect((await exportar(rel, 'pdf')).buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const x = await exportar(rel, 'xlsx');
    const wb = new (require('exceljs').Workbook)();
    await wb.xlsx.load(x.buffer);
    expect(wb.worksheets).toHaveLength(3);
  });
});

describe('API /api/admin/reports/uso-da-plataforma', () => {
  const app = express();
  app.get('/r', adminController.getRelatorioUso);
  app.get('/r.:formato', adminController.exportRelatorio(svc));

  const agora = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  beforeEach(() => {
    db.query = jest.fn()
      .mockResolvedValueOnce([[{ session_key: 'k', user_id: 1, user_type: 'dev', inicio: agora, fim: agora }]])
      .mockResolvedValueOnce([[{ module: 'vagas', usuarios: 1 }]])
      .mockResolvedValueOnce([[{ d: null }]])
      .mockResolvedValueOnce([[{ n: 4 }]])
      .mockResolvedValue([[{ n: 1 }]]);
  });

  test('devolve indicadores, horários e módulos', async () => {
    const r = await request(app).get('/r?periodo=30');
    expect(r.status).toBe(200);
    expect(r.body.kpis.sessoes_diarias.total).toBe(1);
    expect(r.body.horarios).toHaveLength(12);
    expect(r.body.modulos.find(m => m.chave === 'vagas')).toMatchObject({ usuarios: 1, taxa: 100 });
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
    expect(r.headers['content-disposition']).toMatch(/relatorio-uso-da-plataforma_.*\.pdf/);
  });
});

describe('página admin-relatorio-uso.ejs', () => {
  const { porSlug } = require('../config/relatorios');
  let html;
  beforeAll(async () => {
    html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin-relatorio-uso.ejs'),
      { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-relatorios', categoria: porSlug('uso-da-plataforma') });
  });
  test('um main, um h1 e as seções do protótipo', () => {
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    ['Sessões ativas diárias', 'Tempo médio por sessão', 'Utilização do Mentor', 'Taxa de retenção de 30 dias',
      'Dinâmica e engajamento', 'Picos de acesso por horários', 'Módulos mais acessados', 'Gerar relatório']
      .forEach(t => expect(html).toContain(t));
  });
  test('aviso de coleta como região de status; formatos PDF/Excel; sem handlers inline', () => {
    expect(html).toMatch(/id="coleta-aviso" role="status"/);
    expect(html).toContain('value="pdf"');
    expect(html).toContain('value="xlsx"');
    expect(html.slice(html.indexOf('<main'))).not.toMatch(/\son(click|change)=/);
  });
});
