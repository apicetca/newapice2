-- Reverte 20261001_roadmap_up.sql — remove só estas 5 tabelas,
-- na ordem reversa das FKs.

DROP TABLE IF EXISTS roadmap_etapas;
DROP TABLE IF EXISTS recursos_pendentes;
DROP TABLE IF EXISTS recursos;
DROP TABLE IF EXISTS roadmap_fases;
DROP TABLE IF EXISTS roadmaps;
