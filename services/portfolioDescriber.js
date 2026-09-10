// ============================================
// services/portfolioDescriber.js
// Gera uma descrição profissional (via IA) para
// um repositório do portfólio automatizado, a
// partir do README e da linguagem do repo.
// ============================================
const db = require("../database/db");
const { askGeminiJSON } = require("./geminiClient");
const { fetchRepoReadme } = require("./githubAnalyzer");

const SYSTEM_PROMPT = `Você escreve descrições curtas e profissionais (2-3 frases, em
português) para projetos de portfólio de desenvolvedores. Responda SEMPRE em JSON puro
(sem markdown) no formato exato: { "descricao": "string" }`;

async function generateRepoDescription(userId, repoId, accessToken) {
  const [[repo]] = await db.query(
    "SELECT id, repo_name, repo_full_name, language, description FROM user_repositories WHERE id = ? AND user_id = ?",
    [repoId, userId]
  );
  if (!repo) throw new Error("Repositório não encontrado.");

  const readme = await fetchRepoReadme(accessToken, repo.repo_full_name);

  // LGPD: só nome do repo, linguagem e trecho do README vão pro prompt —
  // nenhum dado pessoal do usuário.
  const payload = {
    nome: repo.repo_name,
    linguagem: repo.language,
    descricao_atual: repo.description,
    readme_excerpt: readme.slice(0, 2000),
  };

  const result = await askGeminiJSON({
    system: SYSTEM_PROMPT,
    prompt: `Gere uma descrição de portfólio para este projeto:\n${JSON.stringify(payload)}`,
    maxTokens: 1536,
  });

  const descricao = result.descricao ?? "";
  await db.query(
    "UPDATE user_repositories SET ai_description = ? WHERE id = ? AND user_id = ?",
    [descricao, repoId, userId]
  );

  return descricao;
}

module.exports = { generateRepoDescription };
