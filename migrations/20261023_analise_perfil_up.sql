-- Migração: análise de perfil (docs/analise-perfil-plano.md, Etapas 6 e 7)
-- Só CREATE TABLE IF NOT EXISTS — nenhuma tabela existente é alterada.

-- Etapa 6: de onde veio cada ponto da confiança detectada no GitHub
-- (repositório, tipo de evidência e pontos). Substituída a cada análise.
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

-- Etapa 7: autodiagnóstico — o nível que o dev declarou em cada skill.
-- Fica separado de user_skills para a parte detectada no GitHub poder ser
-- recalculada a cada análise: a declaração só serve de piso.
CREATE TABLE IF NOT EXISTS user_skill_declaracoes (
  id         INT       NOT NULL AUTO_INCREMENT,
  github_id  BIGINT    NOT NULL,
  skill_id   INT       NOT NULL,
  nivel      ENUM('iniciante','intermediario','avancado') NOT NULL,
  confidence TINYINT UNSIGNED NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_declaracao_github_skill (github_id, skill_id),
  CONSTRAINT fk_declaracoes_skill FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
