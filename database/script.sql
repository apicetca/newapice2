-- ============================================
-- database/script.sql
-- Plataforma de Estágios — Ápice
-- Script de criação do banco de dados
-- ============================================

CREATE DATABASE IF NOT EXISTS biwhnvue4yl9o8dgebfh
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE biwhnvue4yl9o8dgebfh;

-- ============================================
-- TABELA: users
-- Usuários da plataforma (devs e empresas)
-- Usada em: models/User.js, routes/users.js
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255)           NOT NULL UNIQUE,
  password_hash VARCHAR(255)           DEFAULT NULL,  -- NULL para usuários OAuth (GitHub)
  type          ENUM('dev', 'empresa') NOT NULL,
  created_at    TIMESTAMP              DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABELA: user_dev_profiles
-- Perfil detalhado do desenvolvedor
-- Usada em: models/User.js, routes/profile.js
-- ============================================
CREATE TABLE IF NOT EXISTS user_dev_profiles (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT          NOT NULL UNIQUE,
  nome         VARCHAR(100) NOT NULL,
  sobrenome    VARCHAR(100) DEFAULT NULL,
  github_login VARCHAR(100) DEFAULT NULL,
  nivel        ENUM('iniciante', 'intermediario', 'avancado') DEFAULT 'iniciante',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================
-- TABELA: user_company_profiles
-- Perfil detalhado da empresa
-- Usada em: models/User.js, routes/empresa.js
-- ============================================
CREATE TABLE IF NOT EXISTS user_company_profiles (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT          NOT NULL UNIQUE,
  razao_social  VARCHAR(255) NOT NULL,
  nome_fantasia VARCHAR(255) DEFAULT NULL,
  cnpj          CHAR(14)     NOT NULL UNIQUE,
  setor         VARCHAR(100) DEFAULT NULL,
  tamanho       VARCHAR(50)  DEFAULT NULL,  -- ex: '1-10', '11-50', '51-200'
  site          VARCHAR(255) DEFAULT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================
-- TABELA: skills
-- Catálogo global de habilidades técnicas
-- Usada em: routes/profile.js, routes/roadmap.js
-- ============================================
CREATE TABLE IF NOT EXISTS skills (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  name     VARCHAR(100) NOT NULL UNIQUE,
  type     VARCHAR(50)  DEFAULT NULL,  -- ex: 'linguagem', 'framework', 'ferramenta'
  category VARCHAR(50)  DEFAULT NULL   -- ex: 'backend', 'frontend', 'devops'
);

-- ============================================
-- TABELA: user_skills
-- Skills do usuário (detectadas via GitHub ou adicionadas manualmente)
-- Usada em: routes/profile.js, services/githubAnalyzer.js
-- ============================================
CREATE TABLE IF NOT EXISTS user_skills (
  github_id  BIGINT NOT NULL,
  skill_id   INT    NOT NULL,
  source     ENUM('github', 'manual') DEFAULT 'github',
  confidence INT DEFAULT 50,           -- 0-100: nível de confiança da detecção
  PRIMARY KEY (github_id, skill_id),
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

-- ============================================
-- TABELA: jobs
-- Vagas de estágio/emprego cadastradas pelas empresas
-- Usada em: routes/empresa.js, routes/roadmap.js
-- ============================================
CREATE TABLE IF NOT EXISTS jobs (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(255)                        NOT NULL,
  company     VARCHAR(255)                        DEFAULT NULL,  -- nome legível da empresa
  company_id  INT                                 DEFAULT NULL,  -- FK para users
  description TEXT                                DEFAULT NULL,
  level       ENUM('estagio', 'junior', 'pleno')  DEFAULT 'estagio',
  active      TINYINT(1)                          DEFAULT 1,
  created_at  TIMESTAMP                           DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================
-- TABELA: job_skills
-- Skills exigidas por cada vaga
-- Usada em: routes/roadmap.js, routes/empresa.js
-- ============================================
CREATE TABLE IF NOT EXISTS job_skills (
  job_id      INT NOT NULL,
  skill_id    INT NOT NULL,
  importance  ENUM('obrigatoria', 'desejavel') DEFAULT 'obrigatoria',
  learn_order INT DEFAULT 0,  -- ordem sugerida de aprendizado no roadmap
  PRIMARY KEY (job_id, skill_id),
  FOREIGN KEY (job_id)   REFERENCES jobs(id)   ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

-- ============================================
-- TABELA: user_roadmap_progress
-- Progresso do usuário nas skills de cada vaga
-- Usada em: routes/roadmap.js
-- ============================================
CREATE TABLE IF NOT EXISTS user_roadmap_progress (
  github_id    BIGINT NOT NULL,
  job_id       INT    NOT NULL,
  skill_id     INT    NOT NULL,
  status       ENUM('nao_iniciado', 'em_progresso', 'concluido') DEFAULT 'nao_iniciado',
  completed_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (github_id, job_id, skill_id),
  FOREIGN KEY (job_id)   REFERENCES jobs(id)   ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

-- ============================================
-- DADOS INICIAIS: skills
-- Seed básico para popular o catálogo
-- ============================================
INSERT IGNORE INTO skills (name, type, category) VALUES
  -- Linguagens
  ('JavaScript',  'linguagem', 'frontend'),
  ('TypeScript',  'linguagem', 'frontend'),
  ('Python',      'linguagem', 'backend'),
  ('Java',        'linguagem', 'backend'),
  ('C#',          'linguagem', 'backend'),
  ('PHP',         'linguagem', 'backend'),
  ('Go',          'linguagem', 'backend'),
  ('Rust',        'linguagem', 'backend'),
  ('Kotlin',      'linguagem', 'mobile'),
  ('Swift',       'linguagem', 'mobile'),

  -- Frontend
  ('HTML',        'linguagem',  'frontend'),
  ('CSS',         'linguagem',  'frontend'),
  ('React',       'framework',  'frontend'),
  ('Vue.js',      'framework',  'frontend'),
  ('Angular',     'framework',  'frontend'),
  ('Next.js',     'framework',  'frontend'),
  ('Tailwind CSS','framework',  'frontend'),

  -- Backend
  ('Node.js',     'framework',  'backend'),
  ('Express',     'framework',  'backend'),
  ('Django',      'framework',  'backend'),
  ('FastAPI',     'framework',  'backend'),
  ('Spring Boot', 'framework',  'backend'),
  ('Laravel',     'framework',  'backend'),

  -- Banco de dados
  ('MySQL',       'ferramenta', 'banco-de-dados'),
  ('PostgreSQL',  'ferramenta', 'banco-de-dados'),
  ('MongoDB',     'ferramenta', 'banco-de-dados'),
  ('Redis',       'ferramenta', 'banco-de-dados'),

  -- DevOps / Ferramentas
  ('Git',         'ferramenta', 'devops'),
  ('Docker',      'ferramenta', 'devops'),
  ('Linux',       'ferramenta', 'devops'),
  ('AWS',         'ferramenta', 'devops'),
  ('GitHub Actions', 'ferramenta', 'devops');