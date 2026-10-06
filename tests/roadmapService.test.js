// tests/roadmapService.test.js
// Testa services/roadmapService.js com a IA mockada (sem chamar o Gemini
// de verdade) e o banco mockado (sem precisar de MySQL disponível).
//
// data/habilidades-referencia.json e data/roadmaps-modelo/*.json são lidos
// de verdade do disco (são dados estáticos do próprio repo, não uma
// dependência externa) — só a IA e o banco são mockados.

jest.mock("../database/db", () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
  ready: Promise.resolve(),
}));

jest.mock("../services/geminiClient", () => ({
  askGeminiJSON: jest.fn(),
}));

const db = require("../database/db");
const { askGeminiJSON } = require("../services/geminiClient");
const {
  gerarRoadmap,
  regenerarRoadmap,
  inferirAreaDaVaga,
  validarEstruturaRoadmap,
  classificarErroIA,
} = require("../services/roadmapService");

// ── Roadmap válido de exemplo (3 fases, 3 etapas cada, 1 projeto cada) ──
function criarRoadmapValido() {
  const etapaPadrao = (titulo, habilidade) => ({
    titulo,
    descricao: `Aprender ${habilidade} na prática.`,
    habilidade,
    horas_estimadas: 6,
  });

  return {
    fases: [
      {
        nome: "Fase 1",
        objetivo: "Fundamentos.",
        etapas: [
          etapaPadrao("Etapa 1.1", "JavaScript"),
          etapaPadrao("Etapa 1.2", "HTML"),
          etapaPadrao("Etapa 1.3", "CSS"),
        ],
        projeto: { enunciado: "Projeto da fase 1.", habilidades: ["JavaScript", "HTML"] },
      },
      {
        nome: "Fase 2",
        objetivo: "Avançando.",
        etapas: [
          etapaPadrao("Etapa 2.1", "React"),
          etapaPadrao("Etapa 2.2", "Git"),
          etapaPadrao("Etapa 2.3", "APIs REST"),
        ],
        projeto: { enunciado: "Projeto da fase 2.", habilidades: ["React"] },
      },
      {
        nome: "Fase 3",
        objetivo: "Consolidando.",
        etapas: [
          etapaPadrao("Etapa 3.1", "TypeScript"),
          etapaPadrao("Etapa 3.2", "Testes Automatizados"),
          etapaPadrao("Etapa 3.3", "Acessibilidade Web"),
        ],
        projeto: { enunciado: "Projeto da fase 3.", habilidades: ["TypeScript"] },
      },
    ],
  };
}

// ── Fake DB: roteia cada SQL pro resultado esperado, sem precisar de
// MySQL de verdade. Compartilhado entre db.query (fora de transação, usado
// por montarGap) e connection.query (dentro da transação) — mesma rota. ──
function criarFakeDb({
  recursoDisponivel = true,
  etapasConcluidas = [],
  roadmapExistente = null,
  habilidadesDaVaga = ["JavaScript"],
} = {}) {
  let proximoId = 1000;

  const handler = jest.fn(async (sql, params = []) => {
    const s = sql.toLowerCase().replace(/\s+/g, " ").trim();

    if (s.includes("from user_dev_profiles")) return [[{ github_id: 123, nivel: "iniciante" }]];
    if (s.includes("from user_skills"))        return [[]]; // usuário sem skills detectadas → gap completo
    if (s.includes("from job_skills")) {
      return [habilidadesDaVaga.map((habilidade, i) => ({
        skill_id: i + 1, importance: "obrigatoria", habilidade,
      }))];
    }
    if (s.startsWith("select id, name from skills")) return [[{ id: 1, name: "JavaScript" }]];

    if (s.startsWith("select id from recursos")) {
      return [recursoDisponivel ? [{ id: 777 }] : []];
    }
    if (s.startsWith("insert into recursos_pendentes")) return [{ affectedRows: 1 }];

    if (s.startsWith("insert into roadmaps"))       return [{ insertId: proximoId++ }];
    if (s.startsWith("insert into roadmap_fases"))  return [{ insertId: proximoId++ }];
    if (s.startsWith("insert into roadmap_etapas")) return [{ insertId: proximoId++ }];

    if (s.startsWith("select * from roadmaps where id")) {
      return [[roadmapExistente ?? {
        id: params[0], usuario_id: 1, tipo_objetivo: "area", vaga_id: null,
        area: "front-end", horas_semana: 10, versao: 1, status: "ativo",
      }]];
    }
    if (s.includes("from roadmap_etapas re") && s.includes("join roadmap_fases")) {
      return [etapasConcluidas];
    }
    if (s.startsWith("delete from roadmap_fases")) return [{ affectedRows: 1 }];
    if (s.startsWith("update roadmaps"))           return [{ affectedRows: 1 }];

    throw new Error(`fakeDb: rota não mapeada para: ${sql}`);
  });

  const connection = {
    query: handler,
    beginTransaction: jest.fn().mockResolvedValue(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
  };

  return { handler, connection };
}

function instalarFakeDb(opts) {
  const { handler, connection } = criarFakeDb(opts);
  db.query.mockImplementation(handler);
  db.getConnection.mockResolvedValue(connection);
  return { handler, connection };
}

const OBJETIVO_AREA_FRONT_END = { tipo: "area", area: "front-end" };

beforeEach(() => {
  jest.clearAllMocks();
});

describe("validarEstruturaRoadmap", () => {
  test("aceita um roadmap bem formado", () => {
    expect(validarEstruturaRoadmap(criarRoadmapValido())).toEqual({ valido: true });
  });

  test("rejeita menos de 3 fases", () => {
    const roadmap = criarRoadmapValido();
    roadmap.fases = roadmap.fases.slice(0, 2);
    expect(validarEstruturaRoadmap(roadmap).valido).toBe(false);
  });
});

describe("classificarErroIA", () => {
  test("classifica resposta não-JSON como 'json_invalido'", () => {
    expect(classificarErroIA(new Error("Resposta da IA não veio em JSON válido."))).toBe("json_invalido");
  });

  test("classifica erro de rate limit/indisponibilidade como 'indisponivel'", () => {
    expect(classificarErroIA(new Error("429 Too Many Requests"))).toBe("indisponivel");
  });
});

describe("gerarRoadmap", () => {
  test("JSON válido na primeira tentativa → origem 'ia', uma única chamada à IA", async () => {
    instalarFakeDb();
    askGeminiJSON.mockResolvedValueOnce(criarRoadmapValido());

    const resultado = await gerarRoadmap(1, OBJETIVO_AREA_FRONT_END, 10);

    expect(resultado.origem).toBe("ia");
    expect(resultado.fases).toHaveLength(3);
    expect(resultado.fases[0].etapas).toHaveLength(3);
    expect(askGeminiJSON).toHaveBeenCalledTimes(1);
  });

  test("JSON inválido duas vezes → cai pro roadmap-modelo, origem 'modelo'", async () => {
    instalarFakeDb();
    const roadmapInvalido = { fases: [{ nome: "Só uma fase" }] }; // viola o mínimo de 3 fases
    askGeminiJSON.mockResolvedValueOnce(roadmapInvalido);
    askGeminiJSON.mockResolvedValueOnce(roadmapInvalido);

    const resultado = await gerarRoadmap(1, OBJETIVO_AREA_FRONT_END, 10);

    expect(resultado.origem).toBe("modelo");
    expect(askGeminiJSON).toHaveBeenCalledTimes(2); // 1 tentativa original + 1 retry
    // data/roadmaps-modelo/front-end.json tem 4 fases — confirma que é o
    // arquivo estático real que foi carregado, não um objeto vazio.
    expect(resultado.fases.length).toBeGreaterThanOrEqual(3);
  });

  test("erro 429 na chamada à IA → cai direto pro modelo, sem tentar de novo", async () => {
    instalarFakeDb();
    askGeminiJSON.mockRejectedValueOnce(new Error("429 Too Many Requests"));

    const resultado = await gerarRoadmap(1, OBJETIVO_AREA_FRONT_END, 10);

    expect(resultado.origem).toBe("modelo");
    expect(askGeminiJSON).toHaveBeenCalledTimes(1); // sem retry — não insiste numa chamada que já falhou por cota
  });

  test("habilidade sem recurso cadastrado → recurso_id null e registra em recursos_pendentes", async () => {
    const { handler } = instalarFakeDb({ recursoDisponivel: false });
    askGeminiJSON.mockResolvedValueOnce(criarRoadmapValido());

    const resultado = await gerarRoadmap(1, OBJETIVO_AREA_FRONT_END, 10);

    const todasEtapas = resultado.fases.flatMap(f => f.etapas);
    expect(todasEtapas.length).toBeGreaterThan(0);
    expect(todasEtapas.every(e => e.recurso_id === null)).toBe(true);

    const chamadasPendentes = handler.mock.calls.filter(([sql]) =>
      sql.toLowerCase().includes("insert into recursos_pendentes")
    );
    expect(chamadasPendentes.length).toBe(todasEtapas.length);
  });

  test("objetivo vaga com skills de dados → infere área 'dados' e usa o modelo de dados no fallback", async () => {
    instalarFakeDb({ habilidadesDaVaga: ["Python", "Pandas", "Estatística Básica"] });
    askGeminiJSON.mockRejectedValueOnce(new Error("429 Too Many Requests"));

    const resultado = await gerarRoadmap(1, { tipo: "vaga", vagaId: 10 }, 10);

    expect(resultado.origem).toBe("modelo");
    // Primeira fase de data/roadmaps-modelo/dados.json — confirma que foi
    // esse arquivo (e não front-end/back-end/full-stack) que foi carregado.
    expect(resultado.fases[0].nome).toBe("Fundamentos de Python e lógica");
  });

  test("objetivo vaga sem nenhuma skill conhecida → infere 'full-stack' no fallback", async () => {
    instalarFakeDb({ habilidadesDaVaga: ["COBOL", "Fortran"] });
    askGeminiJSON.mockRejectedValueOnce(new Error("429 Too Many Requests"));

    const resultado = await gerarRoadmap(1, { tipo: "vaga", vagaId: 11 }, 10);

    expect(resultado.origem).toBe("modelo");
    // Primeira fase de data/roadmaps-modelo/full-stack.json.
    expect(resultado.fases[0].nome).toBe("Fundamentos da Web");
  });
});

describe("inferirAreaDaVaga", () => {
  test("vaga com skills de dados (Python, Pandas, Estatística Básica) → 'dados'", async () => {
    instalarFakeDb({ habilidadesDaVaga: ["Python", "Pandas", "Estatística Básica"] });
    await expect(inferirAreaDaVaga(10)).resolves.toBe("dados");
  });

  test("vaga sem nenhuma skill presente em data/habilidades-referencia.json → 'full-stack'", async () => {
    instalarFakeDb({ habilidadesDaVaga: ["COBOL", "Fortran"] });
    await expect(inferirAreaDaVaga(11)).resolves.toBe("full-stack");
  });

  test("vaga sem nenhuma skill cadastrada (job_skills vazio) → 'full-stack'", async () => {
    instalarFakeDb({ habilidadesDaVaga: [] });
    await expect(inferirAreaDaVaga(12)).resolves.toBe("full-stack");
  });
});

describe("regenerarRoadmap", () => {
  test("preserva etapas concluídas (mesma habilidade) e substitui o resto, versao + 1", async () => {
    const concluidaEm = new Date("2026-01-01T00:00:00Z");
    instalarFakeDb({
      etapasConcluidas: [{ habilidade: "JavaScript", concluida_em: concluidaEm }],
      roadmapExistente: {
        id: 42, usuario_id: 1, tipo_objetivo: "area", vaga_id: null,
        area: "front-end", horas_semana: 10, versao: 1, status: "ativo",
      },
    });
    askGeminiJSON.mockResolvedValueOnce(criarRoadmapValido());

    const resultado = await regenerarRoadmap(42);

    expect(resultado.versao).toBe(2);

    const todasEtapas = resultado.fases.flatMap(f => f.etapas);
    const etapaJs = todasEtapas.find(e => e.habilidade === "JavaScript");
    expect(etapaJs.status).toBe("concluida");
    expect(etapaJs.concluida_em).toBe(concluidaEm);

    const outrasEtapas = todasEtapas.filter(e => e.habilidade !== "JavaScript");
    expect(outrasEtapas.every(e => e.status === "pendente")).toBe(true);
  });
});
