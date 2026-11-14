// Admin → Configurações → Categorias e vagas: API de categorias, opções fixas, página e uso na vaga da empresa.
const path = require('path');
const ejs = require('ejs');
const request = require('supertest');
const express = require('express');

jest.mock('../database/db', () => ({ query: jest.fn(), getConnection: jest.fn(), ready: Promise.resolve() }));
const db = require('../database/db');
const adminController = require('../controllers/adminController');
const empresaController = require('../controllers/empresaController');
const { porSlug } = require('../config/configuracoes');

const app = express();
app.use(express.json());
app.get('/cats', adminController.listJobCategories);
app.post('/cats', adminController.createJobCategory);
app.patch('/cats/:id', adminController.updateJobCategory);
app.get('/opcoes', adminController.getJobOptions);

describe('GET /api/admin/job-categories', () => {
  test('lista com contagem de vagas, ativo como booleano', async () => {
    db.query = jest.fn().mockResolvedValueOnce([[
      { id: 1, nome: 'Tecnologia', descricao: 'd', active: 1, vagas: '12521' },
      { id: 2, nome: 'Outras', descricao: null, active: 0, vagas: 0 }]]);
    const r = await request(app).get('/cats');
    expect(r.body).toEqual([
      { id: 1, nome: 'Tecnologia', descricao: 'd', active: true, vagas: 12521 },
      { id: 2, nome: 'Outras', descricao: null, active: false, vagas: 0 }]);
  });
});

describe('POST /api/admin/job-categories', () => {
  test('cria com nome e descrição aparados', async () => {
    db.query = jest.fn().mockResolvedValueOnce([[]]).mockResolvedValueOnce([{ insertId: 9 }]);
    const r = await request(app).post('/cats').send({ nome: '  UX/UI ', descricao: ' Interfaces ' });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ success: true, id: 9 });
    expect(db.query.mock.calls[1][1]).toEqual(['UX/UI', 'Interfaces']);
  });
  test.each([[{}], [{ nome: 'a' }], [{ nome: 'x'.repeat(61) }], [{ nome: 'Ok', descricao: 'x'.repeat(256) }]])(
    'rejeita %j com 400 sem consultar o banco', async (body) => {
      db.query = jest.fn();
      expect((await request(app).post('/cats').send(body)).status).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
    });
  test('nome repetido → 409', async () => {
    db.query = jest.fn().mockResolvedValueOnce([[{ id: 1 }]]);
    const r = await request(app).post('/cats').send({ nome: 'Design' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Já existe/);
  });
});

describe('PATCH /api/admin/job-categories/:id', () => {
  test('desativa/ativa e edita só o que veio', async () => {
    db.query = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    expect((await request(app).patch('/cats/3').send({ active: false })).status).toBe(200);
    expect(db.query).toHaveBeenCalledWith('UPDATE job_categories SET active = ? WHERE id = ?', [0, 3]);
  });
  test('editar nome checa duplicidade em outra categoria', async () => {
    db.query = jest.fn().mockResolvedValueOnce([[{ id: 8 }]]);
    expect((await request(app).patch('/cats/3').send({ nome: 'Dados' })).status).toBe(409);
    db.query = jest.fn().mockResolvedValueOnce([[]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    const ok = await request(app).patch('/cats/3').send({ nome: 'Dados', descricao: '' });
    expect(ok.status).toBe(200);
    expect(db.query.mock.calls[1][0]).toBe('UPDATE job_categories SET nome = ?, descricao = ? WHERE id = ?');
    expect(db.query.mock.calls[1][1]).toEqual(['Dados', null, 3]);
  });
  test('400 sem campos ou com id inválido; 404 se não existe', async () => {
    db.query = jest.fn();
    expect((await request(app).patch('/cats/3').send({})).status).toBe(400);
    expect((await request(app).patch('/cats/abc').send({ active: true })).status).toBe(400);
    db.query = jest.fn().mockResolvedValue([{ affectedRows: 0 }]);
    expect((await request(app).patch('/cats/99').send({ active: true })).status).toBe(404);
  });
});

describe('GET /api/admin/job-options', () => {
  test('opções fixas com contagem de vagas e resumo de habilidades', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce([[{ valor: 'remoto', n: 7 }, { valor: 'hibrido', n: 3 }]])
      .mockResolvedValueOnce([[{ valor: 'estagio', n: 9 }]])
      .mockResolvedValueOnce([[{ valor: 'clt', n: 2 }, { valor: 'estagio', n: 8 }]])
      .mockResolvedValueOnce([[{ total: 50, tecnicas: '40', comportamentais: '10' }]]);
    const r = await request(app).get('/opcoes');
    expect(r.body.modalidades.map(m => [m.nome, m.vagas])).toEqual([['Presencial', 0], ['Remoto', 7], ['Híbrido', 3]]);
    expect(r.body.niveis.map(m => [m.nome, m.vagas])).toEqual([['Estágio', 9], ['Júnior', 0], ['Pleno', 0]]);
    expect(r.body.contratacao.map(m => [m.nome, m.vagas])).toEqual([['CLT', 2], ['PJ', 0], ['Estágio', 8], ['Freelancer', 0]]);
    expect(r.body.habilidades).toEqual({ total: 50, tecnicas: 40, comportamentais: 10 });
  });
});

describe('categoria na vaga da empresa', () => {
  const chamar = async (handler, body, params = {}) => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ session: { user: { id: 5, type: 'empresa' } }, body, params }, res);
    return res;
  };
  const BASE = { title: 'Vaga', level: 'estagio' };

  test('criar com categoria inexistente/desativada → 400 antes de qualquer outra consulta', async () => {
    db.query = jest.fn().mockResolvedValueOnce([[]]);
    const res = await chamar(empresaController.createJob, { ...BASE, category_id: 4 });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Categoria inválida/);
    expect(db.query.mock.calls[0][0]).toMatch(/FROM job_categories WHERE id = \? AND active = 1/);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
  test('criar sem categoria continua igual (category_id nulo)', async () => {
    db.query = jest.fn(async (sql) => {
      if (/user_subscriptions|subscriptions|annual_payments|COUNT\(\*\)/i.test(sql)) return [[{ total: 0 }]];
      if (/user_company_profiles/i.test(sql)) return [[{ nome_fantasia: 'Tech' }]];
      if (/insert into jobs/i.test(sql)) return [{ insertId: 1 }];
      return [[]];
    });
    const res = await chamar(empresaController.createJob, BASE);
    expect(res.statusCode).toBe(201);
    const [sql, params] = db.query.mock.calls.find(([s]) => /insert into jobs/i.test(s));
    expect(sql).toMatch(/category_id\)/);
    expect(params[params.length - 1]).toBeNull();
  });
  test('editar: manter a categoria atual não exige que ela esteja ativa; trocar exige', async () => {
    db.query = jest.fn(async (sql) => {
      if (/select id, active, category_id from jobs/i.test(sql)) return [[{ id: 3, active: 1, category_id: 4 }]];
      if (/update jobs set/i.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    });
    expect((await chamar(empresaController.updateJob, { category_id: 4 }, { id: '3' })).statusCode).toBe(200);
    const outra = await chamar(empresaController.updateJob, { category_id: 9 }, { id: '3' });
    expect(outra.statusCode).toBe(400);
  });
});

describe('admin-configuracoes-categorias.ejs', () => {
  let html;
  beforeAll(async () => {
    html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin-configuracoes-categorias.ejs'),
      { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-configuracoes', categoria: porSlug('categorias-e-vagas') });
  });
  test('um main, um h1, as cinco abas (tablist) e o botão de nova categoria', () => {
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('role="tablist"');
    ['Categorias', 'Modalidades', 'Nível de experiência', 'Contratação', 'Habilidades'].forEach(t => expect(html).toContain(`>${t}</button>`));
    expect(html.match(/role="tab"/g)).toHaveLength(5);
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('+ Nova categoria');
  });
  test('pop-up de nova categoria: <dialog>, campos com label, Publicar e Cancelar', () => {
    expect(html).toMatch(/<dialog class="adv-dialog adk-dialog" id="cat-dialog" aria-labelledby="cat-title">/);
    ['c-nome', 'c-desc'].forEach(id => expect(html).toContain(`for="${id}"`));
    expect(html).toContain('placeholder="Ex.: UX/UI"');
    expect(html).toContain('>Publicar</button>');
    expect(html).toContain('>Cancelar</button>');
  });
  test('aba Habilidades leva ao catálogo; dados escapados; sem handlers inline', () => {
    expect(html).toContain('href="/admin/configuracoes/categorias-e-vagas/habilidades"');
    expect(html).toContain('escapeHtml(i.nome)');
    expect(html.slice(html.indexOf('<main'))).not.toMatch(/\son(click|change)=/);
  });
});
