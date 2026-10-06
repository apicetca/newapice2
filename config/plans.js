// ============================================
// config/plans.js
// Definição estática dos planos do modelo Freemium
// (ver documentação de monetização). Sem gateway de
// pagamento escolhido ainda — enquanto isso, o "checkout"
// é manual via admin (ver services/subscriptionService.js).
//
// Objeto estático em vez de tabela: são 5 planos fixos,
// sem UI de "criar plano novo" prevista no escopo atual.
// ============================================

const PLANS = {
  dev_free: {
    type: "dev",
    code: "dev_free",
    name: "Gratuito",
    price_cents: 0,
    features: {
      roadmap_personalizado: false, // inclui as recomendações de cursos/skills
      destaque_perfil:       false,
      mentor_carreira:       false,
      simulador_entrevista:  false,
      verificacao_projetos:  false, // análise de repositório do projeto da fase — Free fecha por autodeclaração
    },
    // Limites do sistema de Roadmap (fases/etapas via IA — docs/roadmap-spec.md,
    // seção "Planos Free e PRO"). Mesmo padrão de max_active_jobs abaixo:
    // limite numérico fica no plano, não espalhado pelo código.
    roadmap: {
      max_ativos:           1,
      regen_intervalo_dias: 30, // 1 regeneração por mês
    },
  },
  dev_pro: {
    type: "dev",
    code: "dev_pro",
    name: "PRO",
    price_cents: 1990,
    features: {
      roadmap_personalizado: true,
      destaque_perfil:       true,
      mentor_carreira:       true, // chatbot de mentoria de carreira (IA)
      simulador_entrevista:  true, // simulador de entrevista técnica (IA)
      verificacao_projetos:  true,
    },
    roadmap: {
      max_ativos:           5,
      regen_intervalo_dias: 7, // 1 regeneração por semana
    },
  },

  empresa_free: {
    type: "empresa",
    code: "empresa_free",
    name: "Free",
    price_cents: 0,
    max_active_jobs: 1,
  },
  empresa_basico: {
    type: "empresa",
    code: "empresa_basico",
    name: "Básico",
    price_cents: 4990,
    max_active_jobs: 3,
  },
  empresa_premium: {
    type: "empresa",
    code: "empresa_premium",
    name: "Premium",
    price_cents: 9990,
    max_active_jobs: null, // null = ilimitado
  },
};

const DEFAULT_PLAN_BY_TYPE = { dev: "dev_free", empresa: "empresa_free" };

function getPlan(code) {
  return PLANS[code] ?? null;
}

function plansForType(type) {
  return Object.values(PLANS).filter(p => p.type === type);
}

module.exports = { PLANS, DEFAULT_PLAN_BY_TYPE, getPlan, plansForType };
