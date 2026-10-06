// ============================================
// services/githubAnalyzer.js
// Analisa o perfil GitHub do usuário e detecta
// quais skills ele já possui com base nos repos
// ============================================
const axios = require("axios");
const db    = require("../database/db");

// --------------------------------------------
// Busca todas as linguagens usadas nos repos
// --------------------------------------------
async function fetchRepoLanguages(accessToken, repoFullName) {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${repoFullName}/languages`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    // Retorna array com os nomes das linguagens em minúsculo
    // Ex: ["javascript", "css", "html"]
    return Object.keys(res.data).map(l => l.toLowerCase());
  } catch {
    return [];
  }
}

// --------------------------------------------
// Busca o README de um repositório
// --------------------------------------------
async function fetchRepoReadme(accessToken, repoFullName) {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${repoFullName}/readme`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github.raw" } }
    );
    return res.data.toLowerCase();
  } catch {
    return ""; // README não encontrado — sem problema
  }
}

// --------------------------------------------
// Função principal: analisa GitHub e salva
// as skills detectadas no banco de dados
// --------------------------------------------
async function matchSkillsFromGitHub(accessToken, githubId, repos) {
  // Busca todas as skills que têm sinais do GitHub cadastrados
  const [allSkills] = await db.query(
    "SELECT * FROM skills WHERE github_signals IS NOT NULL"
  );

  // Para cada repositório, busca linguagens e README (em lotes de 5)
  const BATCH = 5;
  const repoData = [];
  for (let i = 0; i < repos.length; i += BATCH) {
    const batch = repos.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (repo) => ({
        languages: await fetchRepoLanguages(accessToken, repo.full_name),
        readme:    await fetchRepoReadme(accessToken, repo.full_name),
      }))
    );
    repoData.push(...results);
  }

  const detectedSkills = [];

  for (const skill of allSkills) {
    // Converte a string de sinais em array
    // Ex: "express,node,nodejs" → ["express", "node", "nodejs"]
    const signals = skill.github_signals.split(",").map(s => s.trim());

    let confidence = 0;

    for (const repo of repoData) {
      for (const signal of signals) {
        // Sinal encontrado como linguagem do repositório (+40 pontos)
        if (repo.languages.includes(signal)) {
          confidence += 40;
        }
        // Sinal encontrado no README do repositório (+20 pontos)
        if (repo.readme.includes(signal)) {
          confidence += 20;
        }
      }
    }

    // Só considera detectada se a confiança for maior que zero
    if (confidence > 0) {
      detectedSkills.push({
        skill_id:   skill.id,
        confidence: Math.min(confidence, 100), // máximo 100
      });
    }
  }

  // Salva (ou atualiza) as skills detectadas no banco
  for (const skill of detectedSkills) {
    await db.query(`
      INSERT INTO user_skills (github_id, skill_id, source, confidence)
      VALUES (?, ?, 'github', ?)
      ON DUPLICATE KEY UPDATE confidence = VALUES(confidence)
    `, [githubId, skill.skill_id, skill.confidence]);
  }

  return detectedSkills;
}

// --------------------------------------------
// Verifica se um repositório existe e é público — usado na verificação do
// projeto prático de uma fase do roadmap (docs/roadmap-spec.md, "Progresso
// e verificação"). Chamado com o accessToken do próprio dono do roadmap:
// se o repo for dele e estiver privado, a API devolve o recurso normalmente
// (com private:true) em vez de 404 — só assim dá pra diferenciar "privado"
// de "não existe/link errado", como a spec pede.
// --------------------------------------------
async function verificarRepoPublico(accessToken, repoFullName) {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${repoFullName}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return { existe: true, privado: Boolean(res.data.private) };
  } catch {
    // 404 (não existe) e 403 (sem permissão nenhuma, nem como dono) caem
    // aqui igual — a API do GitHub não distingue os dois de fora, então a
    // mensagem pro usuário também não tenta diferenciar.
    return { existe: false, privado: null };
  }
}

// --------------------------------------------
// Confere, num único repositório, quais das habilidades informadas (com
// seus sinais de github_signals) aparecem nas linguagens ou no README —
// mesma fórmula de pontuação de matchSkillsFromGitHub (+40 linguagem, +20
// README), só que escopada a um repo e a uma lista de habilidades-alvo em
// vez do perfil inteiro. Reaproveita fetchRepoLanguages/fetchRepoReadme
// (as mesmas chamadas de API já usadas ali) em vez de duplicá-las.
// habilidadesComSinais: [{ habilidade: "JavaScript", sinais: ["javascript","js"] }]
// --------------------------------------------
async function verificarHabilidadesNoRepo(accessToken, repoFullName, habilidadesComSinais) {
  const [languages, readme] = await Promise.all([
    fetchRepoLanguages(accessToken, repoFullName),
    fetchRepoReadme(accessToken, repoFullName),
  ]);

  return habilidadesComSinais.map(({ habilidade, sinais }) => {
    let confidence = 0;
    for (const sinal of sinais) {
      if (languages.includes(sinal)) confidence += 40;
      if (readme.includes(sinal)) confidence += 20;
    }
    return { habilidade, confidence: Math.min(confidence, 100), encontrada: confidence > 0 };
  });
}

module.exports = {
  matchSkillsFromGitHub, fetchRepoLanguages, fetchRepoReadme,
  verificarRepoPublico, verificarHabilidadesNoRepo,
};