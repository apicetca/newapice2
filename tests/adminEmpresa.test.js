// Admin · perfil da empresa (/admin/empresas/:id): estrutura, detalhe e edição pela API.
const path = require('path');
const ejs = require('ejs');
const request = require('supertest');
const express = require('express');

jest.mock('../database/db', () => ({ query: jest.fn(), getConnection: jest.fn(), ready: Promise.resolve() }));
const db = require('../database/db');
const adminController = require('../controllers/adminController');

describe('admin-empresa.ejs', () => {
  let html;
  beforeAll(async () => {
    html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin-empresa.ejs'),
      { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-empresas', userId: 7 });
  });
  test('um main, um h1 e seções com h2', () => {
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    ['Informações', 'Sobre a empresa', 'Vagas', 'Plano do usuário', 'Informações da conta']
      .forEach(t => expect(html).toContain(`>${t}`));
  });
  test('campos com label, voltar para a lista e "Empresas" como página atual', () => {
    ['f-endereco', 'f-setor', 'f-modelo', 'f-maturidade', 'f-descricao', 'plan-select']
      .forEach(id => expect(html).toContain(`for="${id}"`));
    expect(html).toContain('href="/admin/empresas" class="adj-back"');
    expect(html).toMatch(/href="\/admin\/empresas"\s+class="header-link is-active"/);
  });
  test('cada vaga leva ao detalhe da vaga; dados escapados; sem handlers inline', () => {
    expect(html).toContain('href="/admin/vagas/${Number(j.id)}"');
    expect(html).toContain('escapeHtml(j.title)');
    expect(html.slice(html.indexOf('<main'))).not.toMatch(/\son(click|change)=/);
  });
  test('lista: o olho leva ao perfil da empresa', async () => {
    const list = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin-empresas.ejs'),
      { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-empresas' });
    expect(list).toContain('href="/admin/empresas/${Number(e.id)}"');
  });
});

describe('GET /api/admin/empresas/:id', () => {
  const app = express();
  app.use(express.json());
  app.get('/empresas/:id', adminController.getEmpresaDetail);

  test('devolve perfil, vagas, números e plano da empresa', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce([[{ id: 7, email: 'rh@azyra.com', active: 1, created_at: '2026-02-13', visto_ha_segundos: 30,
        razao_social: 'Azyra LTDA', nome_fantasia: 'Azyra', cnpj: '75512359000147', setor: 'tecnologia', maturidade: 'consolidada',
        endereco: 'Rua A', modelo_trabalho: 'hibrido', descricao: 'Sobre', site: null, cidade: null, estado: null }]])
      .mockResolvedValueOnce([[
        { id: 1, title: 'Vaga A', area: 'front-end', active: 1, max_candidates: 100, created_at: '2026-10-15', expires_at: '2026-12-14', total_candidaturas: 5 },
        { id: 2, title: 'Vaga B', area: null, active: 0, max_candidates: 100, created_at: '2026-10-16', expires_at: null, total_candidaturas: 3 }]])
      .mockResolvedValue([[]]);
    const r = await request(app).get('/empresas/7');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: 7, nome_fantasia: 'Azyra', modelo_trabalho: 'hibrido', active: true });
    expect(r.body.stats).toEqual({ vagas: 2, vagas_ativas: 1, candidaturas: 8 });
    expect(r.body.vagas[1]).toMatchObject({ active: false, total_candidaturas: 3 });
    expect(r.body.plan.code).toBe('empresa_free');
  });
  test('404 quando não é empresa; 400 com id inválido', async () => {
    db.query = jest.fn().mockResolvedValue([[]]);
    expect((await request(app).get('/empresas/7')).status).toBe(404);
    expect((await request(app).get('/empresas/abc')).status).toBe(400);
  });
});

describe('PATCH /api/admin/empresas/:id — campos do perfil', () => {
  const app = express();
  app.use(express.json());
  app.patch('/empresas/:id', adminController.updateEmpresaStatus);
  beforeEach(() => {
    db.query = jest.fn().mockResolvedValueOnce([[{ id: 5 }]]).mockResolvedValue([{ affectedRows: 1 }]);
  });

  test('grava endereço, modelo de trabalho e descrição', async () => {
    const r = await request(app).patch('/empresas/5').send({ endereco: ' Rua A ', modelo_trabalho: 'hibrido', descricao: 'Texto' });
    expect(r.status).toBe(200);
    const [sql, values] = db.query.mock.calls[1];
    expect(sql).toBe('UPDATE user_company_profiles SET endereco = ?, modelo_trabalho = ?, descricao = ? WHERE user_id = ?');
    expect(values).toEqual(['Rua A', 'hibrido', 'Texto', 5]);
  });
  test.each([
    [{ modelo_trabalho: 'orbital' }], [{ endereco: 'x'.repeat(256) }], [{ descricao: 'x'.repeat(1001) }],
  ])('rejeita %j com 400', async (body) => {
    expect((await request(app).patch('/empresas/5').send(body)).status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });
});
