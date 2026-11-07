// tests/iaFetch.test.js
// public/js/ia-fetch.js — o fetch das telas de IA: prazo com AbortController,
// leitura segura da resposta e mensagem amigável quando algo falha.
const fs   = require("fs");
const path = require("path");
const { fetchIA } = require("../public/js/ia-fetch");

const ROOT = path.join(__dirname, "..");
const ler  = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");

const respostaHttp = (status, corpo) => ({ ok: status >= 200 && status < 300, status, text: async () => corpo });

afterEach(() => {
  delete global.fetch;
});

test("devolve o JSON da resposta e manda o signal do prazo", async () => {
  global.fetch = jest.fn().mockResolvedValue(respostaHttp(200, '{"resposta":"Olá!"}'));

  await expect(fetchIA("/api/ai/mentor/mensagem", { method: "POST" })).resolves.toEqual({ resposta: "Olá!" });
  expect(global.fetch.mock.calls[0][1]).toMatchObject({ method: "POST" });
  expect(global.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});

test("página de erro em HTML (ex.: Render reiniciando) vira mensagem amigável, repetível", async () => {
  global.fetch = jest.fn().mockResolvedValue(respostaHttp(502, "<html><body>Bad Gateway</body></html>"));

  await expect(fetchIA("/api/ai/insights-mercado")).rejects.toMatchObject({
    message: "Erro ao falar com a IA. Tente novamente em instantes.",
    status: 502,
    repetivel: true,
  });
});

test("503 da IA indisponível traz a mensagem do servidor e é repetível", async () => {
  global.fetch = jest.fn().mockResolvedValue(respostaHttp(503, '{"error":"Erro ao falar com o mentor. Tente novamente em instantes."}'));

  await expect(fetchIA("/api/ai/mentor/mensagem")).rejects.toMatchObject({
    message: "Erro ao falar com o mentor. Tente novamente em instantes.",
    status: 503,
    repetivel: true,
  });
});

test("erro do pedido (400) traz a mensagem do servidor e não é repetível", async () => {
  global.fetch = jest.fn().mockResolvedValue(respostaHttp(400, '{"error":"Arquivo muito grande. Envie até 2MB."}'));

  await expect(fetchIA("/api/ai/mentor/mensagem")).rejects.toMatchObject({
    message: "Arquivo muito grande. Envie até 2MB.",
    status: 400,
    repetivel: false,
  });
});

test("prazo esgotado aborta a requisição", async () => {
  global.fetch = jest.fn((url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));

  await expect(fetchIA("/api/ai/mentor/mensagem", {}, 20)).rejects.toMatchObject({
    message: "A IA demorou demais para responder. Tente novamente.",
    repetivel: true,
  });
  expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
});

test("falha de rede vira mensagem amigável, repetível", async () => {
  global.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));

  await expect(fetchIA("/api/ai/mentor/mensagem")).rejects.toMatchObject({
    message: "Não foi possível falar com o servidor. Verifique sua conexão e tente novamente.",
    repetivel: true,
  });
});

describe("telas de IA", () => {
  test.each([
    "views/mentor.ejs",
    "views/repositorios.ejs",
    "views/empresa-candidaturas.ejs",
    "views/vaga-publica.ejs",
    "views/insights-mercado.ejs",
  ])("%s usa o fetchIA", view => {
    const html = ler(view);
    expect(html).toContain('<script src="/js/ia-fetch.js"></script>');
    expect(html).toMatch(/fetchIA\(/);
  });

  test("o mentor oferece reenviar a mensagem que falhou", () => {
    const html = ler("views/mentor.ejs");
    expect(html).toContain('id="btn-mentor-reenviar"');
    expect(html).toMatch(/MENTOR_PRAZO_MS = 60000/);
  });

  test("os insights distinguem falha de \"sem dados\" e oferecem tentar de novo", () => {
    const html = ler("views/insights-mercado.ejs");
    expect(html).toContain('id="state-error"');
    expect(html).toContain('id="btn-tentar-novamente"');
  });
});
