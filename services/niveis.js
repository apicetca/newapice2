// ============================================
// services/niveis.js
// Ordinalização dos níveis — fonte única, importada por
// services/matchCalculator.js (nota de senioridade) e
// services/roadmapService.js (gap por área). Antes cada arquivo tinha a sua
// cópia (docs/analise-perfil.md, limitação 7).
// ============================================

// Nível do dev (declarado em user_dev_profiles.nivel / derivado da confiança).
const NIVEL_ORDER = Object.freeze({ iniciante: 0, intermediario: 1, avancado: 2 });

// Senioridade da vaga (jobs.level).
const LEVEL_ORDER = Object.freeze({ estagio: 0, junior: 1, pleno: 2 });

module.exports = { NIVEL_ORDER, LEVEL_ORDER };
