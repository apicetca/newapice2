const { plansForType, getPlan } = require("../config/plans");
const { getUserPlan, setUserPlan } = require("../services/subscriptionService");

const plansController = {
  // Planos disponíveis pro tipo do usuário logado — dev vê os planos de
  // dev, empresa vê os de empresa. Não expõe os planos do outro tipo.
  getPlans: async (req, res) => {
    try {
      const type = req.session.user.type === "empresa" ? "empresa" : "dev";
      const current = await getUserPlan(req.session.user.id, type);
      res.json({
        plans: plansForType(type),
        current_plan_code: current.code,
      });
    } catch (err) {
      console.error("[GET /api/plans]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },

  // Ativa um plano na hora, sem checkout de pagamento real — não há
  // gateway integrado ainda (ver config/plans.js). Isso é uma decisão
  // de produto temporária para prototipagem/demonstração: em produção
  // de verdade, isto precisa virar "pedido pendente até confirmação de
  // pagamento" antes de liberar o plano, não ativação direta como hoje.
  subscribe: async (req, res) => {
    const type = req.session.user.type === "empresa" ? "empresa" : "dev";
    const { plan_code } = req.body;

    const plan = getPlan(plan_code);
    if (!plan || plan.type !== type) {
      return res.status(400).json({ error: "Plano inválido." });
    }

    try {
      await setUserPlan(req.session.user.id, plan_code);
      res.json({ success: true, plan: { code: plan.code, name: plan.name, price_cents: plan.price_cents } });
    } catch (err) {
      console.error("[POST /api/plans/subscribe]", err.message);
      res.status(500).json({ error: "Erro interno. Tente novamente." });
    }
  },
};

module.exports = plansController;
