// tests/autodiagnostico.test.js
// Etapa 7 da análise de perfil — autodiagnóstico com nível por skill
// (docs/analise-perfil-plano.md), opção B: a declaração do dev fica em
// user_skill_declaracoes e serve de piso; a parte detectada no GitHub vem das
// evidências. Em user_skills vale a maior, com source = origem desse valor.
jest.mock("../database/db", () => ({ query: jest.fn(), getConnection: jest.fn() }));
jest.mock("../services/subscriptionService", () => ({ getUserPlan: jest.fn() }));
jest.mock("../services/githubAnalyzer", () => ({ analisarGitHub: jest.fn() }));

const fs = require("fs");
const path = require("path");
const db = require("../database/db");
const { addSkill, removeSkill } = require("../controllers/profileController");
const { combinar, CONFIANCA_POR_NIVEL } = require("../services/skillOrigem");

const GITHUB_ID = 42;

// Banco fake: estado em memória das três tabelas de um dev.
function instalarBanco({ linha = null, declaracao = null, detectada = 0, semTabelas = false } = {}) {
  const estado = { linha, declaracao, detectada };
  const semTabela = () => { const e = new Error("no table"); e.code = "ER_NO_SUCH_TABLE"; return e; };
  const query = jest.fn(async (sql, params = []) => {
    const s = sql.replace(/\s+/g, " ").trim().toLowerCase();
    if (s.startsWith("select id, name from skills")) return [[{ id: Number(params[0]), name: "Docker" }]];
    if (s.includes("user_skill_declaracoes")) {
      if (semTabelas) throw semTabela();
      if (s.startsWith("insert")) { estado.declaracao = { nivel: params[2], confidence: params[3] }; return [{}]; }
      if (s.startsWith("delete")) { const tinha = !!estado.declaracao; estado.declaracao = null; return [{ affectedRows: tinha ? 1 : 0 }]; }
    }
    if (s.includes("from user_skill_evidencias")) {
      if (semTabelas) throw semTabela();
      return [[{ total: estado.detectada }]];
    }
    if (s.startsWith("select source, confidence from user_skills")) return [estado.linha ? [{ ...estado.linha }] : []];
    if (s.startsWith("insert into user_skills")) { estado.linha = { source: params[2], confidence: params[3] }; return [{}]; }
    if (s.startsWith("update user_skills")) { estado.linha = { source: "github", confidence: params[0] }; return [{}]; }
    if (s.startsWith("delete from user_skills")) { estado.linha = null; return [{}]; }
    throw new Error(`fakeDb: rota não mapeada: ${sql}`);
  });
  const conn = {
    query,
    beginTransaction: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    release: jest.fn(),
  };
  db.query.mockImplementation(query);
  db.getConnection.mockResolvedValue(conn);
  return { estado, conn };
}

function resposta() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const sessao = { user: { id: 1, github_id: GITHUB_ID, type: "dev" } };
const adicionar = async (body) => { const res = resposta(); await addSkill({ session: sessao, body }, res); return res; };
const remover = async (skillId) => { const res = resposta(); await removeSkill({ session: sessao, params: { skillId } }, res); return res; };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("combinar (detectada × declarada)", () => {
  test.each([
    [0, 30, { confidence: 30, source: "manual" }],
    [60, 30, { confidence: 60, source: "github" }],
    [20, 85, { confidence: 85, source: "manual" }],
    [60, 60, { confidence: 60, source: "github" }], // empate: github
    [40, 0, { confidence: 40, source: "github" }],
    [0, 0, null],
  ])("detectada %i, declarada %i → %j", (d, m, esperado) => {
    expect(combinar(d, m)).toEqual(esperado);
  });

  test("níveis viram confianças dentro das faixas de confidenceToNivel", () => {
    expect(CONFIANCA_POR_NIVEL).toEqual({ iniciante: 30, intermediario: 60, avancado: 85 });
  });
});

describe("POST /api/user/skills (addSkill) com nível", () => {
  test.each([
    ["iniciante", 30],
    ["intermediario", 60],
    ["avancado", 85],
  ])("nível %s → declaração e confiança %i (sem nada no GitHub)", async (nivel, conf) => {
    const { estado, conn } = instalarBanco();
    const res = await adicionar({ skill_id: 5, nivel });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, nivel, confidence: conf, source: "manual" });
    expect(estado.declaracao).toEqual({ nivel, confidence: conf });
    expect(estado.linha).toEqual({ source: "manual", confidence: conf });
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  test("sem nível informado → intermediário (60), compatível com o cliente antigo", async () => {
    instalarBanco();
    const res = await adicionar({ skill_id: 5 });
    expect(res.body).toMatchObject({ nivel: "intermediario", confidence: 60 });
  });

  test("nível inválido → 400", async () => {
    instalarBanco();
    const res = await adicionar({ skill_id: 5, nivel: "guru" });
    expect(res.statusCode).toBe(400);
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  test("declarada iniciante (30) em skill que o GitHub detectou com 60 → 60, source github", async () => {
    const { estado } = instalarBanco({ linha: { source: "github", confidence: 60 }, detectada: 60 });
    const res = await adicionar({ skill_id: 5, nivel: "iniciante" });
    expect(res.body).toMatchObject({ confidence: 60, source: "github" });
    expect(estado.linha).toEqual({ source: "github", confidence: 60 });
    expect(estado.declaracao).toEqual({ nivel: "iniciante", confidence: 30 }); // a declaração fica guardada
  });

  test("declarada avançado (85) em skill que o GitHub detectou com 20 → 85, source manual", async () => {
    const { estado } = instalarBanco({ linha: { source: "github", confidence: 20 }, detectada: 20 });
    const res = await adicionar({ skill_id: 5, nivel: "avancado" });
    expect(res.body).toMatchObject({ confidence: 85, source: "manual" });
    expect(estado.linha).toEqual({ source: "manual", confidence: 85 });
  });

  test("rebaixar a própria declaração (85 → 30) reduz o número quando o GitHub não detectou", async () => {
    const { estado } = instalarBanco({ linha: { source: "manual", confidence: 85 }, declaracao: { nivel: "avancado", confidence: 85 } });
    await adicionar({ skill_id: 5, nivel: "iniciante" });
    expect(estado.linha).toEqual({ source: "manual", confidence: 30 });
  });

  test("erro no meio faz rollback", async () => {
    const { conn } = instalarBanco();
    const original = conn.query.getMockImplementation();
    conn.query.mockImplementation(async (sql, p) => {
      if (/insert into user_skills/i.test(sql)) throw new Error("falhou");
      return original(sql, p);
    });
    const res = await adicionar({ skill_id: 5, nivel: "avancado" });
    expect(res.statusCode).toBe(500);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  test("sem as tabelas novas (migração não rodada): grava em user_skills mesmo assim", async () => {
    const { estado } = instalarBanco({ semTabelas: true });
    const res = await adicionar({ skill_id: 5, nivel: "avancado" });
    expect(res.statusCode).toBe(200);
    expect(estado.linha).toEqual({ source: "manual", confidence: 85 });
  });
});

describe("DELETE /api/user/skills/:id (removeSkill) remove a declaração", () => {
  test("skill só declarada → some do perfil", async () => {
    const { estado } = instalarBanco({ linha: { source: "manual", confidence: 85 }, declaracao: { nivel: "avancado", confidence: 85 } });
    const res = await remover(5);
    expect(res.body).toEqual({ success: true, restante: null });
    expect(estado.linha).toBeNull();
    expect(estado.declaracao).toBeNull();
  });

  test("skill declarada que o GitHub também detectou → fica com o valor detectado (github)", async () => {
    const { estado } = instalarBanco({ linha: { source: "manual", confidence: 85 }, declaracao: { nivel: "avancado", confidence: 85 }, detectada: 40 });
    const res = await remover(5);
    expect(res.body).toEqual({ success: true, restante: { source: "github", confidence: 40 } });
    expect(estado.linha).toEqual({ source: "github", confidence: 40 });
  });

  test("skill manual antiga (sem declaração registrada) pode ser removida", async () => {
    const { estado } = instalarBanco({ linha: { source: "manual", confidence: 70 } });
    const res = await remover(5);
    expect(res.statusCode).toBe(200);
    expect(estado.linha).toBeNull();
  });

  test("skill só detectada no GitHub não pode ser removida → 400, nada muda", async () => {
    const { estado, conn } = instalarBanco({ linha: { source: "github", confidence: 60 }, detectada: 60 });
    const res = await remover(5);
    expect(res.statusCode).toBe(400);
    expect(estado.linha).toEqual({ source: "github", confidence: 60 });
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });
});

describe("selos e link do autodiagnóstico nas views", () => {
  const ler = (...p) => fs.readFileSync(path.join(__dirname, "..", "views", ...p), "utf8");

  test("perfil do dev: selos 'declarada' e 'detectada no GitHub' e seletor de nível", () => {
    const v = ler("perfil-dev.ejs");
    expect(v).toContain('"detectada no GitHub"');
    expect(v).toContain('"declarada"');
    expect(v).toMatch(/id="skill-nivel"/);
    expect(v).toMatch(/nivel: \$\("skill-nivel"\)\.value/);
  });

  test("telas da empresa mostram os selos (e escapam o nome da skill)", () => {
    const lista = ler("empresa-desenvolvedores.ejs");
    expect(lista).toMatch(/\$\{escapeHtml\(s\)\}<span class="skill-origem/);
    expect(lista).toContain("detectada no GitHub");
    const perfil = ler("perfil-dev-empresa.ejs");
    expect(perfil).toMatch(/s\.source === "manual" \? "declarada" : "detectada no GitHub"/);
  });

  test("/trilha/novo sem skills tem o link 'Fazer autodiagnóstico' para /perfil", () => {
    const v = ler("roadmap", "novo.ejs");
    expect(v).toMatch(/<a href="\/perfil[^"]*">Fazer autodiagnóstico<\/a>/);
  });
});
