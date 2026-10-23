// ============================================
// migrations/run-analise-perfil-migration.js
// Aplica 20261023_analise_perfil_up.sql (ou o _down com --down) usando o
// pool de conexão já existente do projeto (database/db.js), no mesmo
// padrão de run-roadmap-migration.js. Seguro para rodar mais de uma vez.
//
// Uso: npm run migrate:analise-perfil
//      npm run migrate:analise-perfil -- --down
// ============================================
require("dotenv").config();
const fs   = require("fs");
const path = require("path");
const db   = require("../database/db");

const DOWN     = process.argv.includes("--down");
const SQL_FILE = path.join(__dirname, DOWN ? "20261023_analise_perfil_down.sql" : "20261023_analise_perfil_up.sql");

async function run() {
  await db.ready;

  const sql = fs.readFileSync(SQL_FILE, "utf8");

  // O pool não tem multipleStatements habilitado — separa por ";" e roda
  // cada comando individualmente (linhas de comentário são descartadas).
  const statements = sql
    .split(";")
    .map(s => s.split("\n").filter(l => !l.trim().startsWith("--")).join("\n").trim())
    .filter(Boolean);

  for (const statement of statements) {
    await db.query(statement);
  }

  console.log(`✅ Migração da análise de perfil ${DOWN ? "revertida" : "aplicada"} (${statements.length} comando(s)).`);
  process.exit(0);
}

run().catch(err => {
  console.error("❌ Erro ao aplicar a migração da análise de perfil:", err.message);
  process.exit(1);
});
