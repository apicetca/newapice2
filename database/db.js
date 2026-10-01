// ============================================
// database/db.js
// Pool de conexão com MySQL
// ============================================
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,

  waitForConnections: true,

  connectionLimit: 5,
  maxIdle: 2,       // deixa conexões livres para o session store
  idleTimeout: 60000,

  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

async function addColumn(table, column, definition) {
  const [[{ n }]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (n > 0) return;
  await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

async function addUniqueKey(table, keyName, column) {
  const [[{ n }]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, keyName]
  );
  if (n > 0) return;
  await pool.query(`ALTER TABLE \`${table}\` ADD UNIQUE KEY \`${keyName}\` (\`${column}\`)`);
}

// Adiciona um novo valor a uma coluna ENUM existente, sem tocar nos
// valores já cadastrados (ex: users.type ganhando 'admin' além de
// 'dev'/'empresa'). Idempotente — não faz nada se o valor já existir.
async function addEnumValue(table, column, value) {
  const [[row]] = await pool.query(
    `SELECT COLUMN_TYPE AS colType FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (!row) return;
  const match = row.colType.match(/^enum\((.+)\)$/i);
  if (!match) return;
  const values = match[1].split(",").map(v => v.trim().replace(/^'|'$/g, ""));
  if (values.includes(value)) return;
  values.push(value);
  const enumList = values.map(v => `'${v}'`).join(",");
  await pool.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ENUM(${enumList}) NOT NULL`);
}

async function testarConexao() {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Banco de dados conectado com sucesso");
  } catch (err) {
    console.error("❌ Erro ao conectar no banco:", err.message);
    console.error("   Código:", err.code);
    console.error("   Host:",   process.env.DB_HOST  || "(não definido)");
    console.error("   Porta:",  process.env.DB_PORT  || "3306");
    console.error("   Banco:",  process.env.DB_NAME  || "(não definido)");
    console.error("   Usuário:", process.env.DB_USER || "(não definido)");
    return;
  }

  // ── Migrações automáticas (seguras para re-executar) ──────
  try {
    await addColumn("user_dev_profiles", "github_id", "BIGINT DEFAULT NULL");
    await addUniqueKey("user_dev_profiles", "uq_dev_github_id", "github_id");
    await addColumn("user_dev_profiles", "avatar_url", "VARCHAR(500) DEFAULT NULL");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS company_match_actions (
        id            INT       NOT NULL AUTO_INCREMENT,
        company_id    INT       NOT NULL,
        dev_github_id BIGINT    NOT NULL,
        job_id        INT       NOT NULL,
        action        ENUM('aceito','recusado') NOT NULL,
        created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_action (company_id, dev_github_id, job_id),
        KEY idx_company (company_id),
        CONSTRAINT fk_cma_company FOREIGN KEY (company_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_cma_job     FOREIGN KEY (job_id)     REFERENCES jobs(id)  ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS job_applications (
        id            INT       NOT NULL AUTO_INCREMENT,
        job_id        INT       NOT NULL,
        dev_github_id BIGINT    NOT NULL,
        created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_application (job_id, dev_github_id),
        KEY idx_job (job_id),
        CONSTRAINT fk_app_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_repositories (
        id             INT          NOT NULL AUTO_INCREMENT,
        user_id        INT          NOT NULL,
        repo_name      VARCHAR(255) NOT NULL,
        repo_full_name VARCHAR(255) NOT NULL,
        description    TEXT,
        is_private     TINYINT(1)   NOT NULL DEFAULT 0,
        language       VARCHAR(100),
        stars          INT                   DEFAULT 0,
        updated_at_gh  DATETIME,
        added_at       DATETIME              DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE  KEY uq_user_repo (user_id, repo_full_name),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await addColumn("user_repositories", "is_public", "TINYINT(1) NOT NULL DEFAULT 0");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id          INT          NOT NULL AUTO_INCREMENT,
        user_id     INT          NOT NULL,
        token_hash  CHAR(64)     NOT NULL,
        expires_at  TIMESTAMP    NOT NULL,
        used_at     TIMESTAMP    NULL DEFAULT NULL,
        created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_password_resets_token (token_hash),
        KEY idx_password_resets_user (user_id),
        CONSTRAINT fk_password_resets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // ── Área Administrador ──────────────────────────────────
    await addEnumValue("users", "type", "admin");
    await addColumn("users", "active", "TINYINT(1) NOT NULL DEFAULT 1");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_admin_profiles (
        id      INT          NOT NULL AUTO_INCREMENT,
        user_id INT          NOT NULL,
        nome    VARCHAR(100) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_admin_user_id (user_id),
        CONSTRAINT fk_admin_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // ── Planos de Assinatura ─────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_subscriptions (
        id                     INT          NOT NULL AUTO_INCREMENT,
        user_id                INT          NOT NULL,
        plan_code              VARCHAR(30)  NOT NULL,
        status                 ENUM('active','canceled') NOT NULL DEFAULT 'active',
        current_period_end     DATETIME     NULL DEFAULT NULL,
        payment_provider       VARCHAR(50)  NULL DEFAULT NULL,
        payment_customer_id    VARCHAR(255) NULL DEFAULT NULL,
        payment_subscription_id VARCHAR(255) NULL DEFAULT NULL,
        created_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_subscription_user (user_id),
        CONSTRAINT fk_subscriptions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // ── Mensagens (base — UI ainda pendente) ─────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id            INT       NOT NULL AUTO_INCREMENT,
        dev_github_id BIGINT    NOT NULL,
        company_id    INT       NOT NULL,
        job_id        INT       NULL DEFAULT NULL,
        created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_conversation (dev_github_id, company_id, job_id),
        KEY idx_conversations_company (company_id),
        CONSTRAINT fk_conversations_company FOREIGN KEY (company_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_conversations_job     FOREIGN KEY (job_id)     REFERENCES jobs(id)  ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id              INT       NOT NULL AUTO_INCREMENT,
        conversation_id INT       NOT NULL,
        sender_user_id  INT       NOT NULL,
        body            TEXT      NOT NULL,
        created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        read_at         TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_messages_conversation (conversation_id),
        CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        CONSTRAINT fk_messages_sender       FOREIGN KEY (sender_user_id)  REFERENCES users(id)          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // ── Perfil da empresa: campos exibidos no painel de mensagens ──
    await addColumn("user_company_profiles", "descricao", "TEXT DEFAULT NULL");
    await addColumn("user_company_profiles", "cidade", "VARCHAR(100) DEFAULT NULL");
    await addColumn("user_company_profiles", "estado", "CHAR(2) DEFAULT NULL");

    // ── Perfil técnico gerado por IA (análise de repositórios) ──
    await pool.query(`
      CREATE TABLE IF NOT EXISTS perfil_tecnico_ia (
        id                    INT       NOT NULL AUTO_INCREMENT,
        user_id               INT       NOT NULL,
        proficiencia_estimada VARCHAR(50) DEFAULT NULL,
        boas_praticas         TEXT,
        pontos_melhoria       TEXT,
        created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_perfil_tecnico_user (user_id),
        CONSTRAINT fk_perfil_tecnico_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // ── Cache de explicação de compatibilidade via IA ────────
    // github_id segue o mesmo padrão de user_roadmap_progress/job_applications:
    // guarda o github_id quando existe, ou o user_id interno como fallback.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS match_ia_cache (
        id           INT       NOT NULL AUTO_INCREMENT,
        github_id    BIGINT    NOT NULL,
        job_id       INT       NOT NULL,
        percentual   TINYINT UNSIGNED NOT NULL,
        explicacao   TEXT      NOT NULL,
        created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_match_ia (github_id, job_id),
        KEY idx_match_ia_job (job_id),
        CONSTRAINT fk_match_ia_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // ── Descrição de portfólio gerada por IA ─────────────────
    await addColumn("user_repositories", "ai_description", "TEXT DEFAULT NULL");

    // ── Mentor de carreira (chat) — exclusivo plano PRO ──────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mentor_conversas (
        id         INT       NOT NULL AUTO_INCREMENT,
        user_id    INT       NOT NULL,
        role       ENUM('user','assistant') NOT NULL,
        content    TEXT      NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_mentor_conversas_user (user_id),
        CONSTRAINT fk_mentor_conversas_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // ID da interação do Gemini que gerou essa resposta (só em linhas
    // role='assistant') — permite encadear a próxima mensagem do
    // usuário via previous_interaction_id em vez de reconstruir o
    // histórico inteiro como texto a cada chamada.
    await addColumn("mentor_conversas", "gemini_interaction_id", "VARCHAR(255) DEFAULT NULL");

    // ── Simulador de entrevista técnica — exclusivo plano PRO ─
    await pool.query(`
      CREATE TABLE IF NOT EXISTS entrevista_simulacoes (
        id               INT       NOT NULL AUTO_INCREMENT,
        user_id          INT       NOT NULL,
        job_id           INT       NULL DEFAULT NULL,
        pergunta         TEXT      NOT NULL,
        resposta_usuario TEXT      NULL DEFAULT NULL,
        feedback         TEXT      NULL DEFAULT NULL,
        created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_entrevista_user (user_id),
        CONSTRAINT fk_entrevista_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_entrevista_job  FOREIGN KEY (job_id)  REFERENCES jobs(id)  ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // ── Resumo de candidato gerado por IA — exclusivo empresa Premium ──
    await addColumn("job_applications", "resumo_ia", "TEXT DEFAULT NULL");

    // ── Insights de mercado — resumo periódico de tecnologias em alta ──
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mercado_insights (
        id              INT       NOT NULL AUTO_INCREMENT,
        resumo          TEXT      NOT NULL,
        tecnologias_top TEXT      NOT NULL,
        gerado_em       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  } catch (err) {
    console.error("[migration]", err.message);
  }
}

// Exposto para scripts que precisam garantir que as migrações
// automáticas já terminaram antes de continuar (ex: seed-admin.js).
pool.ready = testarConexao();

module.exports = pool;