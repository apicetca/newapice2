// ============================================
// services/marketInsights.js
// Analisa as vagas cadastradas e gera um resumo
// das tecnologias mais demandadas. Sem cron/worker
// separado no projeto — a "periodicidade" é lazy:
// GET /api/ai/insights-mercado regenera sob demanda
// quando o cache passa de MAX_CACHE_AGE_MS, em vez
// de exigir um processo agendado à parte.
// ============================================
const db = require("../database/db");
const { askGeminiJSON } = require("./geminiClient");

const SYSTEM_PROMPT = `Você analisa dados agregados do mercado de vagas de tecnologia e
escreve um resumo curto (3-5 frases, em português) sobre quais tecnologias estão mais em
alta e por quê. Responda SEMPRE em JSON puro (sem markdown) no formato exato:
{ "resumo": "string" }`;

const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000; // 24h

async function getLatestInsights() {
  const [[row]] = await db.query(
    "SELECT id, resumo, tecnologias_top, gerado_em FROM mercado_insights ORDER BY gerado_em DESC LIMIT 1"
  );
  if (!row) return null;
  return { ...row, tecnologias_top: JSON.parse(row.tecnologias_top) };
}

function isStale(insights) {
  return Date.now() - new Date(insights.gerado_em).getTime() > MAX_CACHE_AGE_MS;
}

// Serve o cache mais recente, regenerando primeiro se estiver velho
// (>24h) ou inexistente. Se a regeneração falhar (ex: erro da IA), cai
// de volta pro cache velho em vez de quebrar a página — só propaga o
// erro se não houver nenhum cache pra servir.
async function getInsightsFreshOrCached() {
  const cached = await getLatestInsights();

  if (!cached) return generateInsights();
  if (!isStale(cached)) return cached;

  try {
    return await generateInsights();
  } catch (err) {
    console.error("[marketInsights] Falha ao regenerar, servindo cache velho:", err.message);
    return cached;
  }
}

// Lock em memória (QA-005): sem isso, N requisições concorrentes com a
// tabela ainda vazia disparavam N chamadas independentes e pagas à IA.
// Requisições concorrentes aguardam a mesma chamada em andamento.
let generationInFlight = null;

// Agrega quantas vagas ativas pedem cada skill e gera o resumo via IA.
// Dado 100% agregado/anônimo — sem nenhuma informação de candidatos.
async function generateInsights() {
  if (generationInFlight) return generationInFlight;

  generationInFlight = doGenerateInsights().finally(() => {
    generationInFlight = null;
  });
  return generationInFlight;
}

async function doGenerateInsights() {
  const [rows] = await db.query(`
    SELECT s.name, s.type, COUNT(*) AS total_vagas
    FROM job_skills js
    JOIN jobs j    ON j.id = js.job_id AND j.active = 1
    JOIN skills s  ON s.id = js.skill_id
    GROUP BY s.id, s.name, s.type
    ORDER BY total_vagas DESC
    LIMIT 15
  `);

  if (!rows.length) {
    throw new Error("Nenhuma vaga com skills cadastradas ainda.");
  }

  const tecnologiasTop = rows.map(r => ({ nome: r.name, tipo: r.type, vagas: r.total_vagas }));

  const result = await askGeminiJSON({
    system: SYSTEM_PROMPT,
    prompt: `Tecnologias mais demandadas nas vagas ativas (ordenado por frequência):\n${JSON.stringify(tecnologiasTop)}`,
    maxTokens: 1536,
  });

  const resumo = result.resumo ?? "";

  await db.query(
    "INSERT INTO mercado_insights (resumo, tecnologias_top) VALUES (?, ?)",
    [resumo, JSON.stringify(tecnologiasTop)]
  );

  return { resumo, tecnologias_top: tecnologiasTop };
}

module.exports = { getLatestInsights, generateInsights, getInsightsFreshOrCached };
