// ============================================
// seeds/run-roadmap-seed.js
// Aplica seeds/recursos.sql usando o pool de conexão já existente do
// projeto (database/db.js) — não abre uma conexão própria. Depende das
// tabelas criadas por migrations/20261001_roadmap_up.sql (rodar
// `npm run migrate:roadmap` antes, se ainda não tiver rodado).
//
// Uso: npm run seed:roadmap
// ============================================
require("dotenv").config();
const fs   = require("fs");
const path = require("path");
const db   = require("../database/db");

const SQL_FILE = path.join(__dirname, "recursos.sql");

async function run() {
  await db.ready;

  const sql = fs.readFileSync(SQL_FILE, "utf8");

  // O pool não tem multipleStatements habilitado — separa por ";" e roda
  // cada INSERT individualmente (mesmo padrão de migrations/run-roadmap-migration.js).
  const statements = sql
    .split(";")
    .map(s => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await db.query(statement);
  }

  console.log(`✅ Seed de recursos do roadmap aplicado (${statements.length} comandos).`);
  process.exit(0);
}

run().catch(err => {
  console.error("❌ Erro ao aplicar o seed do roadmap:", err.message);
  process.exit(1);
});
