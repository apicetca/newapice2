// QA-005 — Endpoint público de insights de IA pode disparar N chamadas pagas simultâneas
// `generateInsights()` não tinha lock/fila: N requisições concorrentes, com a
// tabela `mercado_insights` ainda vazia, disparavam N chamadas independentes
// (e pagas) à API da Anthropic.
jest.mock('../../database/db', () => ({
  query: jest.fn(),
}));
jest.mock('../../services/geminiClient', () => ({
  askGeminiJSON: jest.fn(),
}));

const db = require('../../database/db');
const { askGeminiJSON } = require('../../services/geminiClient');
const { generateInsights } = require('../../services/marketInsights');

beforeEach(() => {
  jest.clearAllMocks();

  db.query.mockImplementation(async (sql) => {
    if (sql.includes('FROM job_skills')) {
      return [[{ name: 'Node.js', type: 'hard_skill', total_vagas: 10 }]];
    }
    if (sql.includes('INSERT INTO mercado_insights')) {
      return [{ insertId: 1 }];
    }
    return [[]];
  });

  askGeminiJSON.mockImplementation(
    () => new Promise(resolve => setTimeout(() => resolve({ resumo: 'resumo gerado' }), 20))
  );
});

describe('QA-005 — generateInsights() faz lock de chamadas concorrentes', () => {
  test('N chamadas simultâneas disparam só 1 requisição à IA', async () => {
    const [r1, r2, r3] = await Promise.all([
      generateInsights(),
      generateInsights(),
      generateInsights(),
    ]);

    expect(askGeminiJSON).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });

  test('chamadas em sequência (após a primeira terminar) geram uma nova requisição', async () => {
    await generateInsights();
    await generateInsights();

    expect(askGeminiJSON).toHaveBeenCalledTimes(2);
  });
});
