// tests/githubAnalyzer.test.js
// Rede de segurança (Etapa 1 do plano de melhorias da análise de perfil):
// registra como matchSkillsFromGitHub pontua HOJE (docs/analise-perfil.md,
// seção 1), com a API do GitHub e o banco mockados.
jest.mock("axios", () => ({ get: jest.fn() }));
jest.mock("../database/db", () => ({ query: jest.fn() }));

const axios = require("axios");
const db = require("../database/db");
const {
  matchSkillsFromGitHub, analisarGitHub, fetchRepoLanguages, fetchRepoReadme,
  verificarRepoPublico, verificarHabilidadesNoRepo, pontuarSkillNoRepo, aparecePalavraInteira,
} = require("../services/githubAnalyzer");
const fs = require("fs");
const path = require("path");

const TOKEN = "token-de-teste";
const GITHUB_ID = 42;

// Erro no formato do axios: com resposta HTTP (status) ou sem resposta (rede/timeout).
function erroHttp(status, extra = {}) {
  const err = new Error(`HTTP ${status}`);
  err.isAxiosError = true;
  err.response = { status, headers: {}, data: {}, ...extra };
  return err;
}
function erroDeRede() {
  const err = new Error("timeout of 15000ms exceeded");
  err.isAxiosError = true;
  err.code = "ECONNABORTED";
  return err;
}

// repos: { "dono/repo": {
//   languages: {JavaScript: 123}, readme: "texto" | null (404),
//   languagesErro / readmeErro: true (erro de rede) ou um erro pronto (erroHttp(...)),
// } }
function instalarFakeGitHub(repos) {
  axios.get.mockImplementation(async (url) => {
    const m = url.match(/repos\/(.+)\/(languages|readme)$/);
    if (!m) throw new Error(`fakeGitHub: URL não mapeada: ${url}`);
    const [, nome, recurso] = m;
    const repo = repos[nome];
    if (!repo) throw erroHttp(404);
    const erro = recurso === "languages" ? repo.languagesErro : repo.readmeErro;
    if (erro) throw (erro === true ? erroDeRede() : erro);
    if (recurso === "languages") return { data: repo.languages ?? {} };
    if (repo.readme == null) throw erroHttp(404); // repositório sem README
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
afterEach(() => jest.restoreAllMocks());

// ETAPA 4: o exemplo mudou DE PROPÓSITO de 80 para 40. Regra nova: por skill
// e por repositório, +20 se QUALQUER sinal aparece no README (palavra inteira);
// "react" + "jsx" no mesmo README, ou "react" dentro de "reactjs", não somam mais.
describe("matchSkillsFromGitHub — exemplo da seção 1 do doc (React = 40)", () => {
  test("3 repositórios: 20 + 20 + 0 → 40, e grava source github", async () => {
    instalarFakeDb([{ id: 7, github_signals: "react, reactjs, jsx, tsx" }]);
    instalarFakeGitHub({
      "u/loja-front":  { languages: { JavaScript: 1, CSS: 1 }, readme: "Feito com React e JSX" },
      "u/portfolio":   { languages: { TypeScript: 1, HTML: 1 }, readme: "usei reactjs" },
      "u/api-tarefas": { languages: { JavaScript: 1 }, readme: "API em Node" },
    });

    const detectadas = await matchSkillsFromGitHub(TOKEN, GITHUB_ID, repoList("u/loja-front", "u/portfolio", "u/api-tarefas"));

    expect(detectadas).toEqual([{ skill_id: 7, confidence: 40 }]);
    expect(gravacoes()).toEqual([{ githubId: GITHUB_ID, skillId: 7, confidence: 40 }]);
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

  // ETAPA 4: mudou DE PROPÓSITO. Antes o README era lido por trecho e "py"
  // dentro de "happy" pontuava (limitação 1 do doc); agora é palavra inteira.
  test("README por palavra inteira: 'py' dentro de 'happy' NÃO pontua", async () => {
    instalarFakeDb([{ id: 1, github_signals: "py" }]);
    instalarFakeGitHub({ "u/a": { languages: {}, readme: "happy path" } });
    const r = await matchSkillsFromGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(r).toEqual([]);
    expect(gravacoes()).toEqual([]);
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

// ETAPA 2: o comportamento destes casos mudou DE PROPÓSITO. Antes, qualquer
// erro da API virava lista vazia / texto vazio (limitação 3 do doc) e a skill
// ficava com confiança 0. Agora, falha de leitura (rede, 401, limite de uso,
// 5xx) deixa o repositório de fora da conta; só "não existe" (404) é normal.
describe("matchSkillsFromGitHub — falha da API não é 'não encontrado' (Etapa 2)", () => {
  const ana = (repos) => analisarGitHub(TOKEN, GITHUB_ID, repos);

  test("README 404 (repositório sem README) conta como sem README: o repositório continua valendo", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({ "u/a": { languages: { Python: 1 }, readme: null } });
    const r = await ana(repoList("u/a"));
    expect(r.status).toBe("ok");
    expect(r.skills).toEqual([{ skill_id: 1, confidence: 40 }]);
  });

  test("linguagens com 404 também é 'não existe' normal, não falha", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({ "u/a": { languagesErro: erroHttp(404), readme: "python" } });
    const r = await ana(repoList("u/a"));
    expect(r.status).toBe("ok");
    expect(r.skills).toEqual([{ skill_id: 1, confidence: 20 }]);
  });

  test.each([
    ["403 de limite de uso (x-ratelimit-remaining: 0)", erroHttp(403, { headers: { "x-ratelimit-remaining": "0" } })],
    ["403 com mensagem de rate limit", erroHttp(403, { data: { message: "API rate limit exceeded" } })],
    ["401 (token expirado)", erroHttp(401)],
    ["429", erroHttp(429)],
    ["500", erroHttp(500)],
    ["503", erroHttp(503)],
    ["timeout / erro de rede", true],
  ])("%s em todos os repositórios → indisponivel, nada é gravado", async (_nome, erro) => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({ "u/a": { languagesErro: erro, readme: "python" }, "u/b": { languagesErro: erro, readme: "python" } });
    jest.spyOn(console, "error").mockImplementation(() => {});
    const r = await ana(repoList("u/a", "u/b"));
    expect(r.status).toBe("indisponivel");
    expect(r.skills).toEqual([]);
    expect(gravacoes()).toEqual([]);
  });

  test("403 comum (sem permissão, não é limite de uso) é 'não existe': não é falha", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({ "u/a": { languagesErro: erroHttp(403), readme: "python" } });
    const r = await ana(repoList("u/a"));
    expect(r.status).toBe("ok");
    expect(r.skills).toEqual([{ skill_id: 1, confidence: 20 }]);
  });

  test("falha só no README também tira o repositório da conta (não conta meia leitura)", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({ "u/a": { languages: { Python: 1 }, readmeErro: erroHttp(500) } });
    jest.spyOn(console, "error").mockImplementation(() => {});
    const r = await ana(repoList("u/a"));
    expect(r.status).toBe("indisponivel");
    expect(gravacoes()).toEqual([]);
  });

  test("1 de 3 repositórios falhando: os outros 2 contam, status parcial", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({
      "u/a": { languages: { Python: 1 }, readme: null },
      "u/b": { languagesErro: erroHttp(500), readme: "python" },
      "u/c": { languages: { Python: 1 }, readme: null },
    });
    jest.spyOn(console, "error").mockImplementation(() => {});
    const r = await ana(repoList("u/a", "u/b", "u/c"));
    expect(r.status).toBe("parcial");
    expect(r.reposComFalha).toBe(1);
    expect(r.skills).toEqual([{ skill_id: 1, confidence: 80 }]); // 40 + 40; o "b" ficou de fora
  });

  test("leitura parcial nunca REDUZ a confiança já gravada (GREATEST); leitura completa substitui", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({
      "u/a": { languages: { Python: 1 }, readme: null },
      "u/b": { languagesErro: erroHttp(500), readme: null },
    });
    jest.spyOn(console, "error").mockImplementation(() => {});
    await ana(repoList("u/a", "u/b"));
    const sqlParcial = db.query.mock.calls.find(([sql]) => /insert into user_skills/i.test(sql))[0];
    expect(sqlParcial).toMatch(/GREATEST\(confidence, VALUES\(confidence\)\)/);

    jest.clearAllMocks();
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({ "u/a": { languages: { Python: 1 }, readme: null } });
    await ana(repoList("u/a"));
    const sqlCompleto = db.query.mock.calls.find(([sql]) => /insert into user_skills/i.test(sql))[0];
    expect(sqlCompleto).not.toMatch(/GREATEST/);
  });

  test("a falha é registrada no log com status e repositório, sem o token", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({ "u/a": { languagesErro: erroHttp(500), readme: null } });
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    await ana(repoList("u/a"));
    const texto = log.mock.calls.map(c => c.join(" ")).join("\n");
    expect(texto).toMatch(/HTTP 500/);
    expect(texto).toMatch(/u\/a/);
    expect(texto).not.toContain(TOKEN);
  });

  test("lista de repositórios vazia não é falha: status ok", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({});
    const r = await ana([]);
    expect(r.status).toBe("ok");
  });

  test("matchSkillsFromGitHub (compatibilidade) devolve lista vazia quando indisponível", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({ "u/a": { languagesErro: erroHttp(401), readme: "python" } });
    jest.spyOn(console, "error").mockImplementation(() => {});
    expect(await matchSkillsFromGitHub(TOKEN, GITHUB_ID, repoList("u/a"))).toEqual([]);
  });
});

describe("fetchRepoLanguages / fetchRepoReadme (usados por outros serviços) seguem devolvendo [] / '' na falha", () => {
  test("falha de rede → vazio, mas registrada no log", async () => {
    instalarFakeGitHub({ "u/a": { languagesErro: true, readmeErro: erroHttp(500) } });
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(await fetchRepoLanguages(TOKEN, "u/a")).toEqual([]);
    expect(await fetchRepoReadme(TOKEN, "u/a")).toBe("");
    expect(log).toHaveBeenCalledTimes(2);
  });
});

describe("verificarRepoPublico", () => {
  test("200 → existe e não é privado", async () => {
    axios.get.mockResolvedValue({ data: { private: false } });
    expect(await verificarRepoPublico(TOKEN, "u/a")).toEqual({ existe: true, privado: false, falha: false });
  });

  test("404 → não existe (sem falha)", async () => {
    axios.get.mockRejectedValue(erroHttp(404));
    expect(await verificarRepoPublico(TOKEN, "u/a")).toEqual({ existe: false, privado: null, falha: false });
  });

  test("403 de limite de uso → falha (não é 'não existe')", async () => {
    axios.get.mockRejectedValue(erroHttp(403, { headers: { "x-ratelimit-remaining": "0" } }));
    jest.spyOn(console, "error").mockImplementation(() => {});
    expect(await verificarRepoPublico(TOKEN, "u/a")).toEqual({ existe: false, privado: null, falha: true });
  });

  test("timeout → falha", async () => {
    axios.get.mockRejectedValue(erroDeRede());
    jest.spyOn(console, "error").mockImplementation(() => {});
    expect((await verificarRepoPublico(TOKEN, "u/a")).falha).toBe(true);
  });
});

describe("verificarHabilidadesNoRepo", () => {
  const HABS = [{ habilidade: "Python", sinais: ["python"] }];

  test("leitura ok → pontua como antes", async () => {
    instalarFakeGitHub({ "u/a": { languages: { Python: 1 }, readme: "python" } });
    expect(await verificarHabilidadesNoRepo(TOKEN, "u/a", HABS)).toEqual([
      { habilidade: "Python", confidence: 60, encontrada: true },
    ]);
  });

  test("falha de leitura lança GitHubIndisponivelError em vez de devolver 'não encontrada'", async () => {
    instalarFakeGitHub({ "u/a": { languagesErro: erroHttp(500), readme: "python" } });
    jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(verificarHabilidadesNoRepo(TOKEN, "u/a", HABS)).rejects.toMatchObject({ codigo: "GITHUB_INDISPONIVEL" });
  });

  test("README 404 não é falha: a habilidade pode ser encontrada pelas linguagens", async () => {
    instalarFakeGitHub({ "u/a": { languages: { Python: 1 }, readme: null } });
    const r = await verificarHabilidadesNoRepo(TOKEN, "u/a", HABS);
    expect(r[0]).toMatchObject({ confidence: 40, encontrada: true });
  });
});

// ETAPA 4 — palavra inteira no README e sinônimos contados uma vez.
describe("aparecePalavraInteira", () => {
  test.each([
    ["happy path", "py", false],
    ["feito em py e flask", "py", true],
    ["jogo escrito em c++ com sdl2", "c++", true],
    ["jogo em c++.", "c++", true],
    ["ferramenta em c# (.net 8)", "c#", true],
    ["ferramenta em c# (.net 8)", ".net", true],
    ["backend em node.js", "node", true],
    ["usei reactjs", "react", false],
    ["usei reactjs", "reactjs", true],
    ["banco mysql", "sql", false],
    ["consultas sql", "sql", true],
    ["tudo em programação", "ação", false], // letras acentuadas contam como letra
    ["", "py", false],
  ])("%j contém %j como palavra inteira → %s", (texto, sinal, esperado) => {
    expect(aparecePalavraInteira(texto, sinal)).toBe(esperado);
  });

  test("caracteres especiais do sinal são escapados (não viram regex)", () => {
    expect(aparecePalavraInteira("arquivo axnet", ".net")).toBe(false); // "." não é curinga
    expect(aparecePalavraInteira("cpp", "c++")).toBe(false);
  });
});

describe("pontuarSkillNoRepo — regra nova", () => {
  test("'c++' casa com o README que fala de C++ (+20)", () => {
    expect(pontuarSkillNoRepo(["c++"], [], "jogo em c++ com sdl2")).toBe(20);
  });

  test("'c++' nas linguagens do GitHub (+40)", () => {
    expect(pontuarSkillNoRepo(["c++"], ["c++", "cmake"], "")).toBe(40);
  });

  test("'reactjs' no README conta uma vez só (não soma react + reactjs)", () => {
    expect(pontuarSkillNoRepo(["react", "reactjs", "jsx", "tsx"], [], "componentes em reactjs")).toBe(20);
  });

  test("vários sinônimos no mesmo README somam só +20", () => {
    expect(pontuarSkillNoRepo(["react", "reactjs", "jsx", "tsx"], [], "react, reactjs, jsx e tsx")).toBe(20);
  });

  test("dois sinais nas linguagens somam só +40", () => {
    expect(pontuarSkillNoRepo(["javascript", "js", "typescript"], ["javascript", "typescript"], "")).toBe(40);
  });

  test("linguagem + README no mesmo repositório: 40 + 20 = 60", () => {
    expect(pontuarSkillNoRepo(["python", "py"], ["python"], "api em python")).toBe(60);
  });

  test("sinais com espaço e maiúsculas são normalizados", () => {
    expect(pontuarSkillNoRepo([" Python ", ""], ["python"], "")).toBe(40);
  });

  test("a soma entre repositórios continua, com teto 100", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python,py" }]);
    instalarFakeGitHub({
      "u/a": { languages: { Python: 1 }, readme: "python" },
      "u/b": { languages: { Python: 1 }, readme: "python" },
    });
    const r = await matchSkillsFromGitHub(TOKEN, GITHUB_ID, repoList("u/a", "u/b"));
    expect(r).toEqual([{ skill_id: 1, confidence: 100 }]); // 60 + 60 → teto 100
  });

  test("verificarHabilidadesNoRepo usa a mesma regra (py ≠ happy, sinônimos uma vez)", async () => {
    instalarFakeGitHub({ "u/a": { languages: {}, readme: "happy path com react e jsx" } });
    const r = await verificarHabilidadesNoRepo(TOKEN, "u/a", [
      { habilidade: "Python", sinais: ["python", "py"] },
      { habilidade: "React", sinais: ["react", "reactjs", "jsx"] },
    ]);
    expect(r).toEqual([
      { habilidade: "Python", confidence: 0, encontrada: false },
      { habilidade: "React", confidence: 20, encontrada: true },
    ]);
  });
});

// Fixtures da tabela antes × depois da Etapa 4 (tests/fixtures/readmes.json),
// com os sinais do seed. Fixa os valores novos para os casos que motivaram a regra.
describe("fixtures de README (Etapa 4)", () => {
  const base = path.join(__dirname, "fixtures");
  const fx = JSON.parse(fs.readFileSync(path.join(base, "readmes.json"), "utf8"));
  const repo = Object.fromEntries(fx.repos.map(r => [r.nome, {
    linguagens: r.linguagens,
    readme: fs.readFileSync(path.join(base, r.readme), "utf8").toLowerCase(),
  }]));
  const pontos = (sinais, nome) => pontuarSkillNoRepo(sinais, repo[nome].linguagens, repo[nome].readme);

  test.each([
    // [skill, sinais, repositório, nova pontuação]
    ["Python",     ["python", "py"],                       "loja-front",     0],  // "happy" não é py
    ["React",      ["react", "reactjs", "jsx", "tsx"],     "loja-front",     20], // react + jsx = uma vez
    ["Python",     ["python", "py"],                       "api-tarefas",    60],
    ["Docker",     ["docker", "dockerfile", "container"],  "api-tarefas",    60], // dockerfile (linguagem) + docker (README)
    ["SQL",        ["sql", "query", "database"],           "api-tarefas",    20], // "query" conta; "sql" dentro de mysql não
    ["SQLite",     ["sqlite", "sql"],                      "api-tarefas",    0],
    ["TypeScript", ["typescript", "ts"],                   "jogo-cpp",       0],  // "lets" não é ts
    ["React",      ["react", "reactjs", "jsx", "tsx"],     "portfolio-next", 20],
    ["TypeScript", ["typescript", "ts"],                   "portfolio-next", 60],
    ["Python",     ["python", "py"],                       "notas-cli",      0],
    ["C#",         ["csharp", "dotnet", ".net"],           "notas-cli",      20],
  ])("%s (%j) em %s → %i", (_skill, sinais, nome, esperado) => {
    expect(pontos(sinais, nome)).toBe(esperado);
  });
});
