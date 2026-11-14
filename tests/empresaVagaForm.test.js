// tests/empresaVagaForm.test.js
// Novo formulário de vaga da empresa: campos Área e Língua Estrangeira/Nível
// (colunas novas em jobs), validação no servidor, gravação pelo controller e
// o próprio formulário renderizado (3 seções: Informações Gerais, Parâmetros de
// Match e Adicionais).
jest.mock("../database/db", () => ({ query: jest.fn(), ready: Promise.resolve() }));
jest.mock("../services/geminiClient", () => ({ askGeminiJSON: jest.fn() }));
jest.mock("../services/candidateSummarizer", () => ({ getOrGenerateSummary: jest.fn() }));
jest.mock("../services/subscriptionService", () => ({
  canCreateJob: jest.fn().mockResolvedValue(true),
  getUserPlan: jest.fn().mockResolvedValue({ code: "empresa_free", name: "Free", max_active_jobs: 1 }),
  getPlanCodesBulk: jest.fn().mockResolvedValue({}),
}));

const fs = require("fs");
const path = require("path");
const express = require("express");
const request = require("supertest");
const ejs = require("ejs");
const db = require("../database/db");
const controller = require("../controllers/empresaController");
const { validateCreateJob, validateUpdateJob } = require("../validators/job.validator");

const BASE = { title: "Estágio Front", level: "estagio" };

function appValidador(rules) {
  const app = express();
  app.use(express.json());
  app.post("/jobs", ...rules, (req, res) => res.json({ ok: true, body: req.body }));
  app.patch("/jobs/:id", ...rules, (req, res) => res.json({ ok: true }));
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe("validação — área e língua estrangeira", () => {
  const app = appValidador(validateCreateJob);

  test.each(["front-end", "back-end", "full-stack", "dados"])("aceita area '%s'", async (area) => {
    const res = await request(app).post("/jobs").send({ ...BASE, area });
    expect(res.status).toBe(200);
  });

  test("rejeita area desconhecida com 400 (e não 500 do banco)", async () => {
    const res = await request(app).post("/jobs").send({ ...BASE, area: "marketing" });
    expect(res.status).toBe(400);
  });

  test("aceita língua + nível; rejeita língua ou nível fora da lista", async () => {
    expect((await request(app).post("/jobs").send({ ...BASE, foreign_language: "espanhol", foreign_level: "avancado" })).status).toBe(200);
    expect((await request(app).post("/jobs").send({ ...BASE, foreign_language: "klingon" })).status).toBe(400);
    expect((await request(app).post("/jobs").send({ ...BASE, foreign_language: "ingles", foreign_level: "mestre" })).status).toBe(400);
  });

  test("campos novos são opcionais (formulário antigo continua valendo)", async () => {
    expect((await request(app).post("/jobs").send(BASE)).status).toBe(200);
  });

  test("o PATCH valida os mesmos campos", async () => {
    const patch = appValidador(validateUpdateJob);
    expect((await request(patch).patch("/jobs/1").send({ area: "dados" })).status).toBe(200);
    expect((await request(patch).patch("/jobs/1").send({ area: "x" })).status).toBe(400);
  });
});

describe("controller — grava área e língua", () => {
  function chamar(handler, body, params = {}) {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    const req = { session: { user: { id: 5, type: "empresa" } }, body, params };
    return handler(req, res).then(() => res);
  }

  test("createJob grava area, foreign_language e foreign_level; inglês também preenche english_level", async () => {
    db.query.mockImplementation(async (sql) => {
      if (/from user_company_profiles/i.test(sql)) return [[{ nome_fantasia: "Tech" }]];
      if (/insert into jobs/i.test(sql)) return [{ insertId: 77 }];
      throw new Error("rota não mapeada: " + sql);
    });

    const res = await chamar(controller.createJob, {
      ...BASE, area: "front-end", foreign_language: "ingles", foreign_level: "intermediario", english_level: "intermediario",
    });

    expect(res.statusCode).toBe(201);
    const [sql, params] = db.query.mock.calls.find(([s]) => /insert into jobs/i.test(s));
    expect(sql).toMatch(/\barea\b/);
    expect(sql).toMatch(/foreign_language/);
    expect(sql).toMatch(/foreign_level/);
    expect(params).toEqual(expect.arrayContaining(["front-end", "ingles", "intermediario"]));
    // número de "?" bate com o número de colunas
    const cols = sql.match(/\(([^)]*)\)\s*VALUES/is)[1].split(",").length;
    expect((sql.match(/VALUES\s*\(([^)]*)\)/is)[1].match(/\?/g) || []).length).toBe(cols);
    expect(params).toHaveLength(cols);
  });

  test("vaga sem os campos novos grava null neles", async () => {
    db.query.mockImplementation(async (sql) => {
      if (/from user_company_profiles/i.test(sql)) return [[{ nome_fantasia: "Tech" }]];
      if (/insert into jobs/i.test(sql)) return [{ insertId: 78 }];
      throw new Error("rota não mapeada: " + sql);
    });
    await chamar(controller.createJob, BASE);
    const [, params] = db.query.mock.calls.find(([s]) => /insert into jobs/i.test(s));
    expect(params.filter(p => p === null).length).toBeGreaterThanOrEqual(3);
  });

  test("updateJob aceita area/foreign_language/foreign_level", async () => {
    db.query.mockImplementation(async (sql) => {
      if (/select id, active, category_id from jobs/i.test(sql)) return [[{ id: 3, active: 1, category_id: null }]];
      if (/update jobs set/i.test(sql)) return [{ affectedRows: 1 }];
      throw new Error("rota não mapeada: " + sql);
    });
    const res = await chamar(controller.updateJob, { area: "dados", foreign_language: "espanhol", foreign_level: "basico" }, { id: "3" });
    expect(res.statusCode).toBe(200);
    const [sql, params] = db.query.mock.calls.find(([s]) => /update jobs set/i.test(s));
    expect(sql).toMatch(/area = \?/);
    expect(sql).toMatch(/foreign_language = \?/);
    expect(sql).toMatch(/foreign_level = \?/);
    expect(params).toEqual(expect.arrayContaining(["dados", "espanhol", "basico"]));
  });
});

describe("formulário renderizado", () => {
  const VIEWS = path.join(__dirname, "..", "views");
  const SKILLS = [
    { id: 1, name: "React", type: "hard", category: "Frontend" },
    { id: 2, name: "Comunicação", type: "soft", category: "Soft" },
  ];
  const render = (locals) => ejs.renderFile(path.join(VIEWS, "empresa-vaga-form.ejs"),
    { user: { type: "empresa", name: "Tech", email: "a@b.c" }, currentPage: "empresa-vagas", allSkills: SKILLS, jobSkills: [], job: null, isEdit: false, ...locals },
    { views: [VIEWS] });

  test("tem as 3 seções do layout, na ordem", async () => {
    const html = await render();
    const titulos = [...html.matchAll(/<h2 class="form-section-title">\s*([^<]+?)\s*</g)].map(m => m[1]);
    expect(titulos).toEqual(["Informações gerais", "Parâmetros de match", "Adicionais"]);
  });

  test("campos de 'Informações Gerais' e 'Adicionais'", async () => {
    const html = await render();
    for (const id of ["f-title", "f-area", "f-desc", "f-location", "f-resp", "f-level", "f-modality", "f-contract", "f-lang", "f-lang-level"]) {
      expect(html).toContain(`id="${id}"`);
    }
    const area = html.match(/<select[^>]*id="f-area"[\s\S]*?<\/select>/)[0];
    for (const v of ["front-end", "back-end", "full-stack", "dados"]) expect(area).toContain(`value="${v}"`);
  });

  test("'Parâmetros de Match': Skill, Tecnologias Conhecidas e Habilidades Gerais, com listbox acessível", async () => {
    const html = await render();
    for (const tipo of ["required", "desired", "soft"]) {
      expect(html).toMatch(new RegExp(`id="search-${tipo}"[^>]*aria-label="[^"]+"`));
      expect(html).toMatch(new RegExp(`id="dropdown-${tipo}"\\s+role="listbox"`));
    }
    expect(html).toMatch(/Tecnologias Conhecidas/);
    expect(html).toMatch(/Habilidades Gerais/);
  });

  test("campos fora do mockup ficam recolhidos em 'Mais detalhes' (não se perde funcionalidade)", async () => {
    const html = await render();
    const detalhes = html.match(/<details class="form-more"[\s\S]*?<\/details>/)[0];
    for (const id of ["f-sal-min", "f-sal-max", "f-exp", "f-maxcand", "f-benefits", "tag-input"]) {
      expect(detalhes).toContain(`id="${id}"`);
    }
    expect(detalhes).not.toMatch(/<details[^>]*\sopen/);
  });

  test("botão principal e rascunho", async () => {
    const html = await render();
    expect(html).toMatch(/id="btn-publish"[\s\S]*?Publicar vaga/);
    expect(html).toContain('id="btn-draft"');
    const edit = await render({ isEdit: true, job: { id: 9, title: "x", level: "junior" }, jobSkills: [] });
    expect(edit).toMatch(/id="btn-publish"[\s\S]*?Salvar alterações/);
  });

  test("edição: área, idioma, listas e skills (soft separadas das tecnologias) chegam preenchidos", async () => {
    const html = await render({
      isEdit: true,
      job: {
        id: 9, title: "Vaga", level: "pleno", area: "dados", modality: "hibrido", contract_type: "clt",
        foreign_language: "espanhol", foreign_level: "avancado", english_level: "nenhum",
        location: "São Paulo, SP; Curitiba, PR", responsibilities: "• Criar APIs\n• Revisar código",
      },
      jobSkills: [
        { skill_id: 1, importance: "obrigatoria", name: "React", type: "hard", category: "Frontend" },
        { skill_id: 2, importance: "desejavel", name: "Comunicação", type: "soft", category: "Soft" },
      ],
    });
    expect(html).toMatch(/<option value="dados"\s+selected/);
    expect(html).toMatch(/<option value="espanhol"\s+selected/);
    expect(html).toMatch(/<option value="avancado"\s+selected/);
    expect(html).toMatch(/let softSkills\s*=\s*\[\{"id":2/);
    expect(html).toMatch(/let desiredSkills\s*=\s*\[\]/);
    expect(html).toMatch(/let requiredSkills\s*=\s*\[\{"id":1/);
    expect(html).toContain('"São Paulo, SP"');
    expect(html).toContain('"Criar APIs"');
  });

  test("vaga antiga só com english_level aparece como Inglês + nível no formulário", async () => {
    const html = await render({
      isEdit: true, job: { id: 9, title: "V", level: "junior", english_level: "basico" }, jobSkills: [],
    });
    expect(html).toMatch(/<option value="ingles"\s+selected/);
    expect(html).toMatch(/<option value="basico"\s+selected/);
  });

  test("nenhum onclick inline com dados (CSP) e nada de innerHTML com string do usuário sem escape", async () => {
    const src = fs.readFileSync(path.join(VIEWS, "empresa-vaga-form.ejs"), "utf8");
    expect(src).not.toMatch(/onclick="[^"]*\$\{[^}]*\.replace\(\/'\/g/);
    expect(src).toContain("escape-html.js");
  });
});

describe("vaga pública mostra a língua estrangeira escolhida", () => {
  test("usa foreign_language quando existe e cai no inglês das vagas antigas", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "views", "vaga-publica.ejs"), "utf8");
    expect(src).toMatch(/function idiomaExigido\(job\)/);
    expect(src).toMatch(/job\.foreign_language/);
    expect((src.match(/idiomaExigido\(job\)/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});
