// ============================================
// services/aiTools.js
// Function calling do assistente de IA — cada
// tool aqui reflete uma consulta que JÁ EXISTE no
// banco/serviços do projeto (jobs, skills, roadmap,
// portfólio). Nada é inventado: não existe tool de
// "currículo" ou "cursos" porque essas entidades não
// existem no schema (ver services/userContextService.js
// e o mapeamento do projeto).
//
// Segurança: o modelo só decide QUAIS argumentos passar
// (ex.: filtros de busca) — toda tool aqui valida os
// argumentos recebidos e nunca aceita um user_id/github_id
// vindo do modelo; a identidade do usuário sempre vem da
// sessão autenticada, passada por quem chama a tool, nunca
// dos argumentos gerados pela IA.
//
// TODO (não implementado agora — arquitetura preparada, ver comentários):
//
// 1. Google Search — o SDK @google/genai suporta uma tool nativa
//    { type: "google_search", search_types?: [...] } (não é uma function
//    declarada por nós, é um tool builtin do provedor). Daria pra somar
//    a TOOL_DECLARATIONS condicionalmente (ex: só quando a pergunta
//    parecer exigir informação atual/recente — "tecnologia mais recente",
//    "o que mudou em X"), pra não pagar o custo dessa busca em toda
//    mensagem. Não ativado por padrão nesta implementação.
//
// 2. File Search / RAG — o SDK também suporta uma tool nativa
//    { type: "file_search", file_search_store_names: [...] }, que
//    dependeria de: (a) subir os materiais da plataforma (roadmaps,
//    guias, documentação) pra um File Search Store via ai.fileSearchStores
//    do SDK, e (b) manter esse store atualizado quando o conteúdo mudar.
//    Isso é infraestrutura nova que o projeto não tem hoje (não existe
//    pasta de materiais/guias versionada pra virar RAG) — não implementado
//    aqui pra não improvisar uma fonte de dados que não existe. Quando
//    esse conteúdo existir, a tool entra em TOOL_DECLARATIONS do mesmo
//    jeito que as funções abaixo, e MENTOR_SYSTEM_INSTRUCTION (em
//    mentorChat.js) ganha uma linha dizendo quando usá-la.
// ============================================
const db = require("../database/db");
const { calculateJobMatch } = require("./matchCalculator");
const { generateRoadmap } = require("./roadmapGenerator");
const { getSkillsSummary, getReposSummary, getNivel } = require("./userContextService");

const MAX_JOBS_RESULT = 10;

// ── Declarações de função (formato do SDK @google/genai) ────
const TOOL_DECLARATIONS = [
  {
    type: "function",
    name: "buscarVagas",
    description: "Busca vagas de estágio/emprego ativas na plataforma, filtrando por tecnologia, nível e/ou modalidade. Use quando o usuário perguntar sobre vagas disponíveis, oportunidades, ou pedir recomendações de vagas.",
    parameters: {
      type: "object",
      properties: {
        tecnologia: { type: "string", description: "Nome de uma tecnologia/skill pra filtrar (ex: 'React', 'Node.js'). Opcional." },
        nivel: { type: "string", enum: ["estagio", "junior", "pleno"], description: "Nível da vaga. Opcional." },
        modalidade: { type: "string", enum: ["presencial", "remoto", "hibrido"], description: "Modalidade de trabalho. Opcional." },
      },
    },
  },
  {
    type: "function",
    name: "buscarPerfilUsuario",
    description: "Busca as skills conhecidas e o nível de experiência do usuário atual. Use quando precisar saber o que o usuário já sabe antes de recomendar algo.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "buscarPortfolio",
    description: "Busca os projetos/repositórios públicos do portfólio do usuário atual. Use quando o usuário perguntar sobre seus projetos ou pedir avaliação do portfólio.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "buscarRoadmap",
    description: "Busca o progresso do usuário na trilha de aprendizado (roadmap) de uma vaga específica — o que ele já sabe e o que falta aprender para essa vaga. Use quando o usuário perguntar 'o que devo estudar' em relação a uma vaga específica.",
    parameters: {
      type: "object",
      properties: {
        job_id: { type: "integer", description: "ID da vaga cujo roadmap deve ser consultado." },
      },
      required: ["job_id"],
    },
  },
  {
    type: "function",
    name: "analisarCompatibilidadeVaga",
    description: "Calcula o percentual de compatibilidade entre o usuário atual e uma vaga específica, com o detalhamento de quais skills batem e quais faltam. Use quando o usuário perguntar se combina com uma vaga específica.",
    parameters: {
      type: "object",
      properties: {
        job_id: { type: "integer", description: "ID da vaga a comparar com o perfil do usuário." },
      },
      required: ["job_id"],
    },
  },
];

// ── Implementações — cada uma recebe (args, ctx) onde ctx
// traz { userId, githubId, nivel } da sessão autenticada,
// NUNCA dos argumentos gerados pelo modelo. ──────────────

async function buscarVagas(args) {
  const conditions = ["j.active = 1"];
  const params = [];

  if (args?.nivel) {
    conditions.push("j.level = ?");
    params.push(args.nivel);
  }
  if (args?.modalidade) {
    conditions.push("j.modality = ?");
    params.push(args.modalidade);
  }

  let query = `
    SELECT DISTINCT j.id, j.title, j.company, j.level, j.modality, j.location
    FROM jobs j
  `;
  if (args?.tecnologia) {
    query += ` JOIN job_skills js ON js.job_id = j.id JOIN skills s ON s.id = js.skill_id AND s.name LIKE ?`;
    params.unshift(`%${args.tecnologia}%`);
  }
  query += ` WHERE ${conditions.join(" AND ")} ORDER BY j.id DESC LIMIT ${MAX_JOBS_RESULT}`;

  const [jobs] = await db.query(query, params);
  return { vagas: jobs };
}

async function buscarPerfilUsuario(_args, ctx) {
  const [skills, nivel] = await Promise.all([
    getSkillsSummary(ctx.githubId),
    getNivel(ctx.userId),
  ]);
  return { nivel, skills };
}

async function buscarPortfolio(_args, ctx) {
  const repos = await getReposSummary(ctx.userId);
  return { projetos: repos };
}

async function buscarRoadmap(args, ctx) {
  const jobId = Number(args?.job_id);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    return { erro: "job_id inválido." };
  }

  const [[job]] = await db.query("SELECT id FROM jobs WHERE id = ? AND active = 1", [jobId]);
  if (!job) {
    return { erro: "Vaga não encontrada ou não está mais ativa." };
  }

  const roadmap = await generateRoadmap(ctx.githubId, jobId, { unlocked: true });
  return {
    match_percent: roadmap.matchPercent,
    ja_sabe: roadmap.alreadyKnows.map(s => s.skill_name),
    precisa_aprender: roadmap.needsToLearn.map(s => ({ skill: s.skill_name, importancia: s.importance })),
  };
}

async function analisarCompatibilidadeVaga(args, ctx) {
  const jobId = Number(args?.job_id);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    return { erro: "job_id inválido." };
  }

  const [[job]] = await db.query("SELECT id FROM jobs WHERE id = ? AND active = 1", [jobId]);
  if (!job) {
    return { erro: "Vaga não encontrada ou não está mais ativa." };
  }

  const match = await calculateJobMatch(ctx.githubId, jobId, { nivel: ctx.nivel });
  return {
    match_percent: match.match,
    pronto_para_vaga: match.readyFor,
    skills_que_tem: match.breakdown.filter(s => s.has).map(s => s.skill_name),
    skills_que_faltam: match.breakdown.filter(s => !s.has).map(s => s.skill_name),
  };
}

const TOOL_IMPLEMENTATIONS = {
  buscarVagas,
  buscarPerfilUsuario,
  buscarPortfolio,
  buscarRoadmap,
  analisarCompatibilidadeVaga,
};

// Executa uma function call pedida pelo modelo — sempre contra as
// implementações validadas acima, nunca eval/dispatch dinâmico livre.
async function executeTool(name, args, ctx) {
  const impl = TOOL_IMPLEMENTATIONS[name];
  if (!impl) {
    return { erro: `Ferramenta desconhecida: ${name}` };
  }
  try {
    return await impl(args, ctx);
  } catch (err) {
    console.error(`[aiTools] Falha ao executar ${name}:`, err.message);
    return { erro: "Erro interno ao consultar os dados." };
  }
}

module.exports = { TOOL_DECLARATIONS, executeTool };
