// QA-006 — Recursos de IA exclusivos de dev não checam o tipo de conta
// As rotas POST /api/ai/mentor/mensagem e POST /api/ai/entrevista/iniciar
// (e as demais de mentor/entrevista) só checavam isAuth — nunca
// `req.session.user.type === "dev"`, diferente das rotas de página
// equivalentes em server.js, que redirecionam quem não é dev. Hoje isso
// não vaza porque os planos de empresa não têm `features`, mas é uma
// checagem de autorização ausente, não uma garantia.
// (As rotas de entrevista foram removidas depois: a simulação de
// entrevista técnica passou a ser feita pelo próprio mentor.)
jest.mock('../../services/subscriptionService', () => ({
  hasFeature: jest.fn().mockResolvedValue(true), // simula um plano futuro que "vazaria" a feature
}));
jest.mock('../../services/matchCalculator', () => ({
  getMatchExplanation: jest.fn(),
}));
jest.mock('../../services/mentorChat', () => ({
  getHistory: jest.fn().mockResolvedValue([]),
  sendMessage: jest.fn().mockResolvedValue('resposta do mentor'),
}));
jest.mock('../../services/marketInsights', () => ({
  getLatestInsights: jest.fn(),
  generateInsights: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const aiRoutes = require('../../routes/ai');

function buildApp(sessionUser) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { user: sessionUser };
    next();
  });
  app.use('/api/ai', aiRoutes);
  return app;
}

describe('QA-006 — rotas de IA exclusivas de dev checam o tipo de conta', () => {
  test('POST /api/ai/mentor/mensagem retorna 403 para conta empresa', async () => {
    const app = buildApp({ id: 1, type: 'empresa' });
    const res = await request(app)
      .post('/api/ai/mentor/mensagem')
      .send({ mensagem: 'Oi' });

    expect(res.status).toBe(403);
  });

  test('POST /api/ai/mentor/mensagem funciona normalmente para conta dev', async () => {
    const app = buildApp({ id: 1, type: 'dev', github_id: 1, nivel: 'iniciante' });
    const res = await request(app)
      .post('/api/ai/mentor/mensagem')
      .send({ mensagem: 'Oi' });

    expect(res.status).toBe(201);
  });
});
