// Relatório "Planos e assinaturas": cálculo de receita, API, exportação (com tipo de plano) e página.
const path = require('path');
const ejs = require('ejs');
const request = require('supertest');
const express = require('express');

jest.mock('../database/db', () => ({ query: jest.fn(), getConnection: jest.fn(), ready: Promise.resolve() }));
const db = require('../database/db');
const adminController = require('../controllers/adminController');
const svc = require('../services/relatorioPlanos');
const { exportar } = require('../services/relatorioExport');

const HOJE = '2026-11-13';
const PERIODO = { from: '2026-11-01', to: '2026-11-13' }; // 13 dias · anterior: 19/10 a 31/10

const dados = {
  subs: [
    { user_id: 1,  plan_id: 'dev_pro',         created: '2026-10-10', cancelled: null,         ativa: 1 },
    { user_id: 2,  plan_id: 'dev_pro',         created: '2026-11-05', cancelled: null,         ativa: 1 },
    { user_id: 3,  plan_id: 'dev_pro',         created: '2026-09-01', cancelled: '2026-11-08', ativa: 0 }, // cancelou no período
    { user_id: 10, plan_id: 'empresa_premium', created: '2026-10-25', cancelled: null,         ativa: 1 },
  ],
  anuais: [{ user_id: 4, plan_id: 'dev_pro', amount: '238.80', pago: '2026-11-10', ate: '2027-11-10', ativa: 1 }],
  manuais: [{ user_id: 5, plan_code: 'dev_pro', status: 'active', created: '2026-11-02' }],
  pessoas: [
    { user_id: 1, tipo: 'dev', nome: 'Igor Gomes', doc: '@igor', avatar_url: null },
    { user_id: 2, tipo: 'dev', nome: 'Lucas Andrade', doc: '@lucas', avatar_url: null },
    { user_id: 4, tipo: 'dev', nome: 'Ana', doc: '@ana', avatar_url: null },
    { user_id: 5, tipo: 'dev', nome: 'Beto', doc: null, avatar_url: null },
    { user_id: 10, tipo: 'empresa', nome: 'Azyra', doc: '75512359000147', avatar_url: null },
  ],
  base: { kpis: { devs: { total: 100, pro: 4 }, empresas: { total: 10, pro: 1 }, conversao: { taxa: 4.5, variacao_pp: 0.5 } } },
};

describe('calcular', () => {
  const r = svc.calcular(dados, PERIODO, HOJE);

  test('receita mensal recorrente: mensalidades + anual ÷ 12; plano manual não gera receita', () => {
    // devs: 24,90 + 24,90 + 238,80/12 (=19,90) = 69,70 · empresas: 99,99
    expect(r.kpis.mrr).toMatchObject({ centavos: 16969, devs: 6970, empresas: 9999 });
  });
  test('variação do MRR compara com o fim do período anterior (a cancelada ainda contava)', () => {
    expect(r.kpis.mrr.variacao_pct).toBe(13); // 169,69 vs 149,79
  });
  test('assinantes PRO vêm do relatório de crescimento; variação = ativações e cancelamentos no período', () => {
    // hoje 5 · +3 ativações (mensal, anual, manual) − 1 cancelamento → começou com 3
    expect(r.kpis.pro).toEqual({ total: 5, devs: 4, empresas: 1, variacao_pct: 67 });
  });
  test('conversão reaproveita a do crescimento e detalha por tipo', () => {
    expect(r.kpis.conversao).toEqual({ taxa: 4.5, variacao_pp: 0.5, devs: 4, empresas: 10 });
  });
  test('cancelamentos: canceladas no período ÷ PRO no início, em p.p. sobre o período anterior', () => {
    expect(r.kpis.cancelamentos).toEqual({ taxa: 33.3, cancelados: 1, variacao_pp: 33.3 }); // 1 de 3 · antes 0 de 2
  });
  test('evolução do faturamento por dia, reconstruída pelas datas; hoje usa o estado real', () => {
    expect(r.faturamento).toHaveLength(13);
    const dia = (l) => r.faturamento.find(f => f.label === l);
    expect(dia('01/11')).toMatchObject({ devs: 49.8, empresas: 99.99 });  // a cancelada em 08/11 ainda conta
    expect(dia('08/11')).toMatchObject({ devs: 49.8 });                    // já saiu a cancelada, entrou a de 05/11
    expect(dia('10/11')).toMatchObject({ devs: 69.7 });                    // entra o plano anual
    expect(dia('13/11')).toMatchObject({ devs: 69.7, empresas: 99.99 });
  });
  test('últimas assinaturas e upgrades do período, mais recentes primeiro', () => {
    expect(r.assinaturas.map(a => [a.nome, a.ciclo, a.centavos, a.data])).toEqual([
      ['Ana', 'anual', 23880, '2026-11-10'],
      ['Lucas Andrade', 'mensal', 2490, '2026-11-05'],
      ['Beto', 'manual', 0, '2026-11-02'],
    ]);
  });
  test('sem assinaturas: tudo zerado e sem divisão por zero', () => {
    const v = svc.calcular({ subs: [], anuais: [], manuais: [], pessoas: [],
      base: { kpis: { devs: { total: 0, pro: 0 }, empresas: { total: 0, pro: 0 }, conversao: { taxa: 0, variacao_pp: null } } } }, PERIODO, HOJE);
    expect(v.kpis.mrr).toEqual({ centavos: 0, devs: 0, empresas: 0, variacao_pct: null });
    expect(v.kpis.pro.variacao_pct).toBeNull();
    expect(v.kpis.cancelamentos).toEqual({ taxa: null, cancelados: 0, variacao_pp: null });
    expect(v.assinaturas).toEqual([]);
  });
});

describe('paraExport (com tipo de plano) e exportação', () => {
  const r = svc.calcular(dados, PERIODO, HOJE);
  const plano = (s) => s.replace(/\s/g, ' ');

  test('sem tipo: duas séries e todas as assinaturas', () => {
    const rel = svc.paraExport(r, {});
    expect(rel.titulo).toBe('Planos e assinaturas');
    expect(rel.secoes[1].colunas).toEqual(['Ponto', 'Devs', 'Empresas']);
    expect(rel.secoes[2].linhas).toHaveLength(3);
  });
  test('tipo=dev: só a série e as assinaturas de devs, com os indicadores do tipo', () => {
    const rel = svc.paraExport(r, { tipo: 'dev' });
    expect(rel.titulo).toBe('Planos e assinaturas — Devs');
    expect(rel.secoes[1].colunas).toEqual(['Ponto', 'Devs']);
    expect(plano(rel.secoes[0].linhas[0][1])).toBe('R$ 69,70');
    expect(rel.secoes[0].linhas[1][1]).toBe(4);
  });
  test('tipo=empresa filtra as assinaturas de empresas', () => {
    const rel = svc.paraExport(r, { tipo: 'empresa' });
    expect(rel.secoes[2].linhas).toHaveLength(0); // a empresa assinou antes do período
    expect(plano(rel.secoes[0].linhas[0][1])).toBe('R$ 99,99');
  });
  test('tipo inválido → erro 400', () => {
    expect(() => svc.paraExport(r, { tipo: 'admin' })).toThrow(/Tipo de plano inválido/);
    try { svc.paraExport(r, { tipo: 'admin' }); } catch (e) { expect(e.status).toBe(400); }
  });
  test('PDF e Excel válidos; nome do arquivo com o período', async () => {
    const rel = svc.paraExport(r, {});
    expect((await exportar(rel, 'pdf')).buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const x = await exportar(rel, 'xlsx');
    const wb = new (require('exceljs').Workbook)();
    await wb.xlsx.load(x.buffer);
    expect(wb.worksheets).toHaveLength(3);
    expect(svc.nomeArquivo(r, 'pdf')).toBe('relatorio-planos-e-assinaturas_2026-11-01_a_2026-11-13.pdf');
  });
});

describe('API /api/admin/reports/planos-e-assinaturas', () => {
  const app = express();
  app.get('/r', adminController.getRelatorioPlanos);
  app.get('/r.:formato', adminController.exportRelatorio(svc));

  beforeEach(() => {
    db.query = jest.fn()
      .mockResolvedValueOnce([[]])                                   // crescimento: cadastros
      .mockResolvedValueOnce([[]])                                   // crescimento: primeiro plano pago
      .mockResolvedValueOnce([[{ type: 'dev', n: 5 }]])              // crescimento: contas ativas
      .mockResolvedValueOnce([[{ type: 'dev', n: 1 }]])              // crescimento: PRO ativos
      .mockResolvedValueOnce([[{ user_id: 1, plan_id: 'dev_pro', created: '2026-10-01', cancelled: null, ativa: 1 }]]) // mensais
      .mockResolvedValueOnce([[]])                                   // anuais
      .mockResolvedValueOnce([[]])                                   // manuais
      .mockResolvedValueOnce([[{ user_id: 1, nome: 'Igor', sobrenome: '', github_login: 'igor', avatar_url: null }]])
      .mockResolvedValueOnce([[]]);
  });

  test('devolve indicadores, faturamento e assinaturas', async () => {
    const r = await request(app).get('/r?periodo=30');
    expect(r.status).toBe(200);
    expect(r.body.kpis.mrr.centavos).toBe(2490);
    expect(r.body.kpis.pro).toMatchObject({ total: 1, devs: 1, empresas: 0 });
    expect(r.body.faturamento).toHaveLength(5);
  });
  test('período inválido → 400 sem consultar o banco', async () => {
    db.query = jest.fn();
    expect((await request(app).get('/r?periodo=abc')).status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });
  test('exporta Excel filtrado por tipo e rejeita tipo inválido', async () => {
    const ok = await request(app).get('/r.xlsx?periodo=30&tipo=dev').buffer(true).parse((res, cb) => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(ok.status).toBe(200);
    expect(ok.body.subarray(0, 2).toString('latin1')).toBe('PK');
    db.query = jest.fn().mockResolvedValue([[]]);
    expect((await request(app).get('/r.xlsx?periodo=30&tipo=admin')).status).toBe(400);
  });
});

describe('página admin-relatorio-planos.ejs', () => {
  const { porSlug } = require('../config/relatorios');
  let html;
  beforeAll(async () => {
    html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin-relatorio-planos.ejs'),
      { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-relatorios', categoria: porSlug('planos-e-assinaturas') });
  });
  test('um main, um h1 e as seções do protótipo', () => {
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    ['Receita mensal recorrente', 'Assinantes PRO ativos', 'Taxa de conversão de FREE para PRO', 'Taxa de cancelamentos',
      'Distribuição e evolução', 'Evolução do faturamento', 'Gestão de assinaturas', 'Últimas assinaturas e upgrades', 'Gerar relatório']
      .forEach(t => expect(html).toContain(t));
  });
  test('gerador com tipo de plano, formatos PDF/Excel; tabela com th scope; dados escapados', () => {
    expect(html).toContain('name="gt"');
    ['value="dev"', 'value="empresa"', 'value="pdf"', 'value="xlsx"'].forEach(t => expect(html).toContain(t));
    ['Dev/Empresa', 'Plano', 'Ciclo', 'Valor'].forEach(c => expect(html).toContain(`>${c}</th>`));
    expect(html).toContain('escapeHtml(a.nome)');
    expect(html.slice(html.indexOf('<main'))).not.toMatch(/\son(click|change)=/);
  });
});
