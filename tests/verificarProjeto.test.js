// tests/verificarProjeto.test.js
// Testa roadmapService.verificarProjeto/fecharProjetoSemVerificar com a
// análise de repositório mockada (services/githubAnalyzer) e o banco
// mockado — sem chamar a API do GitHub nem precisar de MySQL.
jest.mock("../database/db", () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
  ready: Promise.resolve(),
}));

jest.mock("../services/githubAnalyzer", () => ({
  verificarRepoPublico: jest.fn(),
  verificarHabilidadesNoRepo: jest.fn(),
  // matchSkillsFromGitHub/fetchRepoLanguages/fetchRepoReadme não são
  // usados por roadmapService diretamente — só o necessário é mockado.
}));

const db = require("../database/db");
const { verificarRepoPublico, verificarHabilidadesNoRepo } = require("../services/githubAnalyzer");
const { verificarProjeto, fecharProjetoSemVerificar } = require("../services/roadmapService");

const FASE = { id: 10, roadmap_id: 1, nome: "Fase 1", usuario_id: 5 };
const REPO_URL = "https://github.com/dev/meu-projeto";

function instalarFakeDb({ skillRows = [], perfilExistente = null } = {}) {
  const handler = jest.fn(async (sql, params = []) => {
    const s = sql.toLowerCase().replace(/\s+/g, " ").trim();

    if (s.includes("from roadmap_fases rf") && s.includes("join roadmaps r")) {
      return [[FASE]];
    }
    if (s.startsWith("select distinct habilidade from roadmap_etapas")) {
      return [[{ habilidade: "JavaScript" }]];
    }
    if (s.startsWith("select name, github_signals from skills")) {
      return [skillRows];
    }
    if (s.startsWith("update roadmap_fases")) {
      return [{ affectedRows: 1 }];
    }
    if (s.startsWith("select boas_praticas from perfil_tecnico_ia")) {
      return [[perfilExistente]];
    }
    if (s.startsWith("insert into perfil_tecnico_ia")) {
      return [{ affectedRows: 1 }];
    }
    throw new Error(`fakeDb: rota não mapeada: ${sql}`);
  });
  db.query.mockImplementation(handler);
  return handler;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("verificarProjeto", () => {
  const SKILL_ROWS = [{ name: "JavaScript", github_signals: "javascript,js" }];

  test("aprovado — habilidade encontrada no repositório", async () => {
    const handler = instalarFakeDb({ skillRows: SKILL_ROWS });
    verificarRepoPublico.mockResolvedValue({ existe: true, privado: false });
    verificarHabilidadesNoRepo.mockResolvedValue([
      { habilidade: "JavaScript", confidence: 60, encontrada: true },
    ]);

    const resultado = await verificarProjeto(FASE.id, REPO_URL, "token-fake");

    expect(resultado.status).toBe("aprovado");
    const chamadaVerificado = handler.mock.calls.find(([sql]) =>
      sql.toLowerCase().includes("projeto_status = 'verificado'")
    );
    expect(chamadaVerificado).toBeTruthy();
    const chamadaPerfil = handler.mock.calls.find(([sql]) =>
      sql.toLowerCase().includes("insert into perfil_tecnico_ia")
    );
    expect(chamadaPerfil).toBeTruthy();
  });

  test("faltando habilidade — projeto continua aberto (em_revisao), nunca 'reprovado'", async () => {
    const handler = instalarFakeDb({ skillRows: SKILL_ROWS });
    verificarRepoPublico.mockResolvedValue({ existe: true, privado: false });
    verificarHabilidadesNoRepo.mockResolvedValue([
      { habilidade: "JavaScript", confidence: 0, encontrada: false },
    ]);

    const resultado = await verificarProjeto(FASE.id, REPO_URL, "token-fake");

    expect(resultado.status).toBe("faltando");
    expect(resultado.faltando).toEqual(["JavaScript"]);
    expect(resultado.mensagem.toLowerCase()).not.toMatch(/reprovad/);
    const chamadaRevisao = handler.mock.calls.find(([sql]) =>
      sql.toLowerCase().includes("projeto_status = 'em_revisao'")
    );
    expect(chamadaRevisao).toBeTruthy();
  });

  test("repositório privado — mensagem clara, fase continua aberta, sem chamar a análise", async () => {
    instalarFakeDb({ skillRows: SKILL_ROWS });
    verificarRepoPublico.mockResolvedValue({ existe: true, privado: true });

    const resultado = await verificarProjeto(FASE.id, REPO_URL, "token-fake");

    expect(resultado.status).toBe("erro");
    expect(resultado.mensagem.toLowerCase()).toMatch(/privado/);
    expect(verificarHabilidadesNoRepo).not.toHaveBeenCalled();
  });

  test("URL inválida — nem chega a consultar o GitHub", async () => {
    instalarFakeDb({ skillRows: SKILL_ROWS });

    const resultado = await verificarProjeto(FASE.id, "não é uma url", "token-fake");

    expect(resultado.status).toBe("erro");
    expect(resultado.mensagem.toLowerCase()).toMatch(/link inválido/);
    expect(verificarRepoPublico).not.toHaveBeenCalled();
  });
});

describe("fecharProjetoSemVerificar (plano Free)", () => {
  test("fecha a fase com o selo 'não verificada', sem chamar a análise de repositório", async () => {
    const handler = instalarFakeDb();

    const resultado = await fecharProjetoSemVerificar(FASE.id, REPO_URL);

    expect(resultado.status).toBe("nao_verificado");
    expect(verificarRepoPublico).not.toHaveBeenCalled();
    expect(verificarHabilidadesNoRepo).not.toHaveBeenCalled();
    const chamada = handler.mock.calls.find(([sql]) =>
      sql.toLowerCase().includes("projeto_status = 'nao_verificado'")
    );
    expect(chamada).toBeTruthy();
  });
});

// ETAPA 2: falha de leitura do GitHub nunca vira "faltando" nem "repositório
// não encontrado", e não mexe no projeto_status da fase.
describe("verificarProjeto — GitHub indisponível (falha da API)", () => {
  const SKILL_ROWS = [{ name: "JavaScript", github_signals: "javascript,js" }];
  const { GitHubIndisponivelError, MENSAGEM_GITHUB_INDISPONIVEL } = require("../services/githubErrors");

  const escritas = (handler) =>
    handler.mock.calls.filter(([sql]) => sql.toLowerCase().trim().startsWith("update roadmap_fases"));

  test("falha ao consultar o repositório → indisponivel, sem nenhuma escrita na fase", async () => {
    const handler = instalarFakeDb({ skillRows: SKILL_ROWS });
    verificarRepoPublico.mockResolvedValue({ existe: false, privado: null, falha: true });

    const resultado = await verificarProjeto(FASE.id, REPO_URL, "token-fake");

    expect(resultado).toEqual({ status: "indisponivel", mensagem: MENSAGEM_GITHUB_INDISPONIVEL });
    expect(escritas(handler)).toEqual([]); // nem projeto_repo_url, nem projeto_status
    expect(verificarHabilidadesNoRepo).not.toHaveBeenCalled();
  });

  test("falha ao ler linguagens/README → indisponivel (nunca 'faltando') e status inalterado", async () => {
    const handler = instalarFakeDb({ skillRows: SKILL_ROWS });
    verificarRepoPublico.mockResolvedValue({ existe: true, privado: false, falha: false });
    verificarHabilidadesNoRepo.mockRejectedValue(new GitHubIndisponivelError("dev/meu-projeto"));

    const resultado = await verificarProjeto(FASE.id, REPO_URL, "token-fake");

    expect(resultado.status).toBe("indisponivel");
    expect(resultado.status).not.toBe("faltando");
    expect(resultado.mensagem).toBe("Não conseguimos ler seu GitHub agora. Tente de novo em alguns minutos.");
    expect(resultado.faltando).toBeUndefined();
    expect(escritas(handler)).toEqual([]);
  });

  test("repositório que realmente não existe continua sendo 'erro' (não confundir com falha)", async () => {
    instalarFakeDb({ skillRows: SKILL_ROWS });
    verificarRepoPublico.mockResolvedValue({ existe: false, privado: null, falha: false });

    const resultado = await verificarProjeto(FASE.id, REPO_URL, "token-fake");

    expect(resultado.status).toBe("erro");
    expect(resultado.mensagem.toLowerCase()).toMatch(/não encontramos/);
  });
});
