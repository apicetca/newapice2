// Admin · Empresas (reformulação, desktop): estrutura da página e edição pela API.
const path = require('path');
const ejs = require('ejs');
const request = require('supertest');
const express = require('express');

jest.mock('../database/db', () => ({ query: jest.fn(), getConnection: jest.fn(), ready: Promise.resolve() }));
const db = require('../database/db');
const adminController = require('../controllers/adminController');

describe('admin-empresas.ejs', () => {
  let html;
  beforeAll(async () => {
    html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin-empresas.ejs'),
      { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-empresas' });
  });
  test('um main, um h1, sem h3', () => {
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/<h3\b/);
  });
  test('colunas do protótipo com th scope', () => {
    ['Empresa', 'E-mail', 'Setor', 'Vagas', 'Plano', 'Atividade', 'Ações']
      .forEach(c => expect(html).toContain(`<th scope="col">${c}</th>`));
  });
  test('busca por nome ou CNPJ e chips de vagas e de situação', () => {
    expect(html).toMatch(/<input type="search" id="search"[^>]*aria-label="Buscar empresas por nome ou CNPJ"/);
    ['Sem vagas', '1 a 3 vagas', '4+ vagas', 'Ativas', 'Inativos', 'Suspensos', 'Limpar'].forEach(t => expect(html).toContain(`>${t}</button>`));
  });
  test('ordenação é listbox: A-Z, Mais recentes, Todas', () => {
    expect(html).toContain('role="listbox"');
    ['A-Z', 'Mais recentes', 'Todas'].forEach(o => expect(html).toContain(`>${o}</li>`));
  });
  test('modal de edição: <dialog>, showModal e campos com label', () => {
    expect(html.match(/<dialog /g)).toHaveLength(1);
    expect(html).toContain('.showModal()');
    ['f-razao', 'f-fantasia', 'f-setor', 'f-maturidade'].forEach(id => expect(html).toContain(`for="${id}"`));
  });
  test('dados do banco escapados e sem handlers inline na página', () => {
    expect(html).toContain('escapeHtml(e.email)');
    expect(html).toContain('escapeHtml(nome)');
    expect(html.slice(html.indexOf('<main'))).not.toMatch(/\son(click|change)=/);
  });
});

describe('PATCH /api/admin/empresas/:id', () => {
  const app = express();
  app.use(express.json());
  app.patch('/empresas/:id', adminController.updateEmpresaStatus);
  beforeEach(() => {
    db.query = jest.fn().mockResolvedValueOnce([[{ id: 5 }]]).mockResolvedValue([{ affectedRows: 1 }]);
  });

  test('{ active } continua suspendendo/reativando', async () => {
    const r = await request(app).patch('/empresas/5').send({ active: false });
    expect(r.status).toBe(200);
    expect(db.query).toHaveBeenCalledWith("UPDATE users SET active = ? WHERE id = ? AND type = 'empresa'", [0, 5]);
  });
  test('edição monta o UPDATE do perfil só com os campos enviados', async () => {
    const r = await request(app).patch('/empresas/5')
      .send({ razao_social: ' AZYRA ', nome_fantasia: '', setor: 'tecnologia', maturidade: 'consolidada' });
    expect(r.status).toBe(200);
    const [sql, values] = db.query.mock.calls[1];
    expect(sql).toBe('UPDATE user_company_profiles SET razao_social = ?, nome_fantasia = ?, setor = ?, maturidade = ? WHERE user_id = ?');
    expect(values).toEqual(['AZYRA', null, 'tecnologia', 'consolidada', 5]);
  });
  test('setor e maturidade vazios limpam o campo', async () => {
    await request(app).patch('/empresas/5').send({ setor: '', maturidade: '' });
    expect(db.query.mock.calls[1][1]).toEqual([null, null, 5]);
  });
  test.each([
    [{ razao_social: '' }], [{ razao_social: 'x' }], [{ setor: 'mineracao' }], [{ maturidade: 'gigante' }],
    [{ nome_fantasia: 'x'.repeat(201) }], [{}],
  ])('rejeita payload inválido %j com 400', async (body) => {
    const r = await request(app).patch('/empresas/5').send(body);
    expect(r.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });
  test('404 quando a empresa não existe', async () => {
    db.query = jest.fn().mockResolvedValue([[]]);
    expect((await request(app).patch('/empresas/9').send({ active: true })).status).toBe(404);
  });
});
