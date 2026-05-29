// ============================================
// database/migration.js
// Adiciona company_id, active e created_at
// à tabela jobs para associar vagas às empresas.
//
// Como usar: node database/migration.js
// Seguro de rodar mais de uma vez.
//
// FIX: MySQL não suporta ADD COLUMN IF NOT EXISTS
// (é sintaxe do PostgreSQL). A solução correta é
// consultar o information_schema antes de cada ALTER.
// ============================================
require("dotenv").config();
const db = require("./db");

// Verifica se uma coluna existe em uma tabela
async function columnExists(table, column) {
  const [rows] = await db.query(`
    SELECT COUNT(*) AS total
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = ?
      AND COLUMN_NAME  = ?
  `, [table, column]);
  return rows[0].total > 0;
}

// Verifica se uma constraint (FK) existe
async function constraintExists(constraintName) {
  const [rows] = await db.query(`
    SELECT COUNT(*) AS total
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA     = DATABASE()
      AND CONSTRAINT_NAME  = ?
  `, [constraintName]);
  return rows[0].total > 0;
}

async function migrate() {
  try {
    console.log("🔄 Iniciando migration...\n");

    // ── company_id ──────────────────────────────────
    if (await columnExists("jobs", "company_id")) {
      console.log("⏭  company_id já existe — pulando");
    } else {
      await db.query(`ALTER TABLE jobs ADD COLUMN company_id INT NULL`);
      console.log("✅ Coluna company_id adicionada");
    }

    // ── active ───────────────────────────────────────
    if (await columnExists("jobs", "active")) {
      console.log("⏭  active já existe — pulando");
    } else {
      await db.query(`ALTER TABLE jobs ADD COLUMN active BOOLEAN DEFAULT true`);
      console.log("✅ Coluna active adicionada");
    }

    // ── created_at ───────────────────────────────────
    if (await columnExists("jobs", "created_at")) {
      console.log("⏭  created_at já existe — pulando");
    } else {
      await db.query(`ALTER TABLE jobs ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
      console.log("✅ Coluna created_at adicionada");
    }

    // ── Foreign key ──────────────────────────────────
    if (await constraintExists("fk_jobs_company")) {
      console.log("⏭  FK fk_jobs_company já existe — pulando");
    } else {
      await db.query(`
        ALTER TABLE jobs
        ADD CONSTRAINT fk_jobs_company
        FOREIGN KEY (company_id) REFERENCES users(id) ON DELETE SET NULL
      `);
      console.log("✅ FK fk_jobs_company criada");
    }

    // ── user_dev_profiles: cpf ───────────────────────
    if (await columnExists("user_dev_profiles", "cpf")) {
      console.log("⏭  cpf já existe — pulando");
    } else {
      await db.query(`ALTER TABLE user_dev_profiles ADD COLUMN cpf VARCHAR(14) NULL`);
      console.log("✅ Coluna cpf adicionada");
    }

    // ── user_dev_profiles: telefone ──────────────────
    if (await columnExists("user_dev_profiles", "telefone")) {
      console.log("⏭  telefone já existe — pulando");
    } else {
      await db.query(`ALTER TABLE user_dev_profiles ADD COLUMN telefone VARCHAR(15) NULL`);
      console.log("✅ Coluna telefone adicionada");
    }

    // ── user_dev_profiles: rg ────────────────────────
    if (await columnExists("user_dev_profiles", "rg")) {
      console.log("⏭  rg já existe — pulando");
    } else {
      await db.query(`ALTER TABLE user_dev_profiles ADD COLUMN rg VARCHAR(12) NULL`);
      console.log("✅ Coluna rg adicionada");
    }

    // ── user_saved_jobs ──────────────────────────
    const [savedTable] = await db.query(`
      SELECT COUNT(*) AS total
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME   = 'user_saved_jobs'
    `);
    if (savedTable[0].total > 0) {
      console.log("⏭  user_saved_jobs já existe — pulando");
    } else {
      await db.query(`
        CREATE TABLE user_saved_jobs (
          user_id  INT NOT NULL,
          job_id   INT NOT NULL,
          saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, job_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (job_id)  REFERENCES jobs(id)  ON DELETE CASCADE
        )
      `);
      console.log("✅ Tabela user_saved_jobs criada");
    }

    console.log("\n🎉 Migration concluída com sucesso!");
    process.exit(0);

  } catch (err) {
    console.error("❌ Erro na migration:", err.message);
    process.exit(1);
  }
}

migrate();