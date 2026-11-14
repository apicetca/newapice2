// Admin · Vagas (reformulação, desktop): estrutura da página e contrato da API.
const path = require('path');
const ejs = require('ejs');
const request = require('supertest');
const express = require('express');

jest.mock('../database/db', () => ({ query: jest.fn(), getConnection: jest.fn(), ready: Promise.resolve() }));
const db = require('../database/db');
const adminController = require('../controllers/adminController');

describe('admin-vagas.ejs', () => {
  let html;
  beforeAll(async () => {
    html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin-vagas.ejs'),
      { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-vagas' });
  });
  test('um main, um h1, sem salto de heading', () => {
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/<h3\b/);
  });
  test('colunas do protótipo com th scope', () => {
    ['Título', 'Empresa', 'Nível', 'Local', 'Candidatos', 'Expiração', 'Ações']
      .forEach(c => expect(html).toContain(`<th scope="col">${c}</th>`));
  });
  test('busca com nome acessível e chips com aria-pressed', () => {
    expect(html).toMatch(/<input type="search" id="search"[^>]*aria-label=/);
    expect(html).toMatch(/aria-pressed="true"/);
  });
  test('ordenação é listbox com as 4 opções do protótipo', () => {
    expect(html).toContain('role="listbox"');
    ['Todas', 'Mais recentes', 'Por empresa', 'A-Z'].forEach(o => expect(html).toContain(`>${o}</li>`));
  });
  test('modais são <dialog> com showModal e campos com label', () => {
    expect(html.match(/<dialog /g)).toHaveLength(2);
    expect(html).toContain('.showModal()');
    ['f-title', 'f-company', 'f-level', 'f-location', 'f-expires'].forEach(id =>
      expect(html).toContain(`for="${id}"`));
  });
  test('dados do banco passam por escapeHtml e sem onclick inline', () => {
    expect(html).toContain('/js/escape-html.js');
    expect(html).toContain('escapeHtml(j.title)');
    expect(html.slice(html.indexOf('<main'))).not.toMatch(/onclick=/);
  });
});

describe('PATCH/DELETE /api/admin/jobs/:id', () => {
  const app = express();
  app.use(express.json());
  app.patch('/jobs/:id', adminController.updateJobStatus);
  app.delete('/jobs/:id', adminController.deleteJob);
  beforeEach(() => { db.query = jest.fn().mockResolvedValue([{ affectedRows: 1 }]); });

  test('{ active } continua funcionando como antes', async () => {
    const r = await request(app).patch('/jobs/3').send({ active: false });
    expect(r.status).toBe(200);
    expect(db.query).toHaveBeenCalledWith('UPDATE jobs SET active = ?, closed_at = COALESCE(closed_at, NOW()) WHERE id = ?', [0, 3]);
  });
  test('edição completa monta o UPDATE só com os campos enviados', async () => {
    const r = await request(app).patch('/jobs/3')
      .send({ title: ' Vaga Nova ', company: 'Azyra', level: 'pleno', location: 'RJ', expires_at: '2026-12-14' });
    expect(r.status).toBe(200);
    const [sql, values] = db.query.mock.calls[0];
    expect(sql).toBe('UPDATE jobs SET title = ?, company = ?, level = ?, location = ?, expires_at = ? WHERE id = ?');
    expect(values).toEqual(['Vaga Nova', 'Azyra', 'pleno', 'RJ', '2026-12-14', 3]);
  });
  test.each([
    [{ title: 'ab' }], [{ level: 'senior' }], [{ expires_at: '14/12/2026' }], [{}], [{ company: 'x'.repeat(101) }],
  ])('rejeita payload inválido %j com 400', async (body) => {
    const r = await request(app).patch('/jobs/3').send(body);
    expect(r.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });
  test('expires_at vazio limpa a data', async () => {
    await request(app).patch('/jobs/3').send({ expires_at: '' });
    expect(db.query.mock.calls[0][1]).toEqual([null, 3]);
  });
  test('DELETE remove a vaga; 404 se não existe; 400 com id inválido', async () => {
    expect((await request(app).delete('/jobs/3')).status).toBe(200);
    db.query.mockResolvedValue([{ affectedRows: 0 }]);
    expect((await request(app).delete('/jobs/3')).status).toBe(404);
    expect((await request(app).delete('/jobs/abc')).status).toBe(400);
  });
});

describe('admin-vaga.ejs (detalhe da vaga)', () => {
  const job = {
    id: 4, title: 'Estágio em <b>Dev</b>', company: 'Azyra', location: 'Rio de Janeiro - RJ', modality: 'hibrido',
    tags: 'Vaga inclusiva', level: 'estagio', contract_type: 'estagio', active: 1, created_at: new Date('2026-10-15T15:00:00Z'),
    expires_day: '2026-12-14', total_candidaturas: 18, description: 'Texto da vaga', responsibilities: 'Resp',
    benefits: 'Bolsa', salary_min: 1800, salary_max: 2500, english_level: 'intermediario', years_experience: 0,
  };
  const skills = [{ name: 'React', importance: 'obrigatoria' }, { name: 'Git', importance: 'desejavel' }];
  let html;
  beforeAll(async () => {
    html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin-vaga.ejs'),
      { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-vagas', job, skills });
  });
  test('um main, um h1 e headings em ordem (h1 → h2)', () => {
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/<h3\b/);
  });
  test('mostra datas, chips, salário e voltar para a lista', () => {
    expect(html).toContain('Publicada em 15 de outubro de 2026');
    expect(html).toContain('Inscrições até 14 de dezembro de 2026');
    expect(html).toContain('Vaga inclusiva');
    expect(html).toMatch(/R\$\s?1\.800\s–\sR\$\s?2\.500/);
    expect(html).toContain('href="/admin/vagas" class="adj-back"');
  });
  test('header do admin com "Vagas" como página atual', () => {
    expect(html).toMatch(/href="\/admin\/vagas"\s+class="header-link is-active"/);
  });
  test('conteúdo do banco é escapado e admin não vê candidatar/match', () => {
    expect(html).toContain('Estágio em &lt;b&gt;Dev&lt;/b&gt;');
    expect(html).not.toContain('<b>Dev</b>');
    expect(html).not.toMatch(/Candidatar-se|Seu match/);
  });
  test('lista: o olho leva ao detalhe da vaga', async () => {
    const list = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin-vagas.ejs'),
      { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-vagas' });
    expect(list).toContain('href="/admin/vagas/${Number(j.id)}"');
    expect(list).not.toContain('data-act="toggle"');
  });
});
