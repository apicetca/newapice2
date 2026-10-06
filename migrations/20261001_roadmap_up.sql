-- Migração: tabelas do sistema de Roadmap (docs/roadmap-spec.md)
-- Só CREATE TABLE IF NOT EXISTS — nenhuma tabela existente é alterada.
-- Ordem de criação respeita as FKs (recursos antes de roadmap_etapas,
-- que referencia recursos.id).

CREATE TABLE IF NOT EXISTS roadmaps (
  id            INT                 NOT NULL AUTO_INCREMENT,
  usuario_id    INT                 NOT NULL,
  tipo_objetivo ENUM('vaga','area') NOT NULL,
  vaga_id       INT                 NULL DEFAULT NULL,
  area          VARCHAR(50)         NULL DEFAULT NULL,
  horas_semana  SMALLINT UNSIGNED   NOT NULL DEFAULT 10,
  status        ENUM('ativo','arquivado') NOT NULL DEFAULT 'ativo',
  versao        INT UNSIGNED        NOT NULL DEFAULT 1,
  gerado_em     TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  origem        ENUM('ia','modelo') NOT NULL,
  PRIMARY KEY (id),
  KEY idx_roadmaps_usuario_status (usuario_id, status),
  CONSTRAINT fk_roadmaps_usuario FOREIGN KEY (usuario_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_roadmaps_vaga    FOREIGN KEY (vaga_id)    REFERENCES jobs(id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS roadmap_fases (
  id                INT          NOT NULL AUTO_INCREMENT,
  roadmap_id        INT          NOT NULL,
  ordem             TINYINT UNSIGNED NOT NULL,
  nome              VARCHAR(150) NOT NULL,
  objetivo          VARCHAR(500) NOT NULL,
  projeto_enunciado TEXT         NULL,
  projeto_repo_url  VARCHAR(500) NULL DEFAULT NULL,
  projeto_status    ENUM('pendente','verificado','nao_verificado','em_revisao') NOT NULL DEFAULT 'pendente',
  verificado_em     TIMESTAMP    NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_roadmap_fases_roadmap (roadmap_id),
  CONSTRAINT fk_roadmap_fases_roadmap FOREIGN KEY (roadmap_id) REFERENCES roadmaps(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS recursos (
  id         INT          NOT NULL AUTO_INCREMENT,
  habilidade VARCHAR(100) NOT NULL,
  titulo     VARCHAR(200) NOT NULL,
  url        VARCHAR(500) NOT NULL,
  tipo       ENUM('doc','video','curso','exercicio') NOT NULL,
  idioma     VARCHAR(10)  NOT NULL DEFAULT 'pt',
  gratuito   TINYINT(1)   NOT NULL DEFAULT 1,
  nivel      ENUM('iniciante','intermediario','avancado') NOT NULL DEFAULT 'iniciante',
  ativo      TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY idx_recursos_habilidade_ativo (habilidade, ativo),
  UNIQUE KEY uq_recursos_habilidade_url (habilidade, url)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS recursos_pendentes (
  habilidade         VARCHAR(100) NOT NULL,
  vezes_solicitada   INT UNSIGNED NOT NULL DEFAULT 1,
  ultima_solicitacao TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (habilidade)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS roadmap_etapas (
  id              INT          NOT NULL AUTO_INCREMENT,
  fase_id         INT          NOT NULL,
  ordem           TINYINT UNSIGNED NOT NULL,
  titulo          VARCHAR(150) NOT NULL,
  descricao       VARCHAR(500) NOT NULL,
  habilidade      VARCHAR(100) NOT NULL,
  horas_estimadas SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  recurso_id      INT          NULL DEFAULT NULL,
  status          ENUM('pendente','em_andamento','concluida') NOT NULL DEFAULT 'pendente',
  concluida_em    TIMESTAMP    NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_roadmap_etapas_fase (fase_id),
  CONSTRAINT fk_roadmap_etapas_fase    FOREIGN KEY (fase_id)    REFERENCES roadmap_fases(id) ON DELETE CASCADE,
  CONSTRAINT fk_roadmap_etapas_recurso FOREIGN KEY (recurso_id) REFERENCES recursos(id)      ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
