-- ============================================================
-- Ápice — schema completo do banco de dados
--
-- Este arquivo substitui o dump antigo (corrompido: linha com
-- "-- MySQL dump..." sem o prefixo de comentário, nomes de banco
-- inconsistentes entre si e com o .env, e nenhum dado).
--
-- Idempotente: usa apenas CREATE TABLE IF NOT EXISTS, então é
-- seguro rodar mais de uma vez, inclusive contra um banco que já
-- tem dados (nunca faz DROP TABLE). Reflete o estado atual do
-- schema — tabelas base + todas as migrations em database/*.js.
--
-- Uso:
--   mysql -h <host> -u <user> -p <database> < config/script_bd.sql
--
-- Depois de rodar isso, popule o catálogo de skills com:
--   node database/seed-skills.js
-- (ou node database/seed.js, que também insere 3 vagas de exemplo)
-- ============================================================

SET NAMES utf8mb4;

-- ── users ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INT           NOT NULL AUTO_INCREMENT,
  email         VARCHAR(255)  NOT NULL,
  password_hash VARCHAR(255)  DEFAULT NULL,
  type          ENUM('dev','empresa') NOT NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── user_dev_profiles ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_dev_profiles (
  id           INT          NOT NULL AUTO_INCREMENT,
  user_id      INT          NOT NULL,
  nome         VARCHAR(100) NOT NULL,
  sobrenome    VARCHAR(100) DEFAULT NULL,
  github_login VARCHAR(100) DEFAULT NULL,
  nivel        ENUM('iniciante','intermediario','avancado') NOT NULL DEFAULT 'iniciante',
  github_id    BIGINT       DEFAULT NULL,
  avatar_url   VARCHAR(500) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dev_user_id (user_id),
  UNIQUE KEY uq_dev_github_id (github_id),
  CONSTRAINT fk_dev_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── user_company_profiles ───────────────────────────────────
CREATE TABLE IF NOT EXISTS user_company_profiles (
  id            INT          NOT NULL AUTO_INCREMENT,
  user_id       INT          NOT NULL,
  razao_social  VARCHAR(200) NOT NULL,
  nome_fantasia VARCHAR(200) DEFAULT NULL,
  cnpj          CHAR(14)     NOT NULL,
  setor         VARCHAR(50)  DEFAULT NULL,
  tamanho       ENUM('micro','pequena','media','grande') DEFAULT NULL,
  site          VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_company_user_id (user_id),
  UNIQUE KEY uq_company_cnpj (cnpj),
  CONSTRAINT fk_company_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── skills ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skills (
  id             INT          NOT NULL AUTO_INCREMENT,
  name           VARCHAR(100) NOT NULL,
  type           ENUM('hard','soft') NOT NULL,
  category       VARCHAR(50)  DEFAULT NULL,
  github_signals TEXT,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── jobs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id                INT          NOT NULL AUTO_INCREMENT,
  title             VARCHAR(200) NOT NULL,
  company           VARCHAR(100) DEFAULT NULL,
  description       TEXT,
  level             ENUM('estagio','junior','pleno') NOT NULL DEFAULT 'estagio',
  company_id        INT          DEFAULT NULL,
  active            TINYINT(1)   NOT NULL DEFAULT 1,
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modality          ENUM('presencial','remoto','hibrido') DEFAULT 'remoto',
  contract_type     ENUM('clt','pj','estagio','freelancer') DEFAULT 'estagio',
  salary_min        INT UNSIGNED DEFAULT NULL,
  salary_max        INT UNSIGNED DEFAULT NULL,
  location          VARCHAR(255) DEFAULT NULL,
  years_experience  TINYINT UNSIGNED DEFAULT 0,
  english_level     ENUM('nenhum','basico','intermediario','avancado','fluente') DEFAULT 'nenhum',
  responsibilities  TEXT,
  benefits          TEXT,
  max_candidates    SMALLINT UNSIGNED DEFAULT 100,
  tags              VARCHAR(500) DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_jobs_company (company_id),
  CONSTRAINT fk_jobs_company FOREIGN KEY (company_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── job_skills ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_skills (
  id          INT NOT NULL AUTO_INCREMENT,
  job_id      INT NOT NULL,
  skill_id    INT NOT NULL,
  importance  ENUM('obrigatoria','desejavel') NOT NULL DEFAULT 'obrigatoria',
  learn_order INT NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY idx_job_skills_job (job_id),
  KEY idx_job_skills_skill (skill_id),
  CONSTRAINT fk_job_skills_job   FOREIGN KEY (job_id)   REFERENCES jobs (id)   ON DELETE CASCADE,
  CONSTRAINT fk_job_skills_skill FOREIGN KEY (skill_id) REFERENCES skills (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── skill_resources ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skill_resources (
  id       INT          NOT NULL AUTO_INCREMENT,
  skill_id INT          NOT NULL,
  type     ENUM('curso','video','documentacao','projeto') NOT NULL,
  title    VARCHAR(200) NOT NULL,
  url      TEXT,
  is_free  TINYINT(1)   NOT NULL DEFAULT 1,
  duration VARCHAR(50)  DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_skill_resources_skill (skill_id),
  CONSTRAINT fk_skill_resources_skill FOREIGN KEY (skill_id) REFERENCES skills (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── user_skills ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_skills (
  id         INT    NOT NULL AUTO_INCREMENT,
  github_id  BIGINT NOT NULL,
  skill_id   INT    NOT NULL,
  source     ENUM('github','manual') NOT NULL DEFAULT 'github',
  confidence INT    NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_skill (github_id, skill_id),
  KEY idx_user_skills_skill (skill_id),
  CONSTRAINT fk_user_skills_skill FOREIGN KEY (skill_id) REFERENCES skills (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── user_roadmap_progress ───────────────────────────────────
CREATE TABLE IF NOT EXISTS user_roadmap_progress (
  id           INT       NOT NULL AUTO_INCREMENT,
  github_id    BIGINT    NOT NULL,
  job_id       INT       NOT NULL,
  skill_id     INT       NOT NULL,
  status       ENUM('nao_iniciado','em_progresso','concluido') NOT NULL DEFAULT 'nao_iniciado',
  completed_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_progress (github_id, job_id, skill_id),
  KEY idx_progress_job (job_id),
  KEY idx_progress_skill (skill_id),
  CONSTRAINT fk_progress_job   FOREIGN KEY (job_id)   REFERENCES jobs (id)   ON DELETE CASCADE,
  CONSTRAINT fk_progress_skill FOREIGN KEY (skill_id) REFERENCES skills (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── company_match_actions ───────────────────────────────────
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
  CONSTRAINT fk_cma_company FOREIGN KEY (company_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_cma_job     FOREIGN KEY (job_id)     REFERENCES jobs (id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── job_applications ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_applications (
  id            INT       NOT NULL AUTO_INCREMENT,
  job_id        INT       NOT NULL,
  dev_github_id BIGINT    NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resumo_ia     TEXT      DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_application (job_id, dev_github_id),
  KEY idx_job (job_id),
  CONSTRAINT fk_app_job FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── user_repositories ────────────────────────────────────────
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
  is_public      TINYINT(1)   NOT NULL DEFAULT 0,
  ai_description TEXT         DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_repo (user_id, repo_full_name),
  CONSTRAINT fk_user_repos_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── password_resets ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_resets (
  id          INT       NOT NULL AUTO_INCREMENT,
  user_id     INT       NOT NULL,
  token_hash  CHAR(64)  NOT NULL,
  expires_at  TIMESTAMP NOT NULL,
  used_at     TIMESTAMP NULL DEFAULT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_password_resets_token (token_hash),
  KEY idx_password_resets_user (user_id),
  CONSTRAINT fk_password_resets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── perfil_tecnico_ia — análise de repositórios via IA ────────
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
  CONSTRAINT fk_perfil_tecnico_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── match_ia_cache — explicação de compatibilidade via IA ─────
-- github_id segue o mesmo padrão de user_roadmap_progress/job_applications:
-- guarda o github_id quando existe, ou o user_id interno como fallback.
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
  CONSTRAINT fk_match_ia_job FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── mentor_chats — conversas do mentor de carreira (título = 1ª pergunta) ──
CREATE TABLE IF NOT EXISTS mentor_chats (
  id         INT          NOT NULL AUTO_INCREMENT,
  user_id    INT          NOT NULL,
  title      VARCHAR(120) NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mentor_chats_user (user_id, updated_at),
  CONSTRAINT fk_mentor_chats_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── mentor_conversas — mensagens do mentor de carreira (IA, plano PRO) ──
CREATE TABLE IF NOT EXISTS mentor_conversas (
  id                    INT       NOT NULL AUTO_INCREMENT,
  user_id               INT       NOT NULL,
  chat_id               INT       DEFAULT NULL,
  role                  ENUM('user','assistant') NOT NULL,
  content               TEXT      NOT NULL,
  gemini_interaction_id VARCHAR(255) DEFAULT NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mentor_conversas_user (user_id),
  KEY idx_mentor_conversas_chat (chat_id, created_at),
  CONSTRAINT fk_mentor_conversas_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── mercado_insights — resumo periódico de tecnologias em alta (IA) ──
CREATE TABLE IF NOT EXISTS mercado_insights (
  id              INT       NOT NULL AUTO_INCREMENT,
  resumo          TEXT      NOT NULL,
  tecnologias_top TEXT      NOT NULL,
  gerado_em       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
