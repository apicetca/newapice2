// ============================================
// migrations/run-roadmap-migration.js
// Aplica 20261001_roadmap_up.sql usando o pool de conexão já existente
// do projeto (database/db.js) — não abre uma conexão própria.
//
// Uso: npm run migrate:roadmap
// ============================================
require("dotenv").config();
const fs   = require("fs");
const path = require("path");
const db   = require("../database/db");

const SQL_FILE = path.join(__dirname, "20261001_roadmap_up.sql");

async function run() {
  await db.ready;

  const sql = fs.readFileSync(SQL_FILE, "utf8");

  // O pool não tem multipleStatements habilitado (mysql2 não executa
  // vários comandos numa só query por padrão) — separa por ";" e roda
  // cada CREATE TABLE individualmente.
  const statements = sql
    .split(";")
    .map(s => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await db.query(statement);
  }

  console.log(`✅ Migração do roadmap aplicada (${statements.length} comandos).`);
  process.exit(0);
}

run().catch(err => {
  console.error("❌ Erro ao aplicar a migração do roadmap:", err.message);
  process.exit(1);
});
