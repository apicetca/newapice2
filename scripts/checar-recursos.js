// ============================================
// scripts/checar-recursos.js
// Lê todas as URLs da tabela `recursos` e faz uma requisição a cada uma
// (timeout de 10s, seguindo redirecionamentos), listando no terminal as
// que não responderem 200. Só leitura — não grava nada no banco (não
// marca `ativo=0` sozinho; isso fica a critério de quem revisar a lista).
//
// Uso: node scripts/checar-recursos.js
// ============================================
require("dotenv").config();
const axios = require("axios");
const db    = require("../database/db");

const TIMEOUT_MS   = 10000;
const CONCURRENCY  = 5; // evita disparar 60 requisições simultâneas pros mesmos domínios

async function checkUrl(url) {
  try {
    const res = await axios.get(url, {
      timeout: TIMEOUT_MS,
      maxRedirects: 10,
      validateStatus: () => true, // trata qualquer status manualmente, sem lançar erro
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ApiceLinkChecker/1.0)" },
    });
    return { status: res.status, erro: null };
  } catch (err) {
    const motivo = err.code === "ECONNABORTED"
      ? `timeout (${TIMEOUT_MS}ms)`
      : err.message;
    return { status: null, erro: motivo };
  }
}

// Processa a lista em lotes de tamanho CONCURRENCY, sem derrubar vários
// domínios de uma vez nem demorar demais rodando tudo em série.
async function checkAll(recursos) {
  const resultados = [];
  for (let i = 0; i < recursos.length; i += CONCURRENCY) {
    const lote = recursos.slice(i, i + CONCURRENCY);
    const lotePromises = lote.map(async (recurso) => {
      const { status, erro } = await checkUrl(recurso.url);
      return { ...recurso, status, erro };
    });
    resultados.push(...(await Promise.all(lotePromises)));
  }
  return resultados;
}

async function run() {
  await db.ready;

  const [recursos] = await db.query(
    "SELECT id, habilidade, titulo, url FROM recursos ORDER BY habilidade, id"
  );

  if (!recursos.length) {
    console.log("Nenhum recurso cadastrado em `recursos`.");
    process.exit(0);
  }

  console.log(`Checando ${recursos.length} URLs (timeout ${TIMEOUT_MS}ms, até ${CONCURRENCY} em paralelo)...\n`);

  const resultados = await checkAll(recursos);
  const comProblema = resultados.filter(r => r.status !== 200);

  console.log(`\nResultado: ${resultados.length - comProblema.length}/${resultados.length} responderam 200.\n`);

  if (!comProblema.length) {
    console.log("✅ Todas as URLs responderam 200.");
    process.exit(0);
  }

  console.log(`⚠️  ${comProblema.length} URL(s) não responderam 200:\n`);
  for (const r of comProblema) {
    const statusLabel = r.status != null ? `HTTP ${r.status}` : `erro (${r.erro})`;
    console.log(`  [id=${r.id}] ${r.habilidade} — ${r.titulo}`);
    console.log(`    ${r.url}`);
    console.log(`    → ${statusLabel}\n`);
  }

  process.exit(0);
}

run().catch(err => {
  console.error("❌ Erro ao checar os recursos:", err.message);
  process.exit(1);
});
