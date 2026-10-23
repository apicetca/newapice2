-- Migração: evidências da análise de perfil (docs/analise-perfil-plano.md, Etapa 6)
-- Só CREATE TABLE IF NOT EXISTS — nenhuma tabela existente é alterada.
-- Cada linha diz de onde veio parte da confiança de uma skill: repositório,
-- tipo de evidência e pontos. É substituída a cada análise do GitHub.

CREATE TABLE IF NOT EXISTS user_skill_evidencias (
  id             INT          NOT NULL AUTO_INCREMENT,
  github_id      BIGINT       NOT NULL,
  skill_id       INT          NOT NULL,
  repo_full_name VARCHAR(255) NOT NULL,
  tipo           ENUM('linguagem','dependencia','readme') NOT NULL,
  pontos         TINYINT UNSIGNED NOT NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_evidencias_github_skill (github_id, skill_id),
  CONSTRAINT fk_evidencias_skill FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
