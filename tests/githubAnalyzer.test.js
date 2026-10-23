// tests/githubAnalyzer.test.js
// Rede de segurança (Etapa 1 do plano de melhorias da análise de perfil):
// registra como matchSkillsFromGitHub pontua HOJE (docs/analise-perfil.md,
// seção 1), com a API do GitHub e o banco mockados.
jest.mock("axios", () => ({ get: jest.fn() }));
jest.mock("../database/db", () => ({ query: jest.fn() }));

const axios = require("axios");
const db = require("../database/db");
const { matchSkillsFromGitHub } = require("../services/githubAnalyzer");

const TOKEN = "token-de-teste";
const GITHUB_ID = 42;

// repos: { "dono/repo": { languages: {JavaScript: 123}, readme: "texto" | null, languagesErro, readmeErro } }
function instalarFakeGitHub(repos) {
  axios.get.mockImplementation(async (url) => {
    const m = url.match(/repos\/(.+)\/(languages|readme)$/);
    if (!m) throw new Error(`fakeGitHub: URL não mapeada: ${url}`);
    const [, nome, recurso] = m;
    const repo = repos[nome];
    if (!repo) throw new Error("404");
    if (recurso === "languages") {
      if (repo.languagesErro) throw new Error("API fora");
      return { data: repo.languages ?? {} };
    }
    if (repo.readmeErro || repo.readme == null) throw new Error("404");
    return { data: repo.readme };
  });
}

function instalarFakeDb(skills) {
  db.query.mockImplementation(async (sql) => {
    if (/from skills/i.test(sql)) return [skills];
    if (/insert into user_skills/i.test(sql)) return [{}];
    throw new Error(`fakeDb: rota não mapeada: ${sql}`);
  });
}

const gravacoes = () =>
  db.query.mock.calls
    .filter(([sql]) => /insert into user_skills/i.test(sql))
    .map(([, params]) => ({ githubId: params[0], skillId: params[1], confidence: params[2] }));

const repoList = (...nomes) => nomes.map((full_name) => ({ full_name }));

beforeEach(() => jest.clearAllMocks());

describe("matchSkillsFromGitHub — exemplo da seção 1 do doc (React = 80)", () => {
  test("3 repositórios: 40 + 40 + 0 → 80, e grava source github", async () => {
    instalarFakeDb([{ id: 7, github_signals: "react, reactjs, jsx, tsx" }]);
    instalarFakeGitHub({
      "u/loja-front":  { languages: { JavaScript: 1, CSS: 1 }, readme: "Feito com React e JSX" },
      "u/portfolio":   { languages: { TypeScript: 1, HTML: 1 }, readme: "usei reactjs" },
      "u/api-tarefas": { languages: { JavaScript: 1 }, readme: "API em Node" },
    });

    const detectadas = await matchSkillsFromGitHub(TOKEN, GITHUB_ID, repoList("u/loja-front", "u/portfolio", "u/api-tarefas"));

    expect(detectadas).toEqual([{ skill_id: 7, confidence: 80 }]);
    expect(gravacoes()).toEqual([{ githubId: GITHUB_ID, skillId: 7, confidence: 80 }]);
    const insert = db.query.mock.calls.find(([sql]) => /insert into user_skills/i.test(sql))[0];
    expect(insert).toMatch(/'github'/);
  });
});

describe("matchSkillsFromGitHub — regras de pontuação", () => {
  test("sinal nas linguagens do repositório vale +40", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({ "u/a": { languages: { Python: 10 }, readme: null } });
    const r = await matchSkillsFromGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(r).toEqual([{ skill_id: 1, confidence: 40 }]);
  });

  test("sinal no README vale +20 (busca por trecho, em minúsculas)", async () => {
    instalarFakeDb([{ id: 1, github_signals: "docker" }]);
    instalarFakeGitHub({ "u/a": { languages: {}, readme: "Rodando com DOCKER compose" } });
    const r = await matchSkillsFromGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(r).toEqual([{ skill_id: 1, confidence: 20 }]);
  });

  test("o sinal compara com o nome da linguagem de forma EXATA (java ≠ javascript)", async () => {
    instalarFakeDb([{ id: 1, github_signals: "java" }]);
    instalarFakeGitHub({ "u/a": { languages: { JavaScript: 10 }, readme: null } });
    const r = await matchSkillsFromGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(r).toEqual([]);
  });

  test("linguagem + README no mesmo sinal somam (+40 +20 = 60)", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({ "u/a": { languages: { Python: 10 }, readme: "projeto em python" } });
    const r = await matchSkillsFromGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(r).toEqual([{ skill_id: 1, confidence: 60 }]);
  });

  test("README casa por trecho: 'py' dentro de 'happy' pontua (limitação 1 do doc)", async () => {
    instalarFakeDb([{ id: 1, github_signals: "py" }]);
    instalarFakeGitHub({ "u/a": { languages: {}, readme: "happy path" } });
    const r = await matchSkillsFromGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(r).toEqual([{ skill_id: 1, confidence: 20 }]);
  });

  test("teto de 100 (vários repositórios somando mais que isso)", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({
      "u/a": { languages: { Python: 1 }, readme: null },
      "u/b": { languages: { Python: 1 }, readme: null },
      "u/c": { languages: { Python: 1 }, readme: null },
    });
    const r = await matchSkillsFromGitHub(TOKEN, GITHUB_ID, repoList("u/a", "u/b", "u/c"));
    expect(r).toEqual([{ skill_id: 1, confidence: 100 }]);
    expect(gravacoes()[0].confidence).toBe(100);
  });

  test("confiança 0 não grava nada em user_skills", async () => {
    instalarFakeDb([{ id: 1, github_signals: "rust" }]);
    instalarFakeGitHub({ "u/a": { languages: { Python: 1 }, readme: "sem nada relevante" } });
    const r = await matchSkillsFromGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(r).toEqual([]);
    expect(gravacoes()).toEqual([]);
  });

  test("só considera skills com github_signals (consulta filtra IS NOT NULL)", async () => {
    instalarFakeDb([]);
    instalarFakeGitHub({});
    await matchSkillsFromGitHub(TOKEN, GITHUB_ID, []);
    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/github_signals IS NOT NULL/i);
  });

  test("usa o token OAuth no cabeçalho Authorization das chamadas ao GitHub", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({ "u/a": { languages: { Python: 1 }, readme: null } });
    await matchSkillsFromGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    for (const [, opts] of axios.get.mock.calls) {
      expect(opts.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    }
  });
});

describe("matchSkillsFromGitHub — erros da API (comportamento atual, limitação 3 do doc)", () => {
  test("erro ao ler linguagens vira lista vazia: sem pontos de linguagem, README ainda conta", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({ "u/a": { languagesErro: true, readme: "python" } });
    const r = await matchSkillsFromGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(r).toEqual([{ skill_id: 1, confidence: 20 }]);
  });

  test("erro ao ler o README vira texto vazio: só as linguagens contam", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({ "u/a": { languages: { Python: 1 }, readmeErro: true } });
    const r = await matchSkillsFromGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(r).toEqual([{ skill_id: 1, confidence: 40 }]);
  });

  test("API fora do ar em tudo: nenhuma skill detectada e nada gravado, sem lançar erro", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    axios.get.mockRejectedValue(new Error("403 rate limit"));
    const r = await matchSkillsFromGitHub(TOKEN, GITHUB_ID, repoList("u/a", "u/b"));
    expect(r).toEqual([]);
    expect(gravacoes()).toEqual([]);
  });
});
