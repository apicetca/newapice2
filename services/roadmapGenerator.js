// ============================================
// services/roadmapGenerator.js
// Gera o roadmap personalizado cruzando as
// skills da vaga com o perfil do usuário
// ============================================
const db                = require("../database/db");
const { calculateJobMatch } = require("./matchCalculator");
const { askGeminiJSON }      = require("./geminiClient");

const ROADMAP_IA_SYSTEM_PROMPT = `Você é um mentor técnico que explica, de forma breve e
motivadora, por que cada tecnologia é importante pro candidato aprender pra uma vaga
específica. Responda SEMPRE em JSON puro (sem markdown) no formato exato:
{ "trilha": [ { "tecnologia": "string", "motivo": "string curta (1-2 frases)", "tipo_recurso": "curso" | "video" | "documentacao" | "projeto" } ] }
Mantenha a mesma ordem e quantidade de tecnologias recebidas na entrada.`;

// Enriquece a trilha (plano PRO) com motivo/tipo de recurso gerados por IA a
// partir do gap de skills. Falha graciosamente: se a IA não responder, a
// trilha continua funcionando só com os recursos estáticos do banco.
async function enrichWithAI(needsToLearn) {
  if (!needsToLearn.length) return needsToLearn;

  // LGPD: só nomes de tecnologia/skill vão pro prompt — nenhum dado do usuário.
  const payload = needsToLearn.map(s => ({ tecnologia: s.skill_name, tipo: s.skill_type }));

  try {
    const result = await askGeminiJSON({
      system: ROADMAP_IA_SYSTEM_PROMPT,
      prompt: `Gap de skills do candidato pra essa vaga:\n${JSON.stringify(payload)}`,
      maxTokens: 3072,
    });

    const trilha = Array.isArray(result.trilha) ? result.trilha : [];
    return needsToLearn.map((skill, i) => ({
      ...skill,
      ia_motivo: trilha[i]?.motivo ?? null,
      ia_tipo_recurso: trilha[i]?.tipo_recurso ?? null,
    }));
  } catch (err) {
    console.error("[roadmapGenerator enrichWithAI]", err.message);
    return needsToLearn.map(skill => ({ ...skill, ia_motivo: null, ia_tipo_recurso: null }));
  }
}

// unlocked=false (plano free): mostra quais skills faltam, mas sem os
// recursos de aprendizado recomendados — isso é "roadmap personalizado",
// funcionalidade do plano PRO. skill.locked sinaliza pro front mostrar
// o convite pra upgrade em vez de simplesmente omitir a skill.
async function generateRoadmap(githubId, jobId, { unlocked = true } = {}) {
  // Calcula o match e obtém o breakdown skill por skill
  const match = await calculateJobMatch(githubId, jobId);

  // Para as skills que o usuário ainda não tem,
  // busca os recursos de aprendizado cadastrados
  const needsToLearn = [];
  const alreadyKnows = [];

  for (const skill of match.breakdown) {
    if (skill.has) {
      // Usuário já possui essa skill
      alreadyKnows.push(skill);
    } else if (unlocked) {
      // Busca recursos de aprendizado para essa skill
      const [resources] = await db.query(`
        SELECT id, type, title, url, is_free, duration
        FROM skill_resources
        WHERE skill_id = ?
        ORDER BY type
      `, [skill.skill_id]);

      needsToLearn.push({ ...skill, resources, locked: false });
    } else {
      needsToLearn.push({ ...skill, resources: [], locked: true });
    }
  }

  // Mantém a ordem lógica de aprendizado definida no banco
  needsToLearn.sort((a, b) => a.learn_order - b.learn_order);

  // Enriquece com motivo/tipo de recurso gerados por IA — só no plano PRO
  // (unlocked=true), já que é a mesma feature "roadmap_personalizado".
  const needsToLearnEnriched = unlocked
    ? await enrichWithAI(needsToLearn)
    : needsToLearn;

  // Busca o progresso já salvo do usuário nesse roadmap
  const [progressRows] = await db.query(`
    SELECT skill_id, status
    FROM user_roadmap_progress
    WHERE github_id = ? AND job_id = ?
  `, [githubId, jobId]);

  const progressMap = {};
  for (const row of progressRows) {
    progressMap[row.skill_id] = row.status;
  }

  // Adiciona o status de progresso em cada skill que falta
  const needsToLearnWithProgress = needsToLearnEnriched.map(skill => ({
    ...skill,
    status: progressMap[skill.skill_id] ?? "nao_iniciado",
  }));

  return {
    jobId,
    matchPercent:  match.match,
    readyFor:      match.readyFor,
    totalSkills:   match.breakdown.length,
    knownCount:    alreadyKnows.length,
    locked:        !unlocked,
    alreadyKnows,                      // ✅ já sabe
    needsToLearn:  needsToLearnWithProgress, // 📚 precisa aprender
  };
}

module.exports = { generateRoadmap };