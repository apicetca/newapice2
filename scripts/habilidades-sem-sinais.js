// ============================================
// scripts/habilidades-sem-sinais.js
// Lista as habilidades usadas nas etapas dos roadmaps (roadmap_etapas) que a
// verificação automática de projetos NÃO consegue checar: as que não têm
// skill de mesmo nome no catálogo, ou têm a skill mas sem github_signals.
// É a lista para o admin cadastrar sinais em /admin/configuracoes
// (docs/analise-perfil.md, limitação 10).
//
// Só leitura — não grava nada no banco.
// Uso: node scripts/habilidades-sem-sinais.js
// ============================================

// Agrupa as linhas da consulta por habilidade. A comparação de nomes segue a
// mesma regra do verificarProjeto (`name IN (...)` no MySQL, sem diferenciar
// maiúsculas de minúsculas).
function classificar(rows) {
  return rows
    .map(r => {
      const sinais = String(r.github_signals ?? "").split(",").map(s => s.trim()).filter(Boolean);
      if (r.skill_id == null) return { habilidade: r.habilidade, etapas: Number(r.etapas), motivo: "sem skill com esse nome" };
      if (sinais.length === 0) return { habilidade: r.habilidade, etapas: Number(r.etapas), motivo: "skill sem github_signals" };
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => b.etapas - a.etapas || a.habilidade.localeCompare(b.habilidade));
}

const CONSULTA = `
  SELECT re.habilidade, COUNT(*) AS etapas,
         MAX(s.id) AS skill_id, MAX(s.github_signals) AS github_signals
  FROM roadmap_etapas re
  LEFT JOIN skills s ON s.name = re.habilidade
  WHERE re.habilidade IS NOT NULL AND re.habilidade <> ''
  GROUP BY re.habilidade`;

async function main() {
  require("dotenv").config();
  // Conexão própria em vez de database/db: aquele módulo roda as migrações
  // automáticas ao ser carregado, e este script não deve escrever nada.
  const mysql = require("mysql2/promise");
  let db;
  try {
    db = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 3306,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
    });
    const [rows] = await db.query(CONSULTA);
    const lista = classificar(rows);
    if (!lista.length) {
      console.log("Todas as habilidades das etapas têm skill com github_signals. Nada a cadastrar.");
    } else {
      console.log(`${lista.length} habilidade(s) sem verificação automática (mais usadas primeiro):\n`);
      console.table(lista.map(h => ({ habilidade: h.habilidade, etapas: h.etapas, motivo: h.motivo })));
    }
    await db.end();
    process.exit(0);
  } catch (err) {
    console.error("Erro ao consultar o banco:", err.message);
    if (db) await db.end().catch(() => {});
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { classificar, CONSULTA };
