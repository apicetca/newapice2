// tests/arrumacaoMatch.test.js
// Etapa 8 da análise de perfil (docs/analise-perfil-plano.md):
//  1. fórmula única — calculateJobMatch dá sempre o mesmo número que computeMatch
//     (visão do dev = visão da empresa), e NIVEL_ORDER vive num lugar só;
//  2. cache da explicação só vale se o percentual guardado = match de agora;
//  3. gap de conta sem GitHub considera as skills declaradas.
jest.mock("../database/db", () => ({ query: jest.fn(), getConnection: jest.fn(), ready: Promise.resolve() }));
jest.mock("../services/geminiClient", () => ({ askGeminiJSON: jest.fn() }));

const fs = require("fs");
const path = require("path");
const db = require("../database/db");
const { askGeminiJSON } = require("../services/geminiClient");
const { calculateJobMatch, computeMatch, getMatchExplanation } = require("../services/matchCalculator");
const { montarGap } = require("../services/roadmapService");
const { NIVEL_ORDER, LEVEL_ORDER } = require("../services/niveis");

beforeEach(() => jest.clearAllMocks());

// ── 1. Fórmula única ──────────────────────────────────────────────
describe("calculateJobMatch × computeMatch (mesmo número nas duas visões)", () => {
  const JOB_SKILLS = [
    { skill_id: 1, importance: "obrigatoria", learn_order: 1, name: "JavaScript", type: "hard" },
    { skill_id: 2, importance: "obrigatoria", learn_order: 2, name: "React", type: "hard" },
    { skill_id: 3, importance: "desejavel",   learn_order: 3, name: "SQL", type: "hard" },
    { skill_id: 4, importance: "desejavel",   learn_order: 4, name: "Git", type: "hard" },
  ];

  function fakeDb(userSkills, jobLevel) {
    db.query.mockImplementation(async (sql) => {
      const s = sql.toLowerCase();
      if (s.includes("from job_skills")) return [JOB_SKILLS];
      if (s.includes("from user_skills")) return [userSkills];
      if (s.includes("from jobs")) return [[{ level: jobLevel }]];
      throw new Error(`fakeDb: rota não mapeada: ${sql}`);
    });
  }

  const CONFIANCAS = [
    [],
    [{ skill_id: 1, confidence: 80 }, { skill_id: 2, confidence: 80 }, { skill_id: 4, confidence: 70 }],
    [{ skill_id: 1, confidence: 100 }, { skill_id: 2, confidence: 100 }, { skill_id: 3, confidence: 100 }, { skill_id: 4, confidence: 100 }],
    [{ skill_id: 3, confidence: 33 }],
  ];
  const NIVEIS = [undefined, "iniciante", "intermediario", "avancado"];
  const LEVELS = ["estagio", "junior", "pleno", null];

  const casos = [];
  for (const c of CONFIANCAS) for (const n of NIVEIS) for (const l of LEVELS) casos.push([c, n, l]);

  test.each(casos)("skills %j, nível %s, vaga %s", async (userSkills, nivel, jobLevel) => {
    fakeDb(userSkills, jobLevel);
    const r = await calculateJobMatch(42, 10, nivel ? { nivel } : {});
    const mapa = Object.fromEntries(userSkills.map(u => [u.skill_id, u.confidence]));
    expect(r.match).toBe(computeMatch(mapa, JOB_SKILLS, nivel, jobLevel));
    expect(r.readyFor).toBe(r.match >= 70);
  });

  test("exemplo do doc continua 64 pelos dois caminhos", async () => {
    fakeDb([{ skill_id: 1, confidence: 80 }, { skill_id: 2, confidence: 80 }, { skill_id: 4, confidence: 70 }], "junior");
    const r = await calculateJobMatch(42, 10, { nivel: "iniciante" });
    expect(r).toMatchObject({ match: 64, scores: { skills: 65, seniority: 55 } });
  });

  test("sem nível do dev não consulta o level da vaga", async () => {
    fakeDb([], "pleno");
    await calculateJobMatch(42, 10, {});
    expect(db.query.mock.calls.some(([sql]) => /from jobs\b/i.test(sql))).toBe(false);
  });

  test("os pesos 0.85/0.15 só existem em computeMatch", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "services", "matchCalculator.js"), "utf8");
    expect(src.match(/0\.85/g)).toHaveLength(1);
    expect(src.match(/0\.15/g)).toHaveLength(1);
  });

  test("NIVEL_ORDER e LEVEL_ORDER vêm de services/niveis.js (sem cópias)", () => {
    expect(NIVEL_ORDER).toEqual({ iniciante: 0, intermediario: 1, avancado: 2 });
    expect(LEVEL_ORDER).toEqual({ estagio: 0, junior: 1, pleno: 2 });
    for (const arq of ["matchCalculator.js", "roadmapService.js"]) {
      const src = fs.readFileSync(path.join(__dirname, "..", "services", arq), "utf8");
      expect(src).not.toMatch(/const\s+NIVEL_ORDER\s*=\s*\{/);
      expect(src).toMatch(/require\("\.\/niveis"\)/);
    }
  });
});

// ── 2. Cache da explicação ────────────────────────────────────────
describe("getMatchExplanation — cache só vale com o mesmo percentual", () => {
  const JOB_SKILLS = [{ skill_id: 1, importance: "obrigatoria", learn_order: 1, name: "Python", type: "hard" }];

  function fakeDb({ confianca, cache }) {
    db.query.mockImplementation(async (sql) => {
      const s = sql.toLowerCase();
      if (s.includes("from job_skills")) return [JOB_SKILLS];
      if (s.includes("from user_skills")) return [[{ skill_id: 1, confidence: confianca }]];
      if (s.includes("from match_ia_cache")) return [[cache].filter(Boolean)];
      if (s.includes("insert into match_ia_cache")) return [{}];
      throw new Error(`fakeDb: rota não mapeada: ${sql}`);
    });
  }
  const gravacoesCache = () => db.query.mock.calls.filter(([sql]) => /insert into match_ia_cache/i.test(sql));

  test("percentual guardado igual ao match de agora → usa o cache, sem chamar a IA", async () => {
    fakeDb({ confianca: 60, cache: { percentual: 66, explicacao: "explicação antiga" } }); // match = round(0,85×60 + 15) = 66
    const r = await getMatchExplanation(42, 10);
    expect(r).toEqual({ percentual_ia: 66, explicacao: "explicação antiga" });
    expect(askGeminiJSON).not.toHaveBeenCalled();
    expect(gravacoesCache()).toHaveLength(0);
  });

  test("percentual diferente (o dev mudou uma skill) → nova explicação, substituindo a antiga", async () => {
    fakeDb({ confianca: 100, cache: { percentual: 66, explicacao: "explicação antiga" } }); // match agora = 100
    askGeminiJSON.mockResolvedValue({ percentual_ia: 97, explicacao: "explicação nova" });
    const r = await getMatchExplanation(42, 10);
    expect(askGeminiJSON).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ percentual_ia: 100, explicacao: "explicação nova" });
    const [[sql, params]] = gravacoesCache();
    expect(sql).toMatch(/ON DUPLICATE KEY UPDATE/i);
    expect(params).toEqual([42, 10, 100, "explicação nova"]); // guarda o percentual CALCULADO
  });

  test("sem cache → gera e guarda o percentual calculado", async () => {
    fakeDb({ confianca: 60, cache: null });
    askGeminiJSON.mockResolvedValue({ percentual_ia: 55, explicacao: "primeira" });
    const r = await getMatchExplanation(42, 10);
    expect(r.percentual_ia).toBe(66);
    expect(gravacoesCache()[0][1][2]).toBe(66);
  });

  test("a explicação compara com o match que considera o nível do dev", async () => {
    // vaga pleno, dev iniciante: skills 100 → match = round(85 + 1,5) = 87
    db.query.mockImplementation(async (sql) => {
      const s = sql.toLowerCase();
      if (s.includes("from job_skills")) return [JOB_SKILLS];
      if (s.includes("from user_skills")) return [[{ skill_id: 1, confidence: 100 }]];
      if (s.includes("from jobs")) return [[{ level: "pleno" }]];
      if (s.includes("from match_ia_cache")) return [[{ percentual: 87, explicacao: "ok" }]];
      throw new Error(`fakeDb: rota não mapeada: ${sql}`);
    });
    const r = await getMatchExplanation(42, 10, { nivel: "iniciante" });
    expect(r).toEqual({ percentual_ia: 87, explicacao: "ok" });
    expect(askGeminiJSON).not.toHaveBeenCalled();
  });

  test("a rota da explicação passa o nível do dev (mesmo match da página da vaga)", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "routes", "ai.js"), "utf8");
    expect(src).toMatch(/getMatchExplanation\(githubId, jobId, \{ nivel: req\.session\.user\.nivel \}\)/);
  });
});

// ── 3. Gap sem GitHub ─────────────────────────────────────────────
describe("montarGap — conta sem github_id", () => {
  function fakeDb({ githubId }) {
    db.query.mockImplementation(async (sql, params = []) => {
      const s = sql.toLowerCase();
      if (s.includes("from user_dev_profiles")) return [[{ github_id: githubId, nivel: "iniciante" }]];
      if (s.includes("from user_skills")) {
        // skills declaradas gravadas com o id interno (getUserId: github_id ?? user.id)
        return [params[0] === 7 ? [{ skill_id: 1, confidence: 85 }] : []];
      }
      if (s.includes("from job_skills")) return [[{ skill_id: 1, importance: "obrigatoria", habilidade: "JavaScript" }]];
      throw new Error(`fakeDb: rota não mapeada: ${sql}`);
    });
  }

  test("sem github_id, usa o id interno e considera as skills declaradas", async () => {
    fakeDb({ githubId: null });
    const gap = await montarGap(7, { tipo: "vaga", vagaId: 10 });
    expect(gap.requisitos[0]).toMatchObject({ nivel_atual: "avancado", tem_gap: false });
    const consulta = db.query.mock.calls.find(([sql]) => /from user_skills/i.test(sql));
    expect(consulta[1]).toEqual([7]);
  });

  test("com github_id, continua usando o github_id", async () => {
    fakeDb({ githubId: 999 });
    const gap = await montarGap(7, { tipo: "vaga", vagaId: 10 });
    expect(gap.requisitos[0]).toMatchObject({ nivel_atual: null, tem_gap: true });
    const consulta = db.query.mock.calls.find(([sql]) => /from user_skills/i.test(sql));
    expect(consulta[1]).toEqual([999]);
  });

  test("sem perfil de dev nenhum, usa o id interno", async () => {
    db.query.mockImplementation(async (sql, params = []) => {
      const s = sql.toLowerCase();
      if (s.includes("from user_dev_profiles")) return [[]];
      if (s.includes("from user_skills")) return [[]];
      if (s.includes("from job_skills")) return [[{ skill_id: 1, importance: "obrigatoria", habilidade: "JavaScript" }]];
      throw new Error(`fakeDb: rota não mapeada: ${sql}`);
    });
    const gap = await montarGap(7, { tipo: "vaga", vagaId: 10 });
    expect(gap.requisitos[0].tem_gap).toBe(true);
    const consulta = db.query.mock.calls.find(([sql]) => /from user_skills/i.test(sql));
    expect(consulta[1]).toEqual([7]);
  });
});
