// tests/mentorContexto.test.js
// buildMentorContext (services/userContextService.js): o resumo dos dados do
// usuário que vai no prompt do Mentor a cada pergunta — roadmap e progresso,
// skills, repositórios e candidaturas, sem e-mail, senha ou pagamento.
//
// O banco é sempre simulado: o .env local aponta para o banco de produção.
jest.mock("../database/db", () => ({ query: jest.fn() }));
jest.mock("../services/subscriptionService", () => ({
  getUserPlan: jest.fn().mockResolvedValue({ code: "dev_pro", name: "PRO", mp_preapproval_id: "pagamento-secreto" }),
}));

const db = require("../database/db");
const { buildMentorContext } = require("../services/userContextService");

const USER = { id: 1, github_id: 123 };
const EMAIL = "ana@exemplo.com";

// Fake do banco por trecho de SQL. As linhas trazem colunas sensíveis de
// propósito (email, senha...) para provar que o resumo não as repassa.
function instalarFakeDb(d = {}) {
  db.query.mockImplementation(async (sql, params) => {
    const s = sql.replace(/\s+/g, " ").trim();
    if (d.falhar && s.includes(d.falhar)) throw new Error("banco fora do ar");
    if (s.includes("FROM user_dev_profiles")) return [[{ nivel: "iniciante", email: EMAIL, password_hash: "hash" }]];
    if (s.includes("FROM user_skills")) return [d.skills ?? []];
    if (s.startsWith("SELECT COUNT(*) AS total, COALESCE(SUM(is_public = 1), 0) AS visiveis")) return [[d.repoContagem ?? { total: 0, visiveis: "0" }]];
    if (s.includes("FROM user_repositories")) return [d.repos ?? []];
    if (s.includes("FROM roadmaps r")) return [d.roadmaps ?? []];
    if (s.includes("FROM roadmap_fases")) return [d.fases ?? []];
    if (s.includes("FROM roadmap_etapas")) return [d.etapas ?? []];
    if (s.startsWith("SELECT COUNT(*) AS total FROM job_applications")) return [[{ total: (d.candidaturas ?? []).length }]];
    if (s.includes("FROM job_applications ja")) return [(d.candidaturas ?? []).slice(0, params[1])];
    throw new Error(`fakeDb: consulta não mapeada: ${s}`);
  });
}

const ROADMAP_COMPLETO = {
  roadmaps: [
    { id: 7, tipo_objetivo: "area", area: "back-end", horas_semana: 10, status: "ativo", origem: "ia", vaga_titulo: null },
    { id: 3, tipo_objetivo: "vaga", area: null, horas_semana: 5, status: "arquivado", origem: "modelo", vaga_titulo: "Estágio Front" },
  ],
  fases: [
    { id: 70, nome: "Fundamentos de back-end", projeto_status: "verificado" },
    { id: 71, nome: "APIs com Node", projeto_status: "pendente" },
  ],
  etapas: [
    { fase_id: 70, titulo: "HTTP e REST", habilidade: "HTTP", horas_estimadas: 4, status: "concluida" },
    { fase_id: 70, titulo: "SQL básico", habilidade: "SQL", horas_estimadas: 6, status: "concluida" },
    { fase_id: 71, titulo: "Express do zero", habilidade: "Express", horas_estimadas: 8, status: "pendente" },
    { fase_id: 71, titulo: "Rotas e middlewares", habilidade: "Express", horas_estimadas: 5, status: "em_andamento" },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("roadmap ativo: objetivo, progresso, fases com o projeto e as próximas etapas", async () => {
  instalarFakeDb(ROADMAP_COMPLETO);
  const texto = await buildMentorContext(USER);

  expect(texto).toMatch(/^DADOS DO USUÁRIO/);
  expect(texto).toMatch(/Roadmap ativo: área back-end · 10h\/semana · montado pela IA · 50% concluído \(2 de 4 etapas\)/);
  expect(texto).toMatch(/1\. Fundamentos de back-end — 100% \(2\/2 etapas\) · projeto verificado/);
  expect(texto).toMatch(/2\. APIs com Node — 0% \(0\/2 etapas\) · projeto pendente/);
  // a em andamento vem antes da pendente
  expect(texto).toMatch(/Próximas etapas: "Rotas e middlewares" \(Express, ~5h, em andamento\); "Express do zero" \(Express, ~8h, pendente\)/);
  expect(texto).toMatch(/Outros roadmaps: 0 ativos, 1 arquivado\./);
});

test("sem roadmap: diz que não há nenhum (o prompt manda explicar como criar)", async () => {
  instalarFakeDb({});
  const texto = await buildMentorContext(USER);
  expect(texto).toMatch(/Roadmap: nenhum criado ainda\./);
});

test("só roadmaps arquivados: nenhum ativo", async () => {
  instalarFakeDb({ roadmaps: [{ ...ROADMAP_COMPLETO.roadmaps[1] }] });
  expect(await buildMentorContext(USER)).toMatch(/Roadmap: nenhum ativo \(1 arquivado\)\./);
});

test("nível, plano, skills, repositórios e candidaturas", async () => {
  instalarFakeDb({
    skills: [{ name: "JavaScript", type: "hard", confidence: 80 }, { name: "SQL", type: "hard", confidence: 40 }],
    repoContagem: { total: 3, visiveis: "2" },
    repos: [{ repo_name: "api-node", language: "JavaScript", description: "API REST de tarefas", ai_description: null }],
    candidaturas: [{ title: "Estágio Back-end", company: "Stone", created_at: "2026-11-05T12:00:00Z" }],
  });
  const texto = await buildMentorContext(USER);

  expect(texto).toMatch(/Nível: iniciante · Plano: PRO/);
  expect(texto).toMatch(/Skills \(análise do perfil, com a confiança\): JavaScript 80%, SQL 40%/);
  expect(texto).toMatch(/Repositórios no perfil: 3 \(2 visíveis no perfil público\)\. Visíveis: api-node \(JavaScript\): API REST de tarefas/);
  expect(texto).toMatch(/Candidaturas: 1 — mais recentes: Estágio Back-end \(Stone, 05\/11\/2026\)/);
});

test("nunca leva e-mail, senha ou dado de pagamento", async () => {
  instalarFakeDb(ROADMAP_COMPLETO);
  const texto = await buildMentorContext(USER);

  expect(texto).not.toMatch(new RegExp(EMAIL));
  expect(texto).not.toMatch(/hash|senha|password|pagamento-secreto|preapproval/i);
  for (const [sql] of db.query.mock.calls) expect(sql).not.toMatch(/email|password|senha|preapproval|card/i);
});

test("uma consulta que falha não derruba o resto do resumo", async () => {
  instalarFakeDb({ ...ROADMAP_COMPLETO, falhar: "FROM roadmaps r" });
  const texto = await buildMentorContext(USER);

  expect(texto).not.toMatch(/Roadmap/);
  expect(texto).toMatch(/Nível: iniciante/);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining("resumo do mentor"), "banco fora do ar");
});
