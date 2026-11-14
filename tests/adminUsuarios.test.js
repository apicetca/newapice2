// Admin · Usuários (reformulação, desktop): estrutura da página, edição de dev
// pela API e registro da última atividade.
const path = require('path');
const ejs = require('ejs');
const request = require('supertest');
const express = require('express');

jest.mock('../database/db', () => ({ query: jest.fn(), getConnection: jest.fn(), ready: Promise.resolve() }));
const db = require('../database/db');
const adminController = require('../controllers/adminController');
const { trackLastSeen, _lastWrite } = require('../middlewares/lastSeen');

describe('admin-usuarios.ejs', () => {
  let html;
  beforeAll(async () => {
    html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin-usuarios.ejs'),
      { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-usuarios' });
  });
  test('um main, um h1, sem h3', () => {
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/<h3\b/);
  });
  test('colunas do protótipo com th scope', () => {
    ['Nome', 'E-mail', 'Nível', 'Plano', 'Atividade', 'Ações']
      .forEach(c => expect(html).toContain(`<th scope="col">${c}</th>`));
  });
  test('filtros de plano e nível, busca com nome acessível', () => {
    expect(html).toMatch(/<input type="search" id="search"[^>]*aria-label=/);
    ['FREE', 'PRO', 'Iniciante', 'Intermediário', 'Avançado', 'Limpar'].forEach(t => expect(html).toContain(`>${t}</button>`));
  });
  test('ordenação é listbox: A-Z, Mais recentes, Todos', () => {
    expect(html).toContain('role="listbox"');
    ['A-Z', 'Mais recentes', 'Todos'].forEach(o => expect(html).toContain(`>${o}</li>`));
  });
  test('modal de edição é <dialog> com showModal e labels', () => {
    expect(html.match(/<dialog /g)).toHaveLength(1);
    expect(html).toContain('.showModal()');
    ['f-nome', 'f-sobrenome', 'f-nivel', 'f-github'].forEach(id => expect(html).toContain(`for="${id}"`));
  });
  test('dados do banco passam por escapeHtml e sem onclick/onchange inline', () => {
    expect(html).toContain('/js/escape-html.js');
    expect(html).toContain('escapeHtml(u.email)');
    expect(html).toContain('escapeHtml(nome)');
    const body = html.slice(html.indexOf('<main'));
    expect(body).not.toMatch(/\son(click|change)=/);
  });
});

describe('PATCH /api/admin/users/:id', () => {
  const app = express();
  app.use(express.json());
  app.patch('/users/:id', adminController.updateUserStatus);
  beforeEach(() => {
    db.query = jest.fn().mockResolvedValueOnce([[{ id: 5 }]]).mockResolvedValue([{ affectedRows: 1 }]);
  });

  test('{ active } continua suspendendo/reativando', async () => {
    const r = await request(app).patch('/users/5').send({ active: false });
    expect(r.status).toBe(200);
    expect(db.query).toHaveBeenCalledWith("UPDATE users SET active = ? WHERE id = ? AND type = 'dev'", [0, 5]);
  });
  test('edição monta o UPDATE do perfil só com os campos enviados', async () => {
    const r = await request(app).patch('/users/5')
      .send({ nome: ' Igor ', sobrenome: '', nivel: 'avancado', github_login: '@igorgomes' });
    expect(r.status).toBe(200);
    const [sql, values] = db.query.mock.calls[1];
    expect(sql).toBe('UPDATE user_dev_profiles SET nome = ?, sobrenome = ?, nivel = ?, github_login = ? WHERE user_id = ?');
    expect(values).toEqual(['Igor', null, 'avancado', 'igorgomes', 5]);
  });
  test.each([
    [{ nome: '' }], [{ nome: '<img src=x>' }], [{ nome: 'Igor', nivel: 'senior' }],
    [{ github_login: 'nome inválido!' }], [{ sobrenome: '123' }], [{}],
  ])('rejeita payload inválido %j com 400', async (body) => {
    const r = await request(app).patch('/users/5').send(body);
    expect(r.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });
  test('404 quando o dev não existe', async () => {
    db.query = jest.fn().mockResolvedValue([[]]);
    expect((await request(app).patch('/users/9').send({ active: true })).status).toBe(404);
  });
});

describe('trackLastSeen', () => {
  beforeEach(() => { _lastWrite.clear(); db.query = jest.fn().mockResolvedValue([{}]); });
  const run = (session) => new Promise(resolve => trackLastSeen({ session }, {}, resolve));

  test('grava last_seen_at do usuário logado, no máximo uma vez a cada 5 min', async () => {
    await run({ user: { id: 7 } });
    await run({ user: { id: 7 } });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toMatch(/UPDATE users SET last_seen_at = NOW\(\)/);
    expect(db.query.mock.calls[0][1]).toEqual([7]);
  });
  test('visitante não grava nada e erro do banco não derruba a requisição', async () => {
    await run(undefined);
    expect(db.query).not.toHaveBeenCalled();
    db.query = jest.fn().mockRejectedValue(new Error('db fora'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(run({ user: { id: 8 } })).resolves.toBeUndefined();
  });
});

describe('admin-usuario.ejs (perfil do dev)', () => {
  let html;
  beforeAll(async () => {
    html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin-usuario.ejs'),
      { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-usuarios', userId: 7 });
  });
  test('um main, um h1 e seções com h2 (sem pular nível)', () => {
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/<h3\b/);
    ['Informações pessoais', 'Habilidades', 'Repositórios no perfil', 'Plano do usuário', 'Informações da conta']
      .forEach(t => expect(html).toContain(t));
  });
  test('campos com label, voltar para a lista e header com "Usuários" ativo', () => {
    ['f-nome', 'f-sobrenome', 'f-github', 'f-nivel', 's-skill', 's-nivel', 'plan-select'].forEach(id => expect(html).toContain(`for="${id}"`));
    expect(html).toContain('href="/admin/usuarios" class="adj-back"');
    expect(html).toMatch(/href="\/admin\/usuarios"\s+class="header-link is-active"/);
  });
  test('dados do banco passam por escapeHtml e sem handlers inline na página', () => {
    expect(html).toContain('escapeHtml(s.name)');
    expect(html).toContain('escapeHtml(r.repo_name)');
    expect(html.slice(html.indexOf('<main'))).not.toMatch(/\son(click|change)=/);
  });
  test('lista: o olho leva ao perfil do dev', async () => {
    const list = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin-usuarios.ejs'),
      { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-usuarios' });
    expect(list).toContain('href="/admin/usuarios/${Number(u.id)}"');
  });
});

describe('GET /api/admin/users/:id e habilidades', () => {
  const app = express();
  app.use(express.json());
  app.get('/users/:id', adminController.getUserDetail);
  app.post('/users/:id/skills', adminController.addUserSkill);
  app.delete('/users/:id/skills/:skillId', adminController.removeUserSkill);

  test('devolve perfil, habilidades, repositórios e plano do dev', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce([[{ id: 7, email: 'a@b.com', active: 1, created_at: '2026-02-13', tem_senha: 0, visto_ha_segundos: 60,
        nome: 'Igor', sobrenome: 'Gomes', nivel: 'iniciante', github_login: 'igorgomes', github_id: 99, avatar_url: null }]])
      .mockResolvedValueOnce([[{ skill_id: 1, source: 'github', confidence: 80, name: 'React' }]])
      .mockResolvedValueOnce([[{ skill_id: 1, nivel: 'avancado' }]])
      .mockResolvedValueOnce([[{ repo_name: 'meu-projeto', repo_full_name: 'igor/meu-projeto' }]])
      .mockResolvedValueOnce([[]])   // user_subscriptions (plano manual)
      .mockResolvedValueOnce([[]])   // subscriptions (MP)
      .mockResolvedValueOnce([[]])   // annual_payments
      .mockResolvedValue([[]]);
    const r = await request(app).get('/users/7');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: 7, nome: 'Igor', login_github: true, github_login: 'igorgomes' });
    expect(r.body.skills[0]).toMatchObject({ name: 'React', nivel_declarado: 'avancado' });
    expect(r.body.repos).toHaveLength(1);
    expect(r.body.plan.code).toBe('dev_free');
    // user_skills é consultado pela chave github_id do dev, não pelo id interno
    expect(db.query.mock.calls[1][1]).toEqual([99]);
  });
  test('404 quando não é dev; 400 com id inválido', async () => {
    db.query = jest.fn().mockResolvedValue([[]]);
    expect((await request(app).get('/users/7')).status).toBe(404);
    expect((await request(app).get('/users/abc')).status).toBe(400);
  });
  test('404 ao declarar habilidade para quem não é dev', async () => {
    db.query = jest.fn().mockResolvedValue([[]]);
    expect((await request(app).post('/users/7/skills').send({ skill_id: 1 })).status).toBe(404);
    expect((await request(app).delete('/users/7/skills/1')).status).toBe(404);
  });
});
