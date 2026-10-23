// ============================================
// services/skillOrigem.js
// Regra única de como a confiança DETECTADA no GitHub e a confiança
// DECLARADA pelo dev (autodiagnóstico) se combinam em user_skills
// (docs/analise-perfil-plano.md, Etapa 7, opção B):
//
//   - a parte detectada é recalculada a cada análise do GitHub;
//   - a declaração serve de piso;
//   - vale a MAIOR das duas, e `source` é a origem desse valor
//     ('github' em caso de empate) — o selo nunca diz "detectada" para um
//     número que veio da declaração, nem o contrário.
//
// As declarações ficam em user_skill_declaracoes. Linha antiga com
// source = 'manual' e sem declaração (anterior a esta etapa) vale como
// declaração com a própria confiança — "skills manuais antigas (70)
// continuam como estão".
// ============================================

// Nível declarado → confiança, dentro das faixas de confidenceToNivel
// (1–40 iniciante, 41–70 intermediário, >70 avançado).
const CONFIANCA_POR_NIVEL = { iniciante: 30, intermediario: 60, avancado: 85 };
const NIVEIS_DECLARADOS = Object.keys(CONFIANCA_POR_NIVEL);

const CONFIANCA_MAXIMA = 100;

/** Combina detectada × declarada. Retorna null se as duas forem 0. */
function combinar(detectada, declarada) {
  const d = Math.max(0, Number(detectada) || 0);
  const m = Math.max(0, Number(declarada) || 0);
  if (d === 0 && m === 0) return null;
  return m > d
    ? { confidence: m, source: "manual" }
    : { confidence: d, source: "github" };
}

const semTabela = (err) => err && err.code === "ER_NO_SUCH_TABLE";

/**
 * Declarações do dev: Map(skill_id → confiança declarada), ou null se a
 * tabela ainda não existe (migração não rodada).
 */
async function lerDeclaracoes(conn, githubId) {
  try {
    const [rows] = await conn.query(
      "SELECT skill_id, confidence FROM user_skill_declaracoes WHERE github_id = ?",
      [githubId]
    );
    return new Map(rows.map(r => [Number(r.skill_id), Number(r.confidence)]));
  } catch (err) {
    if (semTabela(err)) return null;
    throw err;
  }
}

/** Confiança declarada de uma skill, com a regra das linhas manuais antigas. */
function declaradaDe(declaracoes, skillId, linhaAtual) {
  const registrada = declaracoes?.get(Number(skillId));
  if (registrada != null) return registrada;
  return linhaAtual?.source === "manual" ? Number(linhaAtual.confidence) || 0 : 0;
}

/**
 * Confiança detectada no GitHub para uma skill, a partir das evidências
 * gravadas na última análise (soma dos pontos, teto 100). Sem a tabela de
 * evidências, usa a linha atual se ela veio do GitHub.
 */
async function detectadaDe(conn, githubId, skillId, linhaAtual) {
  try {
    const [[row]] = await conn.query(
      "SELECT COALESCE(SUM(pontos), 0) AS total FROM user_skill_evidencias WHERE github_id = ? AND skill_id = ?",
      [githubId, skillId]
    );
    return Math.min(Number(row?.total) || 0, CONFIANCA_MAXIMA);
  } catch (err) {
    if (!semTabela(err)) throw err;
    return linhaAtual?.source === "github" ? Number(linhaAtual.confidence) || 0 : 0;
  }
}

module.exports = {
  CONFIANCA_POR_NIVEL, NIVEIS_DECLARADOS,
  combinar, lerDeclaracoes, declaradaDe, detectadaDe,
};
