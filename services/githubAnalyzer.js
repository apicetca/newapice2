// ============================================
// services/githubAnalyzer.js
// Analisa o perfil GitHub do usuário e detecta
// quais skills ele já possui com base nos repos
// ============================================
const axios = require("axios");
const db    = require("../database/db");
const {
  GitHubIndisponivelError, ehFalhaDeLeitura, registrarFalha,
} = require("./githubErrors");

// Sem timeout o axios espera para sempre; uma resposta que não chega é uma
// falha de leitura, não "repositório sem dados".
const GITHUB_TIMEOUT_MS = 15000;

// --------------------------------------------
// Leitura distinguindo três casos:
//   sucesso                → { falha: false, valor }
//   "não existe" (ex.: 404)→ { falha: false, valor: vazio }   (resultado normal)
//   falha (401, limite de uso, 429, 5xx, timeout, rede) → { falha: true, valor: vazio }
// --------------------------------------------
async function lerLinguagens(accessToken, repoFullName) {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${repoFullName}/languages`,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: GITHUB_TIMEOUT_MS }
    );
    // Retorna array com os nomes das linguagens em minúsculo
    // Ex: ["javascript", "css", "html"]
    return { falha: false, valor: Object.keys(res.data).map(l => l.toLowerCase()) };
  } catch (err) {
    if (ehFalhaDeLeitura(err)) {
      registrarFalha("linguagens", repoFullName, err);
      return { falha: true, valor: [] };
    }
    return { falha: false, valor: [] };
  }
}

async function lerReadme(accessToken, repoFullName) {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${repoFullName}/readme`,
      {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github.raw" },
        timeout: GITHUB_TIMEOUT_MS,
      }
    );
    return { falha: false, valor: res.data.toLowerCase() };
  } catch (err) {
    if (ehFalhaDeLeitura(err)) {
      registrarFalha("README", repoFullName, err);
      return { falha: true, valor: "" };
    }
    return { falha: false, valor: "" }; // README não encontrado — sem problema
  }
}

// --------------------------------------------
// Versões "simples" (mantidas para os outros chamadores — aiProfileAnalyzer,
// portfolioDescriber): devolvem [] / "" também em caso de falha, que fica
// registrada no log.
// --------------------------------------------
async function fetchRepoLanguages(accessToken, repoFullName) {
  return (await lerLinguagens(accessToken, repoFullName)).valor;
}

async function fetchRepoReadme(accessToken, repoFullName) {
  return (await lerReadme(accessToken, repoFullName)).valor;
}

// --------------------------------------------
// Função principal: analisa GitHub e salva
// as skills detectadas no banco de dados.
//
// Repositório cuja leitura falhou (limite de uso, token inválido, rede) fica
// de fora da conta — não vira "confiança 0" — e, nesse caso, a confiança já
// gravada nunca é reduzida. Se TODOS falharem, não grava nada.
// Retorna { status: "ok" | "parcial" | "indisponivel", skills, reposComFalha }.
// --------------------------------------------
async function analisarGitHub(accessToken, githubId, repos) {
  // Busca todas as skills que têm sinais do GitHub cadastrados
  const [allSkills] = await db.query(
    "SELECT * FROM skills WHERE github_signals IS NOT NULL"
  );

  // Para cada repositório, busca linguagens e README (em lotes de 5)
  const BATCH = 5;
  const repoData = [];
  let reposComFalha = 0;
  for (let i = 0; i < repos.length; i += BATCH) {
    const batch = repos.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (repo) => {
        const [linguagens, readme] = await Promise.all([
          lerLinguagens(accessToken, repo.full_name),
          lerReadme(accessToken, repo.full_name),
        ]);
        return { falha: linguagens.falha || readme.falha, languages: linguagens.valor, readme: readme.valor };
      })
    );
    for (const r of results) {
      if (r.falha) reposComFalha++;
      else repoData.push(r);
    }
  }

  if (repos.length > 0 && repoData.length === 0) {
    console.error(`[github-analyzer] leitura indisponível: ${reposComFalha} de ${repos.length} repositório(s) falharam; nada foi gravado`);
    return { status: "indisponivel", skills: [], reposComFalha };
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

  // Salva (ou atualiza) as skills detectadas no banco de dados. Com leitura
  // parcial, só sobe (GREATEST): o que ficou de fora pode ter pontuado antes.
  const atualiza = reposComFalha > 0
    ? "confidence = GREATEST(confidence, VALUES(confidence))"
    : "confidence = VALUES(confidence)";
  for (const skill of detectedSkills) {
    await db.query(`
      INSERT INTO user_skills (github_id, skill_id, source, confidence)
      VALUES (?, ?, 'github', ?)
      ON DUPLICATE KEY UPDATE ${atualiza}
    `, [githubId, skill.skill_id, skill.confidence]);
  }

  return { status: reposComFalha > 0 ? "parcial" : "ok", skills: detectedSkills, reposComFalha };
}

// Compatibilidade: devolve só a lista de skills detectadas (vazia se o GitHub
// estava indisponível). Quem precisa distinguir "indisponível" usa analisarGitHub.
async function matchSkillsFromGitHub(accessToken, githubId, repos) {
  return (await analisarGitHub(accessToken, githubId, repos)).skills;
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
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: GITHUB_TIMEOUT_MS }
    );
    return { existe: true, privado: Boolean(res.data.private), falha: false };
  } catch (err) {
    // Falha de leitura (limite de uso, token inválido, 5xx, timeout, rede):
    // NÃO é "repositório não existe" — quem chama avisa que o GitHub está
    // indisponível em vez de pedir pro usuário "conferir o link".
    if (ehFalhaDeLeitura(err)) {
      registrarFalha("repositório", repoFullName, err);
      return { existe: false, privado: null, falha: true };
    }
    // 404 (não existe) e 403 (sem permissão nenhuma, nem como dono) caem
    // aqui igual — a API do GitHub não distingue os dois de fora, então a
    // mensagem pro usuário também não tenta diferenciar.
    return { existe: false, privado: null, falha: false };
  }
}

// --------------------------------------------
// Confere, num único repositório, quais das habilidades informadas (com
// seus sinais de github_signals) aparecem nas linguagens ou no README —
// mesma fórmula de pontuação de matchSkillsFromGitHub (+40 linguagem, +20
// README), só que escopada a um repo e a uma lista de habilidades-alvo em
// vez do perfil inteiro. Reaproveita fetchRepoLanguages/fetchRepoReadme
// (as mesmas chamadas de API já usadas ali) em vez de duplicá-las. Lança
// GitHubIndisponivelError se a leitura falhar.
// habilidadesComSinais: [{ habilidade: "JavaScript", sinais: ["javascript","js"] }]
// --------------------------------------------
async function verificarHabilidadesNoRepo(accessToken, repoFullName, habilidadesComSinais) {
  const [linguagens, leitura] = await Promise.all([
    lerLinguagens(accessToken, repoFullName),
    lerReadme(accessToken, repoFullName),
  ]);
  // Falha de leitura nunca vira "habilidade faltando": quem chama trata como
  // GitHub indisponível e não mexe no status do projeto.
  if (linguagens.falha || leitura.falha) throw new GitHubIndisponivelError(repoFullName);
  const languages = linguagens.valor;
  const readme    = leitura.valor;

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
  matchSkillsFromGitHub, analisarGitHub, fetchRepoLanguages, fetchRepoReadme,
  verificarRepoPublico, verificarHabilidadesNoRepo,
};