// ============================================
// services/aiProfileAnalyzer.js
// Análise de repositórios via IA: além da extração
// estática (linguagem, dependências) já feita por
// githubAnalyzer.js, pede pra Claude uma leitura
// qualitativa do perfil técnico do usuário.
// Resultado é cacheado em perfil_tecnico_ia — não
// reprocessa a cada acesso.
// ============================================
const db = require("../database/db");
const { askGeminiJSON } = require("./geminiClient");
const { fetchRepoReadme } = require("./githubAnalyzer");

const SYSTEM_PROMPT = `Você é um avaliador técnico que analisa repositórios de código de
desenvolvedores iniciantes. A partir de READMEs e estrutura de pastas, responda
SEMPRE em JSON puro (sem markdown, sem texto fora do JSON) no formato exato:
{
  "proficiencia_estimada": "iniciante" | "intermediario" | "avancado",
  "boas_praticas": ["string", ...],
  "pontos_melhoria": ["string", ...]
}`;

async function getCachedProfile(userId) {
  const [[row]] = await db.query(
    "SELECT * FROM perfil_tecnico_ia WHERE user_id = ?",
    [userId]
  );
  return row ?? null;
}

// Monta o payload que vai pra IA — LGPD: envia só sinais técnicos
// (linguagem, nome do repo, trecho de README), nunca nome completo,
// e-mail ou qualquer outro dado pessoal do candidato.
function buildRepoPayload(repos, readmes) {
  return repos.map((repo, i) => ({
    nome: repo.repo_name,
    linguagem: repo.language,
    descricao: repo.description,
    readme_excerpt: (readmes[i] || "").slice(0, 1500),
  }));
}

async function analyzeUserProfile(userId, accessToken) {
  const [repos] = await db.query(
    "SELECT repo_name, repo_full_name, language, description FROM user_repositories WHERE user_id = ?",
    [userId]
  );

  if (!repos.length) {
    throw new Error("Usuário não tem repositórios importados.");
  }

  const readmes = await Promise.all(
    repos.map(r => fetchRepoReadme(accessToken, r.repo_full_name))
  );

  const payload = buildRepoPayload(repos, readmes);
  const result = await askGeminiJSON({
    system: SYSTEM_PROMPT,
    prompt: `Analise estes repositórios e responda no formato JSON pedido:\n${JSON.stringify(payload)}`,
    maxTokens: 2048,
  });

  await db.query(
    `INSERT INTO perfil_tecnico_ia (user_id, proficiencia_estimada, boas_praticas, pontos_melhoria)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       proficiencia_estimada = VALUES(proficiencia_estimada),
       boas_praticas         = VALUES(boas_praticas),
       pontos_melhoria       = VALUES(pontos_melhoria)`,
    [
      userId,
      result.proficiencia_estimada ?? null,
      JSON.stringify(result.boas_praticas ?? []),
      JSON.stringify(result.pontos_melhoria ?? []),
    ]
  );

  return getCachedProfile(userId);
}

module.exports = { getCachedProfile, analyzeUserProfile };
