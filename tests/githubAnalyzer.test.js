// tests/githubAnalyzer.test.js
// Rede de segurança (Etapa 1 do plano de melhorias da análise de perfil):
// registra como matchSkillsFromGitHub pontua HOJE (docs/analise-perfil.md,
// seção 1), com a API do GitHub e o banco mockados.
jest.mock("axios", () => ({ get: jest.fn() }));
jest.mock("../database/db", () => ({ query: jest.fn(), getConnection: jest.fn() }));

const axios = require("axios");
const db = require("../database/db");
const {
  matchSkillsFromGitHub, analisarGitHub, fetchRepoLanguages, fetchRepoReadme,
  verificarRepoPublico, verificarHabilidadesNoRepo, pontuarSkillNoRepo, aparecePalavraInteira,
  lerDependencias, evidenciasSkillNoRepo,
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
//   arquivos: { "package.json": "<conteúdo>" }   (arquivos na raiz; padrão: nenhum),
//   languagesErro / readmeErro / contentsErro / arquivoErro:
//     true (erro de rede) ou um erro pronto (erroHttp(...)),
// } }
function instalarFakeGitHub(repos) {
  axios.get.mockImplementation(async (url) => {
    const meta = url.match(/repos\/([^/]+\/[^/]+)$/);
    if (meta) {
      const repo = repos[meta[1]];
      if (!repo) throw erroHttp(404);
      return { data: { full_name: meta[1], fork: Boolean(repo.fork) } };
    }
    const m = url.match(/repos\/([^/]+\/[^/]+)\/(languages|readme|contents)(?:\/(.+))?$/);
    if (!m) throw new Error(`fakeGitHub: URL não mapeada: ${url}`);
    const [, nome, recurso, arquivo] = m;
    const repo = repos[nome];
    if (!repo) throw erroHttp(404);
    const lancar = (erro) => { throw (erro === true ? erroDeRede() : erro); };
    if (recurso === "languages") {
      if (repo.languagesErro) lancar(repo.languagesErro);
      return { data: repo.languages ?? {} };
    }
    if (recurso === "readme") {
      if (repo.readmeErro) lancar(repo.readmeErro);
      if (repo.readme == null) throw erroHttp(404); // repositório sem README
      return { data: repo.readme };
    }
    // contents
    const arquivos = repo.arquivos ?? {};
    if (!arquivo) {
      if (repo.contentsErro) lancar(repo.contentsErro);
      if (repo.vazio) throw erroHttp(404); // repositório sem nenhum commit
      return { data: Object.keys(arquivos).map(n => ({ name: n, path: n, type: "file" })) };
    }
    if (repo.arquivoErro) lancar(repo.arquivoErro);
    const nomeArquivo = decodeURIComponent(arquivo);
    if (!(nomeArquivo in arquivos)) throw erroHttp(404);
    return { data: arquivos[nomeArquivo] };
  });
}

// importados: repositórios do dev em user_repositories (padrão: nenhum).
// A conexão da transação (getConnection) usa o mesmo db.query, então
// gravacoes()/evidenciasGravadas() enxergam tudo; begin/commit/rollback ficam em `transacao`.
let transacao;
// atuais: linhas já em user_skills ({ skill_id, source, confidence }).
// declaracoes: autodiagnóstico ({ skill_id, confidence }) em user_skill_declaracoes.
function instalarFakeDb(skills, { importados = [], semTabelaEvidencias = false, atuais = [], declaracoes = [] } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (/from skills/i.test(sql)) return [skills];
    if (/from user_skill_declaracoes/i.test(sql)) return [declaracoes];
    if (/^\s*select[\s\S]*from user_skills\b/i.test(sql)) return [atuais];
    if (/from user_repositories/i.test(sql)) return [importados.map(n => ({ repo_full_name: n }))];
    if (/user_skill_evidencias/i.test(sql)) {
      if (semTabelaEvidencias) {
        const err = new Error("Table 'user_skill_evidencias' doesn't exist");
        err.code = "ER_NO_SUCH_TABLE";
        throw err;
      }
      return [{}];
    }
    if (/insert into user_skills/i.test(sql)) return [{}];
    throw new Error(`fakeDb: rota não mapeada: ${sql}`);
  });
  transacao = {
    query: (...args) => db.query(...args),
    beginTransaction: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    release: jest.fn(),
  };
  db.getConnection.mockResolvedValue(transacao);
}

const evidenciasGravadas = () =>
  db.query.mock.calls
    .filter(([sql]) => /insert into user_skill_evidencias/i.test(sql))
    .flatMap(([, params]) => params[0])
    .map(([githubId, skillId, repo, tipo, pontos]) => ({ githubId, skillId, repo, tipo, pontos }));
const apagouEvidencias = () =>
  db.query.mock.calls.filter(([sql]) => /delete from user_skill_evidencias/i.test(sql));

// INSERT em user_skills: (github_id, skill_id, source, confidence) — Etapa 7
// passou a gravar a origem do valor que ficou.
const gravacoes = () =>
  db.query.mock.calls
    .filter(([sql]) => /insert into user_skills/i.test(sql))
    .map(([, params]) => ({ githubId: params[0], skillId: params[1], confidence: params[3] }));
const gravacoesComOrigem = () =>
  db.query.mock.calls
    .filter(([sql]) => /insert into user_skills/i.test(sql))
    .map(([, params]) => ({ skillId: params[1], source: params[2], confidence: params[3] }));

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
    // Etapa 7: a origem passou a ser parâmetro (era o literal 'github' no SQL)
    expect(gravacoesComOrigem()).toEqual([{ skillId: 7, source: "github", confidence: 40 }]);
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

  // Etapa 7: o GREATEST saiu do SQL e virou regra no código (para combinar com
  // a declaração do dev); o comportamento da leitura parcial é o mesmo.
  test("leitura parcial nunca REDUZ a confiança já gravada; leitura completa substitui", async () => {
    const atuais = [{ skill_id: 1, source: "github", confidence: 80 }];
    instalarFakeDb([{ id: 1, github_signals: "python" }], { atuais });
    instalarFakeGitHub({
      "u/a": { languages: { Python: 1 }, readme: null },
      "u/b": { languagesErro: erroHttp(500), readme: null },
    });
    jest.spyOn(console, "error").mockImplementation(() => {});
    await ana(repoList("u/a", "u/b"));
    expect(gravacoes()).toEqual([]); // 40 < 80 já gravado → não reduz

    jest.clearAllMocks();
    instalarFakeDb([{ id: 1, github_signals: "python" }], { atuais });
    instalarFakeGitHub({ "u/a": { languages: { Python: 1 }, readme: null } });
    await ana(repoList("u/a"));
    expect(gravacoes()).toEqual([{ githubId: GITHUB_ID, skillId: 1, confidence: 40 }]); // completa: substitui
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

// ETAPA 5 — forks ficam de fora e arquivos de dependências viram evidência.
describe("forks e arquivos de dependências (Etapa 5)", () => {
  const PKG_REACT = JSON.stringify({ dependencies: { react: "^18.2.0", "react-dom": "^18.2.0" }, devDependencies: { vite: "^5" } });

  test("fork é ignorado: não pontua e nem é consultado", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({
      "u/meu":  { languages: { Python: 1 }, readme: null },
      "u/fork": { languages: { Python: 1 }, readme: "python" },
    });
    const r = await analisarGitHub(TOKEN, GITHUB_ID, [
      { full_name: "u/meu", fork: false },
      { full_name: "u/fork", fork: true },
    ]);
    expect(r.skills).toEqual([{ skill_id: 1, confidence: 40 }]); // só o "meu"
    expect(axios.get.mock.calls.some(([url]) => url.includes("u/fork"))).toBe(false);
  });

  test("só forks na lista → status ok, nada detectado (não é 'indisponível')", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({});
    const r = await analisarGitHub(TOKEN, GITHUB_ID, [{ full_name: "u/fork", fork: true }]);
    expect(r).toEqual({ status: "ok", skills: [], reposComFalha: 0 });
  });

  test("React no package.json → +40 (mesmo sem citar React no README)", async () => {
    instalarFakeDb([{ id: 7, github_signals: "react,reactjs,jsx,tsx" }]);
    instalarFakeGitHub({ "u/a": { languages: { JavaScript: 1 }, readme: "loja virtual", arquivos: { "package.json": PKG_REACT } } });
    const r = await matchSkillsFromGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(r).toEqual([{ skill_id: 7, confidence: 40 }]);
  });

  test("dependência + README → 60; dependência não soma com linguagem (+40 uma vez só)", async () => {
    instalarFakeDb([
      { id: 7, github_signals: "react,reactjs,jsx,tsx" },
      { id: 8, github_signals: "javascript,js" },
    ]);
    instalarFakeGitHub({ "u/a": {
      languages: { JavaScript: 1 }, readme: "feito com react",
      arquivos: { "package.json": JSON.stringify({ dependencies: { react: "1", js: "1" } }) },
    } });
    const r = await matchSkillsFromGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(r).toEqual([
      { skill_id: 7, confidence: 60 }, // +40 dependência, +20 README
      { skill_id: 8, confidence: 40 }, // linguagem + dependência "js" = +40, não 80
    ]);
  });

  test("package.json inválido não quebra a análise: o resto do repositório conta", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }, { id: 7, github_signals: "react" }]);
    instalarFakeGitHub({ "u/a": { languages: { Python: 1 }, readme: null, arquivos: { "package.json": "{ isto não é json" } } });
    const r = await analisarGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(r.status).toBe("ok");
    expect(r.skills).toEqual([{ skill_id: 1, confidence: 40 }]);
  });

  test("requirements.txt: django → +40 em Django", async () => {
    instalarFakeDb([{ id: 3, github_signals: "django" }]);
    instalarFakeGitHub({ "u/a": { languages: { Python: 1 }, readme: null, arquivos: { "requirements.txt": "Django>=4.2\ngunicorn" } } });
    expect(await matchSkillsFromGitHub(TOKEN, GITHUB_ID, repoList("u/a"))).toEqual([{ skill_id: 3, confidence: 40 }]);
  });

  test("repositório vazio (contents 404) não é falha: sem dependências", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({ "u/a": { languages: { Python: 1 }, readme: null, vazio: true } });
    const r = await analisarGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(r.status).toBe("ok");
    expect(r.skills).toEqual([{ skill_id: 1, confidence: 40 }]);
  });

  test("falha ao listar a raiz segue a regra da Etapa 2: repositório fora da conta", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({
      "u/a": { languages: { Python: 1 }, readme: null, contentsErro: erroHttp(500) },
      "u/b": { languages: { Python: 1 }, readme: null },
    });
    jest.spyOn(console, "error").mockImplementation(() => {});
    const r = await analisarGitHub(TOKEN, GITHUB_ID, repoList("u/a", "u/b"));
    expect(r.status).toBe("parcial");
    expect(r.skills).toEqual([{ skill_id: 1, confidence: 40 }]);
  });

  test("falha ao baixar um arquivo de dependências (limite de uso) também é falha do repositório", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({ "u/a": {
      languages: { Python: 1 }, readme: null, arquivos: { "package.json": PKG_REACT },
      arquivoErro: erroHttp(403, { headers: { "x-ratelimit-remaining": "0" } }),
    } });
    jest.spyOn(console, "error").mockImplementation(() => {});
    const r = await analisarGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(r.status).toBe("indisponivel");
    expect(gravacoes()).toEqual([]);
  });

  test("lerDependencias baixa só os arquivos de dependências da raiz (uma chamada por arquivo)", async () => {
    instalarFakeGitHub({ "u/a": { arquivos: {
      "package.json": PKG_REACT, "README.md": "x", "index.js": "x", "requirements.txt": "flask",
    } } });
    const r = await lerDependencias(TOKEN, "u/a");
    expect(r.falha).toBe(false);
    expect(r.valor.sort()).toEqual(["flask", "react", "react-dom", "vite"]);
    const urls = axios.get.mock.calls.map(([url]) => url);
    expect(urls).toEqual(expect.arrayContaining([
      "https://api.github.com/repos/u/a/contents",
      "https://api.github.com/repos/u/a/contents/package.json",
      "https://api.github.com/repos/u/a/contents/requirements.txt",
    ]));
    expect(urls).toHaveLength(3); // listagem + 2 arquivos; README.md e index.js não são baixados
  });

  test("verificarHabilidadesNoRepo também usa as dependências (+40)", async () => {
    instalarFakeGitHub({ "u/a": { languages: { JavaScript: 1 }, readme: null, arquivos: { "package.json": PKG_REACT } } });
    const r = await verificarHabilidadesNoRepo(TOKEN, "u/a", [{ habilidade: "React", sinais: ["react", "reactjs"] }]);
    expect(r).toEqual([{ habilidade: "React", confidence: 40, encontrada: true }]);
  });

  test("pontuarSkillNoRepo: sinal igual ao nome de um pacote vale +40", () => {
    expect(pontuarSkillNoRepo(["express"], ["javascript"], "", ["express", "cors"])).toBe(40);
    expect(pontuarSkillNoRepo(["express"], ["javascript"], "", ["express-session"])).toBe(0); // nome exato
  });
});

// ETAPA 6 — evidências por skill e repositórios escolhidos em /repositorios.
describe("evidências por skill (Etapa 6)", () => {
  const PKG = JSON.stringify({ dependencies: { react: "^18" } });

  test("grava uma evidência por tipo e repositório, com os pontos", async () => {
    instalarFakeDb([{ id: 7, github_signals: "react,reactjs" }, { id: 8, github_signals: "javascript" }]);
    instalarFakeGitHub({
      "u/loja": { languages: { JavaScript: 1 }, readme: "feito com react", arquivos: { "package.json": PKG } },
      "u/site": { languages: {}, readme: "usei reactjs" },
    });
    const r = await analisarGitHub(TOKEN, GITHUB_ID, repoList("u/loja", "u/site"));

    expect(r.skills).toEqual([{ skill_id: 7, confidence: 80 }, { skill_id: 8, confidence: 40 }]);
    expect(evidenciasGravadas()).toEqual([
      { githubId: GITHUB_ID, skillId: 7, repo: "u/loja", tipo: "dependencia", pontos: 40 },
      { githubId: GITHUB_ID, skillId: 7, repo: "u/loja", tipo: "readme",      pontos: 20 },
      { githubId: GITHUB_ID, skillId: 7, repo: "u/site", tipo: "readme",      pontos: 20 },
      { githubId: GITHUB_ID, skillId: 8, repo: "u/loja", tipo: "linguagem",   pontos: 40 },
    ]);
  });

  test("linguagem e dependência no mesmo repositório: uma evidência só, do tipo linguagem", () => {
    expect(evidenciasSkillNoRepo(["javascript", "js"], ["javascript"], "", ["js"])).toEqual([
      { tipo: "linguagem", pontos: 40 },
    ]);
  });

  test("as evidências antigas são substituídas a cada análise, numa transação", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({ "u/a": { languages: { Python: 1 }, readme: null } });
    await analisarGitHub(TOKEN, GITHUB_ID, repoList("u/a"));

    const ordem = db.query.mock.calls.map(([sql]) => sql.replace(/\s+/g, " ").trim().split(" ").slice(0, 3).join(" ").toLowerCase());
    expect(ordem).toEqual([
      "select * from",                   // skills
      "delete from user_skill_evidencias",
      "select skill_id, confidence",     // declarações (Etapa 7)
      "select skill_id, source,",        // linhas atuais de user_skills (Etapa 7)
      "insert into user_skills",
      "insert into user_skill_evidencias",
    ]);
    expect(apagouEvidencias()[0][1]).toEqual([GITHUB_ID]); // todas as do dev
    expect(transacao.beginTransaction).toHaveBeenCalledTimes(1);
    expect(transacao.commit).toHaveBeenCalledTimes(1);
    expect(transacao.rollback).not.toHaveBeenCalled();
    expect(transacao.release).toHaveBeenCalledTimes(1);
  });

  test("análise sem nenhuma skill ainda apaga as evidências antigas", async () => {
    instalarFakeDb([{ id: 1, github_signals: "rust" }]);
    instalarFakeGitHub({ "u/a": { languages: { Python: 1 }, readme: null } });
    await analisarGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(apagouEvidencias()).toHaveLength(1);
    expect(evidenciasGravadas()).toEqual([]);
  });

  test("leitura parcial: só apaga as evidências dos repositórios lidos agora", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({
      "u/a": { languages: { Python: 1 }, readme: null },
      "u/b": { languagesErro: erroHttp(500), readme: null },
    });
    jest.spyOn(console, "error").mockImplementation(() => {});
    await analisarGitHub(TOKEN, GITHUB_ID, repoList("u/a", "u/b"));
    const [sql, params] = apagouEvidencias()[0];
    expect(sql).toMatch(/repo_full_name IN \(\?\)/);
    expect(params).toEqual([GITHUB_ID, ["u/a"]]);
  });

  test("GitHub indisponível: nenhuma transação é aberta (nada muda)", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({ "u/a": { languagesErro: erroHttp(401), readme: null } });
    jest.spyOn(console, "error").mockImplementation(() => {});
    await analisarGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  test("erro ao gravar faz rollback e libera a conexão", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({ "u/a": { languages: { Python: 1 }, readme: null } });
    const original = db.query.getMockImplementation();
    db.query.mockImplementation(async (sql, params) => {
      if (/insert into user_skills/i.test(sql)) throw new Error("deadlock");
      return original(sql, params);
    });
    await expect(analisarGitHub(TOKEN, GITHUB_ID, repoList("u/a"))).rejects.toThrow("deadlock");
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
    expect(transacao.commit).not.toHaveBeenCalled();
    expect(transacao.release).toHaveBeenCalledTimes(1);
  });

  test("sem a tabela de evidências (migração não rodada) as skills são gravadas mesmo assim", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }], { semTabelaEvidencias: true });
    instalarFakeGitHub({ "u/a": { languages: { Python: 1 }, readme: null } });
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    const r = await analisarGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(r.status).toBe("ok");
    expect(gravacoes()).toEqual([{ githubId: GITHUB_ID, skillId: 1, confidence: 40 }]);
    expect(transacao.commit).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.join(" ")).toMatch(/migrate:analise-perfil/);
  });
});

describe("repositórios escolhidos em /repositorios (Etapa 6)", () => {
  test("dev com repositórios importados → só eles contam", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }, { id: 2, github_signals: "go" }], { importados: ["u/importado"] });
    instalarFakeGitHub({
      "u/importado": { languages: { Python: 1 }, readme: null },
      "u/recente":   { languages: { Go: 1 }, readme: null },
    });
    const r = await analisarGitHub(TOKEN, GITHUB_ID, [{ full_name: "u/recente" }, { full_name: "u/importado" }], { userId: 5 });

    expect(r.skills).toEqual([{ skill_id: 1, confidence: 40 }]);
    expect(axios.get.mock.calls.some(([url]) => url.includes("u/recente"))).toBe(false);
    const consulta = db.query.mock.calls.find(([sql]) => /from user_repositories/i.test(sql));
    expect(consulta[1]).toEqual([5]);
  });

  test("dev sem repositórios importados → os mais recentes (como antes)", async () => {
    instalarFakeDb([{ id: 2, github_signals: "go" }], { importados: [] });
    instalarFakeGitHub({ "u/recente": { languages: { Go: 1 }, readme: null } });
    const r = await analisarGitHub(TOKEN, GITHUB_ID, [{ full_name: "u/recente" }], { userId: 5 });
    expect(r.skills).toEqual([{ skill_id: 2, confidence: 40 }]);
  });

  test("importado que é fork continua fora (fork vem da lista recente ou de GET /repos/{r})", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }], { importados: ["u/meu", "u/fork-recente", "u/fork-antigo"] });
    instalarFakeGitHub({
      "u/meu":         { languages: { Python: 1 }, readme: null },
      "u/fork-recente":{ languages: { Python: 1 }, readme: null },
      "u/fork-antigo": { languages: { Python: 1 }, readme: null, fork: true },
    });
    const r = await analisarGitHub(TOKEN, GITHUB_ID, [{ full_name: "u/fork-recente", fork: true }], { userId: 5 });

    expect(r.skills).toEqual([{ skill_id: 1, confidence: 40 }]); // só u/meu
    const lidos = axios.get.mock.calls.map(([url]) => url).filter(url => url.endsWith("/languages"));
    expect(lidos).toEqual(["https://api.github.com/repos/u/meu/languages"]);
  });

  test("sem userId (chamadas antigas) não consulta user_repositories", async () => {
    instalarFakeDb([{ id: 1, github_signals: "python" }]);
    instalarFakeGitHub({ "u/a": { languages: { Python: 1 }, readme: null } });
    await matchSkillsFromGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(db.query.mock.calls.some(([sql]) => /user_repositories/i.test(sql))).toBe(false);
  });
});

// ETAPA 7 — detectada × declarada (opção B: a parte detectada é recalculada
// a cada análise; a declaração do dev serve de piso).
describe("análise × autodiagnóstico (Etapa 7)", () => {
  const PY = [{ id: 1, github_signals: "python" }];
  const umRepoPython = () => instalarFakeGitHub({ "u/a": { languages: { Python: 1 }, readme: "python" } }); // 60

  test("declarada 30 + GitHub 60 → 60, source github", async () => {
    instalarFakeDb(PY, { declaracoes: [{ skill_id: 1, confidence: 30 }], atuais: [{ skill_id: 1, source: "manual", confidence: 30 }] });
    umRepoPython();
    await analisarGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(gravacoesComOrigem()).toEqual([{ skillId: 1, source: "github", confidence: 60 }]);
  });

  test("declarada 85 + GitHub 20 → 85, source manual (a análise não rebaixa a declaração)", async () => {
    instalarFakeDb(PY, { declaracoes: [{ skill_id: 1, confidence: 85 }], atuais: [{ skill_id: 1, source: "manual", confidence: 85 }] });
    instalarFakeGitHub({ "u/a": { languages: {}, readme: "python" } }); // 20
    await analisarGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(gravacoesComOrigem()).toEqual([{ skillId: 1, source: "manual", confidence: 85 }]);
  });

  test("skill só do GitHub é recalculada: 60 → 20 quando o repositório muda", async () => {
    instalarFakeDb(PY, { atuais: [{ skill_id: 1, source: "github", confidence: 60 }] });
    instalarFakeGitHub({ "u/a": { languages: {}, readme: "python" } }); // 20
    await analisarGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(gravacoesComOrigem()).toEqual([{ skillId: 1, source: "github", confidence: 20 }]);
  });

  test("empate fica com a origem github", async () => {
    instalarFakeDb(PY, { declaracoes: [{ skill_id: 1, confidence: 60 }] });
    umRepoPython();
    await analisarGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(gravacoesComOrigem()).toEqual([{ skillId: 1, source: "github", confidence: 60 }]);
  });

  test("skill manual antiga (70, sem declaração registrada) continua valendo como declaração", async () => {
    instalarFakeDb(PY, { atuais: [{ skill_id: 1, source: "manual", confidence: 70 }] });
    instalarFakeGitHub({ "u/a": { languages: {}, readme: "python" } }); // 20
    await analisarGitHub(TOKEN, GITHUB_ID, repoList("u/a"));
    expect(gravacoesComOrigem()).toEqual([{ skillId: 1, source: "manual", confidence: 70 }]);
  });
});
