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

  // Mais curto que o default (10s) — numa falha real de rede (ex: Wi-Fi
  // ainda "acordando" de economia de energia) é melhor detectar rápido
  // e partir pra próxima tentativa do que ficar parado esperando.
  connectTimeout: 5000,

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

// Índice comum (não único) — idempotente, igual a addUniqueKey.
async function addIndex(table, keyName, columns) {
  const [[{ n }]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, keyName]
  );
  if (n > 0) return;
  await pool.query(`ALTER TABLE \`${table}\` ADD KEY \`${keyName}\` (${columns.map(c => `\`${c}\``).join(", ")})`);
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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Em dev, é comum o primeiro SELECT falhar com ETIMEDOUT/ECONNRESET logo
// depois do computador voltar de ociosidade — a interface de rede ainda
// não "acordou" completamente (ex: adaptador Wi-Fi com economia de
// energia) quando o processo já subiu. Sem retry, isso derrubava a
// conexão pro resto da vida do processo até reiniciar manualmente.
const CONNECT_RETRIES = 5;
const CONNECT_RETRY_BASE_MS = 1000;

async function testarConexao() {
  let lastErr;
  for (let attempt = 1; attempt <= CONNECT_RETRIES; attempt++) {
    try {
      await pool.query("SELECT 1");
      console.log("✅ Banco de dados conectado com sucesso");
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < CONNECT_RETRIES) {
        const delay = CONNECT_RETRY_BASE_MS * attempt; // backoff linear: 1s, 2s, 3s, 4s
        console.warn(`⚠️  Falha ao conectar no banco (tentativa ${attempt}/${CONNECT_RETRIES}): ${err.message} — tentando de novo em ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  if (lastErr) {
    console.error("❌ Erro ao conectar no banco após", CONNECT_RETRIES, "tentativas:", lastErr.message);
    console.error("   Código:", lastErr.code);
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

    // Devs cujo perfil a empresa abriu — alimenta "Dev visualizados recentemente"
    // no dashboard da empresa. Uma linha por (empresa, dev); viewed_at guarda a última vez.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS company_dev_views (
        company_id  INT       NOT NULL,
        dev_user_id INT       NOT NULL,
        viewed_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (company_id, dev_user_id),
        KEY idx_company_dev_views_recent (company_id, viewed_at),
        CONSTRAINT fk_cdv_company FOREIGN KEY (company_id)  REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_cdv_dev     FOREIGN KEY (dev_user_id) REFERENCES users(id) ON DELETE CASCADE
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

    // Configurações da empresa: e-mail de exibição, endereço, modelo de trabalho
    // dominante e faixa de maturidade (VARCHAR validado na aplicação).
    await addColumn("user_company_profiles", "email_exibicao", "VARCHAR(255) DEFAULT NULL");
    await addColumn("user_company_profiles", "endereco", "VARCHAR(255) DEFAULT NULL");
    await addColumn("user_company_profiles", "modelo_trabalho", "VARCHAR(20) DEFAULT NULL");
    await addColumn("user_company_profiles", "maturidade", "VARCHAR(20) DEFAULT NULL");

    // Formulário de vaga: área (front-end/back-end/full-stack/dados) e língua
    // estrangeira exigida + nível. VARCHAR (validado na aplicação) para não
    // exigir ALTER de ENUM. english_level continua valendo para o inglês.
    await addColumn("jobs", "area", "VARCHAR(20) DEFAULT NULL");
    await addColumn("jobs", "foreign_language", "VARCHAR(30) DEFAULT NULL");
    await addColumn("jobs", "foreign_level", "VARCHAR(20) DEFAULT NULL");

    // Data de expiração da vaga (opcional) — editada pelo admin em Admin → Vagas.
    await addColumn("jobs", "expires_at", "DATE DEFAULT NULL");

    // Eventos de uso (middlewares/usageTracker.js) — base de Admin → Relatórios → Uso da
    // plataforma. Só o id do usuário e uma chave de sessão com hash; created_at em UTC.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usage_events (
        id          BIGINT      NOT NULL AUTO_INCREMENT,
        user_id     INT         NOT NULL,
        user_type   VARCHAR(10) NOT NULL,
        session_key CHAR(16)    NOT NULL,
        module      VARCHAR(20) NOT NULL,
        created_at  DATETIME    NOT NULL,
        PRIMARY KEY (id),
        KEY idx_usage_created (created_at),
        KEY idx_usage_user (user_id, created_at),
        KEY idx_usage_session (session_key),
        CONSTRAINT fk_usage_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    // Retenção dos eventos: o relatório aceita até 730 dias.
    await pool.query("DELETE FROM usage_events WHERE created_at < (UTC_TIMESTAMP() - INTERVAL 800 DAY)");

    // Histórico de atividades do painel (Admin → Configurações → Segurança e privacidade).
    // Uma linha por ação que alterou algo (middlewares/adminAudit.js); guarda o nome do admin
    // na hora, para o registro continuar legível mesmo se a conta dele for removida.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id         BIGINT       NOT NULL AUTO_INCREMENT,
        admin_id   INT          NULL DEFAULT NULL,
        admin_nome VARCHAR(100) NOT NULL,
        acao       VARCHAR(255) NOT NULL,
        created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_audit_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    // Título curto da ação ("Edição de empresa"); `acao` guarda o detalhe. Linhas antigas ficam NULL.
    await addColumn("admin_audit_log", "titulo", "VARCHAR(80) NULL DEFAULT NULL");

    // Categorias de vaga (Admin → Configurações → Categorias e vagas). Cadastro novo e
    // independente de jobs.area (que continua ligado ao roadmap); jobs.category_id é opcional.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS job_categories (
        id         INT          NOT NULL AUTO_INCREMENT,
        nome       VARCHAR(60)  NOT NULL,
        descricao  VARCHAR(255) NULL DEFAULT NULL,
        active     TINYINT(1)   NOT NULL DEFAULT 1,
        created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_job_categories_nome (nome)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await addColumn("jobs", "category_id", "INT DEFAULT NULL");
    // Categorias iniciais (idempotente: o nome é único).
    await pool.query(`
      INSERT IGNORE INTO job_categories (nome, descricao) VALUES
        ('Tecnologia', 'Área relacionada ao desenvolvimento, programação e tecnologia da informação.'),
        ('Marketing', 'Vagas de comunicação, marketing digital, conteúdo e growth.'),
        ('Design', 'Vagas de design de produto, interface, experiência do usuário e identidade visual.'),
        ('Dados', 'Vagas de análise, engenharia e ciência de dados.'),
        ('Outras', 'Vagas que não se encaixam nas demais categorias.')
    `);

    // Quando a vaga saiu do ar (preenchido ao pausar; limpo ao reativar) — base do
    // "tempo médio de fechamento" em Admin → Relatórios → Desempenho das vagas.
    await addColumn("jobs", "closed_at", "DATETIME DEFAULT NULL");

    // Última atividade do usuário logado (middlewares/lastSeen.js) — Admin → Usuários.
    await addColumn("users", "last_seen_at", "DATETIME DEFAULT NULL");

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

    // Conversas do mentor: uma linha por conversa (título = primeira
    // pergunta), com as mensagens em mentor_conversas ligadas por chat_id.
    // Ficam salvas entre logins e aparecem no histórico da tela do mentor.
    // Mensagens antigas, sem chat_id, viram a primeira conversa do usuário
    // na primeira vez que ele abre o histórico (services/mentorChat.js).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mentor_chats (
        id         INT          NOT NULL AUTO_INCREMENT,
        user_id    INT          NOT NULL,
        title      VARCHAR(120) NOT NULL,
        created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_mentor_chats_user (user_id, updated_at),
        CONSTRAINT fk_mentor_chats_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await addColumn("mentor_conversas", "chat_id", "INT DEFAULT NULL");
    await addIndex("mentor_conversas", "idx_mentor_conversas_chat", ["chat_id", "created_at"]);

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

    // ── Assinatura recorrente via Mercado Pago (preapproval) ──
    // user_subscriptions (acima) continua sendo o plano "manual" dado pelo
    // admin; estas tabelas guardam a assinatura paga de verdade. Todas as
    // datas DATETIME daqui são gravadas em UTC (ver services/mpSubscriptions.js):
    // o servidor pode rodar em fusos diferentes (Render em UTC, máquina local
    // em horário de Brasília) e o valor gravado não pode depender disso.
    //
    // mp_plans: o mp_plan_id depende da conta do Mercado Pago (credenciais de
    // teste e de produção geram planos diferentes), por isso fica no banco
    // por conta, preenchido na subida do servidor (services/mpPlanSync.js),
    // e não fixo no código.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mp_plans (
        id                 INT           NOT NULL AUTO_INCREMENT,
        plan_code          VARCHAR(30)   NOT NULL,
        mp_account_id      BIGINT        NOT NULL,
        mp_plan_id         VARCHAR(64)   NOT NULL,
        transaction_amount DECIMAL(10,2) NOT NULL,
        synced_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_mp_plans_code_account (plan_code, mp_account_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // ON DELETE RESTRICT (diferente do resto do schema): apagar o usuário não
    // cancela a cobrança no Mercado Pago — cancele a assinatura antes.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id                INT          NOT NULL AUTO_INCREMENT,
        user_id           INT          NOT NULL,
        plan_id           VARCHAR(30)  NOT NULL,
        mp_preapproval_id VARCHAR(64)  NOT NULL,
        mp_collector_id   BIGINT       NULL DEFAULT NULL,
        status            ENUM('pending','authorized','paused','cancelled') NOT NULL DEFAULT 'pending',
        next_payment_date DATETIME     NULL DEFAULT NULL,
        paid_until        DATETIME     NULL DEFAULT NULL,
        payment_issue     VARCHAR(80)  NULL DEFAULT NULL,
        cancelled_at      DATETIME     NULL DEFAULT NULL,
        created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_subscriptions_preapproval (mp_preapproval_id),
        KEY idx_subscriptions_user_status (user_id, status),
        CONSTRAINT fk_mp_subscriptions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscription_payments (
        id              INT           NOT NULL AUTO_INCREMENT,
        subscription_id INT           NOT NULL,
        mp_payment_id   VARCHAR(32)   NOT NULL,
        status          VARCHAR(30)   NOT NULL,
        status_detail   VARCHAR(80)   NULL DEFAULT NULL,
        amount          DECIMAL(10,2) NULL DEFAULT NULL,
        paid_at         DATETIME      NULL DEFAULT NULL,
        created_at      DATETIME      NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_subscription_payments_mp (mp_payment_id),
        KEY idx_subscription_payments_sub (subscription_id),
        CONSTRAINT fk_subscription_payments_sub FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // Plano anual: pagamento único (à vista ou parcelado) que libera o plano
    // por 12 meses a partir da aprovação — ver services/mpAnnual.js.
    // valid_until só é preenchido quando o pagamento é aprovado; estorno ou
    // chargeback mudam o status e o acesso acaba (subscriptionService).
    // ON DELETE RESTRICT, como em subscriptions: há dinheiro envolvido.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS annual_payments (
        id              INT           NOT NULL AUTO_INCREMENT,
        user_id         INT           NOT NULL,
        plan_id         VARCHAR(30)   NOT NULL,
        mp_payment_id   VARCHAR(32)   NOT NULL,
        status          VARCHAR(30)   NOT NULL,
        status_detail   VARCHAR(80)   NULL DEFAULT NULL,
        amount          DECIMAL(10,2) NULL DEFAULT NULL,
        installments    TINYINT UNSIGNED NULL DEFAULT NULL,
        paid_at         DATETIME      NULL DEFAULT NULL,
        valid_until     DATETIME      NULL DEFAULT NULL,
        created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_annual_payments_mp (mp_payment_id),
        KEY idx_annual_payments_user (user_id, status, valid_until),
        CONSTRAINT fk_annual_payments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
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