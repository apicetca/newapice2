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
const { ARQUIVOS_DEPENDENCIAS, extrairPacotes } = require("./dependencyParser");
const { combinar, lerDeclaracoes, declaradaDe } = require("./skillOrigem");

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
// Pacotes declarados nos arquivos de dependências da RAIZ do repositório
// (package.json, requirements.txt…): UMA chamada para listar a raiz e uma por
// arquivo encontrado. Mesma regra de falha das outras leituras: repositório
// vazio (404) não é falha; limite de uso, token inválido, rede etc. são.
// Arquivo mal formado é ignorado (extrairPacotes nunca lança).
// --------------------------------------------
const ARQUIVOS_PROCURADOS = new Set(ARQUIVOS_DEPENDENCIAS.map(n => n.toLowerCase()));

async function lerDependencias(accessToken, repoFullName) {
  let raiz;
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${repoFullName}/contents`,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: GITHUB_TIMEOUT_MS }
    );
    raiz = Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    if (ehFalhaDeLeitura(err)) {
      registrarFalha("lista de arquivos", repoFullName, err);
      return { falha: true, valor: [] };
    }
    return { falha: false, valor: [] }; // repositório vazio — sem dependências
  }

  const arquivos = raiz.filter(item =>
    item && item.type === "file" && ARQUIVOS_PROCURADOS.has(String(item.name).toLowerCase())
  );

  const pacotes = new Set();
  for (const arquivo of arquivos) {
    try {
      const res = await axios.get(
        `https://api.github.com/repos/${repoFullName}/contents/${encodeURIComponent(arquivo.name)}`,
        {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github.raw" },
          timeout: GITHUB_TIMEOUT_MS,
          transformResponse: [dados => dados], // texto puro: package.json mal formado não pode quebrar aqui
        }
      );
      const texto = typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? "");
      for (const pacote of extrairPacotes(arquivo.name, texto)) pacotes.add(pacote);
    } catch (err) {
      if (ehFalhaDeLeitura(err)) {
        registrarFalha(arquivo.name, repoFullName, err);
        return { falha: true, valor: [] };
      }
      // 404 entre a listagem e o download: segue sem esse arquivo
    }
  }
  return { falha: false, valor: [...pacotes] };
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
// Pontuação de UMA skill em UM repositório — única fórmula, usada pela
// análise do perfil e pela verificação de projetos:
//   +40 se QUALQUER sinal da skill está nas linguagens do repositório OU é o
//       nome de um pacote dos arquivos de dependências (não soma duas vezes)
//   +20 se QUALQUER sinal aparece no README como palavra inteira
// Sinônimos (react, reactjs, jsx) não somam entre si.
// --------------------------------------------
const PONTOS_LINGUAGEM = 40; // também vale para dependência
const PONTOS_README    = 20;
const CONFIANCA_MAXIMA = 100;

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Palavra inteira: antes e depois do sinal não pode haver letra nem número.
// Não usa \b porque \b falha com sinais que terminam em + ou # (c++, c#) e
// não reconhece letras acentuadas.
function aparecePalavraInteira(texto, sinal) {
  if (!sinal) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaparRegex(sinal)}(?![\\p{L}\\p{N}])`, "u").test(texto);
}

function normalizarSinais(sinais) {
  return sinais.map(s => String(s).trim().toLowerCase()).filter(Boolean);
}

// Evidências de UMA skill em UM repositório, já com os pontos. A evidência de
// +40 é "linguagem" quando o sinal está nas linguagens; senão, "dependencia".
// Ex.: [{ tipo: "dependencia", pontos: 40 }, { tipo: "readme", pontos: 20 }]
function evidenciasSkillNoRepo(sinais, languages, readme, dependencias = []) {
  const lista = normalizarSinais(sinais);
  const evidencias = [];
  if (lista.some(s => languages.includes(s))) {
    evidencias.push({ tipo: "linguagem", pontos: PONTOS_LINGUAGEM });
  } else if (lista.some(s => dependencias.includes(s))) {
    evidencias.push({ tipo: "dependencia", pontos: PONTOS_LINGUAGEM });
  }
  if (lista.some(s => aparecePalavraInteira(readme, s))) {
    evidencias.push({ tipo: "readme", pontos: PONTOS_README });
  }
  return evidencias;
}

function pontuarSkillNoRepo(sinais, languages, readme, dependencias = []) {
  return evidenciasSkillNoRepo(sinais, languages, readme, dependencias)
    .reduce((total, e) => total + e.pontos, 0);
}

// --------------------------------------------
// Função principal: analisa GitHub e salva
// as skills detectadas no banco de dados.
//
// Repositório cuja leitura falhou (limite de uso, token inválido, rede) fica
// de fora da conta — não vira "confiança 0" — e, nesse caso, a confiança já
// gravada nunca é reduzida. Se TODOS falharem, não grava nada.
// Repositórios usados: se opcoes.userId é informado e o dev importou
// repositórios em /repositorios (user_repositories), só esses contam; senão,
// os mais recentes recebidos em `repos`. Forks nunca contam.
//
// Cada análise também grava, numa transação, de onde veio cada ponto
// (user_skill_evidencias) — é o "por quê?" das skills no perfil.
// Retorna { status: "ok" | "parcial" | "indisponivel", skills, reposComFalha }.
// --------------------------------------------
async function analisarGitHub(accessToken, githubId, repos, opcoes = {}) {
  // Busca todas as skills que têm sinais do GitHub cadastrados
  const [allSkills] = await db.query(
    "SELECT * FROM skills WHERE github_signals IS NOT NULL"
  );

  const candidatos = opcoes.userId
    ? await selecionarRepositorios(accessToken, opcoes.userId, repos)
    : repos;

  // Forks ficam de fora: o código não foi escrito pelo dev.
  const proprios = candidatos.filter(repo => !repo.fork);

  // Para cada repositório, busca linguagens, README e dependências (em lotes de 5)
  const BATCH = 5;
  const repoData = [];
  let reposComFalha = 0;
  for (let i = 0; i < proprios.length; i += BATCH) {
    const batch = proprios.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (repo) => {
        const [linguagens, readme, dependencias] = await Promise.all([
          lerLinguagens(accessToken, repo.full_name),
          lerReadme(accessToken, repo.full_name),
          lerDependencias(accessToken, repo.full_name),
        ]);
        return {
          full_name:    repo.full_name,
          falha:        linguagens.falha || readme.falha || dependencias.falha,
          languages:    linguagens.valor,
          readme:       readme.valor,
          dependencias: dependencias.valor,
        };
      })
    );
    for (const r of results) {
      if (r.falha) reposComFalha++;
      else repoData.push(r);
    }
  }

  if (proprios.length > 0 && repoData.length === 0) {
    console.error(`[github-analyzer] leitura indisponível: ${reposComFalha} de ${proprios.length} repositório(s) falharam; nada foi gravado`);
    return { status: "indisponivel", skills: [], reposComFalha };
  }

  const detectedSkills = [];
  const evidencias = []; // [github_id, skill_id, repo_full_name, tipo, pontos]

  for (const skill of allSkills) {
    // Converte a string de sinais em array
    // Ex: "express,node,nodejs" → ["express", "node", "nodejs"]
    const signals = skill.github_signals.split(",").map(s => s.trim());

    // Soma, repositório a repositório, +40 (linguagem ou dependência) e +20
    // (README por palavra inteira) — ver evidenciasSkillNoRepo.
    let confidence = 0;
    for (const repo of repoData) {
      for (const ev of evidenciasSkillNoRepo(signals, repo.languages, repo.readme, repo.dependencias)) {
        confidence += ev.pontos;
        evidencias.push([githubId, skill.id, repo.full_name, ev.tipo, ev.pontos]);
      }
    }

    // Só considera detectada se a confiança for maior que zero
    if (confidence > 0) {
      detectedSkills.push({
        skill_id:   skill.id,
        confidence: Math.min(confidence, CONFIANCA_MAXIMA),
      });
    }
  }

  await gravarResultado(githubId, detectedSkills, evidencias, {
    parcial:   reposComFalha > 0,
    reposLidos: repoData.map(r => r.full_name),
  });

  return { status: reposComFalha > 0 ? "parcial" : "ok", skills: detectedSkills, reposComFalha };
}

// --------------------------------------------
// Grava skills e evidências numa TRANSAÇÃO.
// - Leitura completa: as evidências antigas do dev são substituídas pelas novas.
// - Leitura parcial: só as evidências dos repositórios lidos agora são
//   substituídas, e a confiança só sobe — o que ficou de fora pode ter
//   pontuado antes.
// - A confiança gravada é a maior entre a detectada agora e a declarada pelo
//   dev (Etapa 7); `source` é a origem desse valor.
// Se a tabela de evidências ainda não existe (migração não rodada), as skills
// são gravadas normalmente e o problema vai para o log.
// --------------------------------------------
async function gravarResultado(githubId, detectedSkills, evidencias, { parcial, reposLidos }) {
  const conn = await db.getConnection();
  let semTabelaEvidencias = false;
  const naTabelaDeEvidencias = async (sql, params) => {
    if (semTabelaEvidencias) return;
    try {
      await conn.query(sql, params);
    } catch (err) {
      if (err.code !== "ER_NO_SUCH_TABLE") throw err;
      semTabelaEvidencias = true;
      console.error("[github-analyzer] tabela user_skill_evidencias não existe — rode `npm run migrate:analise-perfil`. Skills gravadas sem evidências.");
    }
  };

  try {
    await conn.beginTransaction();

    if (!parcial) {
      await naTabelaDeEvidencias("DELETE FROM user_skill_evidencias WHERE github_id = ?", [githubId]);
    } else if (reposLidos.length) {
      await naTabelaDeEvidencias(
        "DELETE FROM user_skill_evidencias WHERE github_id = ? AND repo_full_name IN (?)",
        [githubId, reposLidos]
      );
    }

    // Detectada × declarada (services/skillOrigem.js): a parte detectada é a
    // desta análise; a declaração do dev serve de piso; `source` é a origem do
    // valor que ficou.
    if (detectedSkills.length) {
      const declaracoes = await lerDeclaracoes(conn, githubId);
      const [linhas] = await conn.query(
        "SELECT skill_id, source, confidence FROM user_skills WHERE github_id = ?",
        [githubId]
      );
      const atuais = new Map(linhas.map(l => [Number(l.skill_id), l]));

      for (const skill of detectedSkills) {
        const atual = atuais.get(Number(skill.skill_id));
        const final = combinar(skill.confidence, declaradaDe(declaracoes, skill.skill_id, atual));
        // Leitura parcial: nunca reduz — o que ficou de fora pode ter pontuado antes.
        if (parcial && atual && Number(atual.confidence) >= final.confidence) continue;
        await conn.query(`
          INSERT INTO user_skills (github_id, skill_id, source, confidence)
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE source = VALUES(source), confidence = VALUES(confidence)
        `, [githubId, skill.skill_id, final.source, final.confidence]);
      }
    }

    if (evidencias.length) {
      await naTabelaDeEvidencias(
        "INSERT INTO user_skill_evidencias (github_id, skill_id, repo_full_name, tipo, pontos) VALUES ?",
        [evidencias]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// --------------------------------------------
// Repositórios que entram na análise: os importados pelo dev em
// /repositorios, se houver; senão, a lista recebida (os mais recentes).
// A lista importada não guarda se o repositório é fork, então essa
// informação vem da lista recebida ou, para os que não estão nela, de
// GET /repos/{r} (uma chamada por repositório). Se essa leitura falhar, o
// repositório segue na lista e a regra de falha da análise decide.
// --------------------------------------------
async function selecionarRepositorios(accessToken, userId, reposRecentes) {
  const [importados] = await db.query(
    "SELECT repo_full_name FROM user_repositories WHERE user_id = ? ORDER BY added_at DESC",
    [userId]
  );
  if (!importados.length) return reposRecentes;

  const recentesPorNome = new Map(reposRecentes.map(r => [String(r.full_name).toLowerCase(), r]));
  return Promise.all(importados.map(async ({ repo_full_name }) => {
    const conhecido = recentesPorNome.get(String(repo_full_name).toLowerCase());
    if (conhecido) return conhecido;
    try {
      const res = await axios.get(
        `https://api.github.com/repos/${repo_full_name}`,
        { headers: { Authorization: `Bearer ${accessToken}` }, timeout: GITHUB_TIMEOUT_MS }
      );
      return { full_name: repo_full_name, fork: Boolean(res.data?.fork) };
    } catch {
      return { full_name: repo_full_name, fork: false };
    }
  }));
}

// Compatibilidade: devolve só a lista de skills detectadas (vazia se o GitHub
// estava indisponível). Quem precisa distinguir "indisponível" usa analisarGitHub.
async function matchSkillsFromGitHub(accessToken, githubId, repos, opcoes = {}) {
  return (await analisarGitHub(accessToken, githubId, repos, opcoes)).skills;
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
  const [linguagens, leitura, deps] = await Promise.all([
    lerLinguagens(accessToken, repoFullName),
    lerReadme(accessToken, repoFullName),
    lerDependencias(accessToken, repoFullName),
  ]);
  // Falha de leitura nunca vira "habilidade faltando": quem chama trata como
  // GitHub indisponível e não mexe no status do projeto.
  if (linguagens.falha || leitura.falha || deps.falha) throw new GitHubIndisponivelError(repoFullName);
  const languages    = linguagens.valor;
  const readme       = leitura.valor;
  const dependencias = deps.valor;

  return habilidadesComSinais.map(({ habilidade, sinais }) => {
    const confidence = Math.min(pontuarSkillNoRepo(sinais, languages, readme, dependencias), CONFIANCA_MAXIMA);
    return { habilidade, confidence, encontrada: confidence > 0 };
  });
}

module.exports = {
  matchSkillsFromGitHub, analisarGitHub, fetchRepoLanguages, fetchRepoReadme,
  verificarRepoPublico, verificarHabilidadesNoRepo,
  pontuarSkillNoRepo, evidenciasSkillNoRepo, aparecePalavraInteira, lerDependencias,
};