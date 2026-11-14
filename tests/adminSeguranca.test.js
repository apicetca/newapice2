// Admin → Configurações → Segurança e privacidade: auditoria, administradores e página.
const path = require('path');
const ejs = require('ejs');
const request = require('supertest');
const express = require('express');

jest.mock('../database/db', () => ({ query: jest.fn(), getConnection: jest.fn(), ready: Promise.resolve() }));
const db = require('../database/db');
const adminController = require('../controllers/adminController');
const { auditarAdmin, descrever } = require('../middlewares/adminAudit');
const { porSlug } = require('../config/configuracoes');

describe('descrever (frase do histórico)', () => {
  test.each([
    ['PATCH', '/users/5', { active: false }, 'Suspendeu o desenvolvedor #5'],
    ['PATCH', '/users/5', { active: true }, 'Reativou o desenvolvedor #5'],
    ['PATCH', '/users/5', { nome: 'X', nivel: 'pleno' }, 'Editou os dados do desenvolvedor #5'],
    ['PATCH', '/users/5/plan', { plan_code: 'dev_pro' }, 'Alterou o plano do desenvolvedor #5 para dev_pro'],
    ['PATCH', '/empresas/7', { active: false }, 'Suspendeu a empresa #7'],
    ['PATCH', '/jobs/3', { active: false }, 'Pausou a vaga #3'],
    ['DELETE', '/jobs/3', {}, 'Excluiu a vaga #3'],
    ['POST', '/job-categories', { nome: ' UX/UI ' }, 'Criou a categoria de vaga "UX/UI"'],
    ['PATCH', '/job-categories/2', { active: false }, 'Desativou a categoria de vaga #2'],
    ['DELETE', '/admins/9', {}, 'Removeu o administrador #9'],
    ['POST', '/algo-novo', {}, 'POST /algo-novo'],
  ])('%s %s', (m, c, b, esperado) => expect(descrever(m, c, b)).toBe(esperado));
});

describe('auditarAdmin (middleware)', () => {
  const rodar = (req, status) => new Promise(resolve => {
    const handlers = {};
    const res = { statusCode: status, on: (e, f) => { handlers[e] = f; } };
    auditarAdmin({ session: { user: { id: 1, name: 'Arthur' } }, ...req }, res, () => { handlers.finish?.(); resolve(); });
  });
  beforeEach(() => { db.query = jest.fn().mockResolvedValue([{}]); });

  test('grava quem fez e o quê quando a ação altera algo e dá certo', async () => {
    await rodar({ method: 'PATCH', originalUrl: '/api/admin/jobs/3?x=1', body: { active: false } }, 200);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toMatch(/INSERT INTO admin_audit_log/);
    expect(db.query.mock.calls[0][0]).toMatch(/\(admin_id, admin_nome, acao, titulo\)/);
    expect(db.query.mock.calls[0][1]).toEqual([1, 'Arthur', 'Pausou a vaga #3', 'Pausa de vaga']);
  });
  test('não grava leituras, erros nem o corpo da requisição', async () => {
    await rodar({ method: 'GET', originalUrl: '/api/admin/jobs' }, 200);
    await rodar({ method: 'PATCH', originalUrl: '/api/admin/jobs/3', body: { active: true } }, 400);
    expect(db.query).not.toHaveBeenCalled();
    await rodar({ method: 'PATCH', originalUrl: '/api/admin/users/5/plan', body: { plan_code: 'dev_pro', senha: 'segredo' } }, 200);
    expect(JSON.stringify(db.query.mock.calls)).not.toContain('segredo');
  });
  test('erro do banco não derruba a requisição', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    db.query = jest.fn().mockRejectedValue(new Error('banco fora'));
    await expect(rodar({ method: 'DELETE', originalUrl: '/api/admin/jobs/3' }, 200)).resolves.toBeUndefined();
  });
});

describe('API de administradores e histórico', () => {
  const app = express();
  app.use((req, res, next) => { req.session = { user: { id: 1, type: 'admin' } }; next(); });
  app.get('/admins', adminController.listAdmins);
  app.delete('/admins/:id', adminController.removeAdmin);
  app.get('/audit', adminController.listAuditLog);

  test('lista com busca, paginação e "você"', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce([[{ total: 7 }]])
      .mockResolvedValueOnce([[
        { id: 1, email: 'arthur@apice.com', nome: 'Arthur Maeda', visto_ha_segundos: 60 },
        { id: 2, email: 'sofia@apice.com', nome: null, visto_ha_segundos: null }]]);
    const r = await request(app).get('/admins?q=ap&page=2&limit=5');
    expect(r.body).toMatchObject({ total: 7, page: 2, limit: 5 });
    expect(r.body.items).toEqual([
      { id: 1, nome: 'Arthur Maeda', email: 'arthur@apice.com', voce: true, visto_ha_segundos: 60 },
      { id: 2, nome: 'sofia@apice.com', email: 'sofia@apice.com', voce: false, visto_ha_segundos: null }]);
    expect(db.query.mock.calls[0][1]).toEqual(['%ap%', '%ap%']);
    expect(db.query.mock.calls[1][1]).toEqual(['%ap%', '%ap%', 5, 5]);
  });
  test('limite e página são saneados', async () => {
    db.query = jest.fn().mockResolvedValue([[{ total: 0 }]]);
    await request(app).get('/admins?page=-3&limit=9999');
    expect(db.query.mock.calls[1][1]).toEqual([50, 0]);
  });

  test('remove outro administrador e encerra as sessões dele', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce([[{ id: 2 }]])        // existe e é admin
      .mockResolvedValueOnce([[{ total: 3 }]])     // há mais de um
      .mockResolvedValue([{ affectedRows: 1 }]);
    const r = await request(app).delete('/admins/2');
    expect(r.status).toBe(200);
    const sqls = db.query.mock.calls.map(c => c[0]);
    expect(sqls.some(s => /DELETE FROM user_admin_profiles/.test(s))).toBe(true);
    expect(sqls.some(s => /DELETE FROM users WHERE id = \? AND type = 'admin'/.test(s))).toBe(true);
    const sess = db.query.mock.calls.find(c => /DELETE FROM sessions/.test(c[0]));
    expect(sess[1]).toEqual([2]);
  });
  test('não remove a própria conta, o último admin, quem não é admin; id inválido → 400', async () => {
    db.query = jest.fn();
    expect((await request(app).delete('/admins/1')).status).toBe(400);
    expect((await request(app).delete('/admins/abc')).status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
    db.query = jest.fn().mockResolvedValueOnce([[]]);
    expect((await request(app).delete('/admins/2')).status).toBe(404);
    db.query = jest.fn().mockResolvedValueOnce([[{ id: 2 }]]).mockResolvedValueOnce([[{ total: 1 }]]);
    const ultimo = await request(app).delete('/admins/2');
    expect(ultimo.status).toBe(400);
    expect(ultimo.body.error).toMatch(/último administrador/);
    expect(db.query).toHaveBeenCalledTimes(2); // nada foi apagado
  });
  test('falha ao encerrar sessões não desfaz a remoção', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    db.query = jest.fn()
      .mockResolvedValueOnce([[{ id: 2 }]]).mockResolvedValueOnce([[{ total: 2 }]])
      .mockResolvedValueOnce([{}]).mockResolvedValueOnce([{}])
      .mockRejectedValueOnce(new Error('sem tabela sessions'));
    expect((await request(app).delete('/admins/2')).status).toBe(200);
  });

  test('histórico: mais recentes primeiro, com paginação', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce([[{ total: 25 }]])
      .mockResolvedValueOnce([[{ id: 9, admin_nome: 'Arthur', acao: 'Pausou a vaga #3', ha_segundos: '120' }]]);
    const r = await request(app).get('/audit?page=3');
    expect(r.body).toEqual({ total: 25, page: 3, limit: 10, items: [{ id: 9, admin: 'Arthur', titulo: 'Alteração no painel', acao: 'Pausou a vaga #3', ha_segundos: 120 }] });
    expect(db.query.mock.calls[1][0]).toMatch(/ORDER BY id DESC/);
    expect(db.query.mock.calls[1][1]).toEqual([10, 20]);
  });
  test('histórico: filtra por período (7/30/90 ou datas) e rejeita período inválido sem tocar no banco', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([[{ id: 9, admin_nome: 'Sofia', titulo: 'Edição de empresa', acao: 'Editou os dados da empresa #7', ha_segundos: 60 }]]);
    const r = await request(app).get('/audit?periodo=7');
    expect(r.body.items[0].titulo).toBe('Edição de empresa');
    expect(db.query.mock.calls[0][0]).toMatch(/WHERE created_at >= \? AND created_at < DATE_ADD\(\?, INTERVAL 1 DAY\)/);
    expect(db.query.mock.calls[0][1]).toHaveLength(2);
    expect(db.query.mock.calls[1][1]).toHaveLength(4);
    db.query = jest.fn();
    expect((await request(app).get('/audit?periodo=5')).status).toBe(400);
    expect((await request(app).get('/audit?from=2026-02-30&to=2026-03-01')).status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('admin-configuracoes-seguranca.ejs', () => {
  let html;
  beforeAll(async () => {
    html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin-configuracoes-seguranca.ejs'),
      { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-configuracoes', categoria: porSlug('administracao-e-seguranca') });
  });
  test('um main, um h1 "Segurança e privacidade", duas abas e busca rotulada', () => {
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Segurança e privacidade');
    expect(html).toContain('Gerencie o acesso de administradores');
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    ['Controle de acesso', 'Histórico de atividades'].forEach(t => expect(html).toContain(`>${t}</button>`));
    expect(html).toMatch(/<input type="search" id="search"[^>]*aria-label=/);
  });
  test('menu e confirmação com "Remover administrador" e "Cancelar"', () => {
    expect(html).toMatch(/id="sheet" role="menu"/);
    expect(html.match(/Remover administrador/g).length).toBeGreaterThanOrEqual(3);
    expect(html).toMatch(/<dialog class="adv-dialog adk-dialog" id="rm-dialog"/);
    expect(html.match(/>Cancelar<\/button>/g).length).toBe(2);
  });
  test('histórico: 4 colunas, chips de período com aria-pressed e datas personalizadas rotuladas', () => {
    ['Data e hora', 'Administrador', 'Ação realizada', 'Detalhes'].forEach(t => expect(html).toContain(`>${t}</th>`));
    ['7 dias', '30 dias', '90 dias', 'Personalizado'].forEach(t => expect(html).toMatch(new RegExp(`<button[^>]*aria-pressed="(true|false)">${t}</button>`)));
    expect(html).toContain('<legend class="visually-hidden">Período do histórico</legend>');
    expect(html).toMatch(/<label>De <input type="date" id="from"/);
    expect(html).toContain('escapeHtml(l.titulo)');
  });
  test('dados escapados, sem handlers inline, paginação rotulada', () => {
    expect(html).toContain('escapeHtml(a.nome)');
    expect(html).toContain('escapeHtml(l.acao)');
    expect(html).toContain('aria-label="Paginação"');
    expect(html.slice(html.indexOf('<main'))).not.toMatch(/\son(click|change)=/);
  });
});
