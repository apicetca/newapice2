// tests/reanalyze.test.js
// Etapa 2 do plano de melhorias da análise de perfil: o botão "Reanalisar"
// (profileController.reanalyze → POST /api/user/reanalyze) avisa quando não
// consegue ler o GitHub, em vez de responder "0 skills detectadas".
jest.mock("axios", () => ({ get: jest.fn() }));
jest.mock("../database/db", () => ({ query: jest.fn() }));
jest.mock("../services/subscriptionService", () => ({ getUserPlan: jest.fn() }));
jest.mock("../services/githubAnalyzer", () => ({ analisarGitHub: jest.fn() }));

const axios = require("axios");
const { analisarGitHub } = require("../services/githubAnalyzer");
const { reanalyze } = require("../controllers/profileController");

const MENSAGEM = "Não conseguimos ler seu GitHub agora. Tente de novo em alguns minutos.";

function chamar(sessionUser = { id: 1, github_id: 42, accessToken: "tok" }) {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return reanalyze({ session: { user: sessionUser } }, res).then(() => res);
}

function erroAxios(status, extra = {}) {
  const e = new Error(`HTTP ${status}`);
  e.isAxiosError = true;
  if (status) e.response = { status, headers: {}, data: {}, ...extra };
  return e;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("POST /api/user/reanalyze — GitHub indisponível", () => {
  test("análise indisponível → 503 com a mensagem amigável (e não 'Análise concluída')", async () => {
    axios.get.mockResolvedValue({ data: [{ full_name: "u/a" }] });
    analisarGitHub.mockResolvedValue({ status: "indisponivel", skills: [], reposComFalha: 1 });

    const res = await chamar();

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: MENSAGEM });
  });

  test("token inválido (401) ao listar os repositórios → mesma mensagem, nada é analisado", async () => {
    axios.get.mockRejectedValue(erroAxios(401));

    const res = await chamar();

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: MENSAGEM });
    expect(analisarGitHub).not.toHaveBeenCalled();
  });

  test("limite de uso (403 rate limit) ao listar os repositórios → mensagem amigável", async () => {
    axios.get.mockRejectedValue(erroAxios(403, { headers: { "x-ratelimit-remaining": "0" } }));
    const res = await chamar();
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe(MENSAGEM);
  });

  test("análise ok → resposta de sucesso como antes", async () => {
    axios.get.mockResolvedValue({ data: [{ full_name: "u/a" }] });
    analisarGitHub.mockResolvedValue({ status: "ok", skills: [{ skill_id: 1, confidence: 40 }], reposComFalha: 0 });

    const res = await chamar();

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, detected: 1 });
    expect(res.body.message).toMatch(/Análise concluída\. 1 skill/);
  });

  test("análise parcial → sucesso (as skills lidas contam)", async () => {
    axios.get.mockResolvedValue({ data: [{ full_name: "u/a" }, { full_name: "u/b" }] });
    analisarGitHub.mockResolvedValue({ status: "parcial", skills: [{ skill_id: 1, confidence: 40 }], reposComFalha: 1 });
    const res = await chamar();
    expect(res.statusCode).toBe(200);
    expect(res.body.detected).toBe(1);
  });

  test("erro que NÃO é do GitHub continua sendo 500 genérico", async () => {
    axios.get.mockResolvedValue({ data: [] });
    analisarGitHub.mockRejectedValue(new Error("banco caiu"));
    const res = await chamar();
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/Erro ao re-analisar/);
  });

  test("conta sem token do GitHub segue com a resposta 400 de antes", async () => {
    const res = await chamar({ id: 1 });
    expect(res.statusCode).toBe(400);
  });
});
