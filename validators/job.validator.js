// ============================================
// validators/job.validator.js
//
// Regras de validação para vagas:
//   - POST  /api/empresa/jobs         (criar)
//   - PATCH /api/empresa/jobs/:id     (editar)
// ============================================

const { body, param } = require("express-validator");
const { handleValidation } = require("./handle-validation");

// ── Valores aceitos (espelham o schema.sql) ──────────────
const VALID_LEVELS        = ["estagio", "junior", "pleno"];
const VALID_MODALITY      = ["presencial", "remoto", "hibrido"];
const VALID_CONTRACT_TYPE = ["clt", "pj", "estagio", "freelancer"];
const VALID_ENGLISH_LEVEL = ["nenhum", "basico", "intermediario", "avancado", "fluente"];
const VALID_AREA          = ["front-end", "back-end", "full-stack", "dados"];
const VALID_LANGUAGE      = ["ingles", "espanhol", "frances", "alemao", "italiano", "mandarim"];
const VALID_LANG_LEVEL    = ["basico", "intermediario", "avancado", "fluente"];

// ── Limite de caracteres para HTML sanitizado ────────────
const MAX_DESC = 2000;

// ──────────────────────────────────────────────────────────
// Campos individuais reutilizáveis
// ──────────────────────────────────────────────────────────

const titleField = (required = true) => {
  const chain = body("title").trim();
  if (required) {
    return chain
      .notEmpty()
        .withMessage("O título da vaga é obrigatório.")
      .isLength({ min: 3 })
        .withMessage("O título deve ter no mínimo 3 caracteres.")
      .isLength({ max: 200 })
        .withMessage("O título deve ter no máximo 200 caracteres.");
  }
  return chain
    .optional()
    .notEmpty()
      .withMessage("O título não pode ser vazio.")
    .isLength({ min: 3 })
      .withMessage("O título deve ter no mínimo 3 caracteres.")
    .isLength({ max: 200 })
      .withMessage("O título deve ter no máximo 200 caracteres.");
};

const levelField = (required = true) => {
  const chain = body("level");
  if (required) {
    return chain
      .notEmpty()
        .withMessage("O nível da vaga é obrigatório.")
      .isIn(VALID_LEVELS)
        .withMessage(`Nível inválido. Use: ${VALID_LEVELS.join(", ")}.`);
  }
  return chain
    .optional()
    .isIn(VALID_LEVELS)
      .withMessage(`Nível inválido. Use: ${VALID_LEVELS.join(", ")}.`);
};

const descField = body("description")
  .optional({ nullable: true, checkFalsy: true })
  .trim()
  .isLength({ max: MAX_DESC })
    .withMessage(`A descrição deve ter no máximo ${MAX_DESC} caracteres.`);

const activeField = body("active")
  .optional()
  .isBoolean()
    .withMessage("O campo 'active' deve ser true ou false.")
  .toBoolean();

const modalityField = body("modality")
  .optional({ nullable: true, checkFalsy: true })
  .isIn(VALID_MODALITY)
    .withMessage(`Modalidade inválida. Use: ${VALID_MODALITY.join(", ")}.`);

const contractTypeField = body("contract_type")
  .optional({ nullable: true, checkFalsy: true })
  .isIn(VALID_CONTRACT_TYPE)
    .withMessage(`Tipo de contrato inválido. Use: ${VALID_CONTRACT_TYPE.join(", ")}.`);

const englishLevelField = body("english_level")
  .optional({ nullable: true, checkFalsy: true })
  .isIn(VALID_ENGLISH_LEVEL)
    .withMessage(`Nível de inglês inválido. Use: ${VALID_ENGLISH_LEVEL.join(", ")}.`);

const areaField = body("area")
  .optional({ nullable: true, checkFalsy: true })
  .isIn(VALID_AREA)
    .withMessage(`Área inválida. Use: ${VALID_AREA.join(", ")}.`);

const categoryField = body("category_id")
  .optional({ nullable: true, checkFalsy: true })
  .isInt({ min: 1 })
    .withMessage("Categoria inválida.");

const foreignLanguageField = body("foreign_language")
  .optional({ nullable: true, checkFalsy: true })
  .isIn(VALID_LANGUAGE)
    .withMessage(`Língua estrangeira inválida. Use: ${VALID_LANGUAGE.join(", ")}.`);

const foreignLevelField = body("foreign_level")
  .optional({ nullable: true, checkFalsy: true })
  .isIn(VALID_LANG_LEVEL)
    .withMessage(`Nível da língua inválido. Use: ${VALID_LANG_LEVEL.join(", ")}.`);

const salaryMinField = body("salary_min")
  .optional({ nullable: true, checkFalsy: true })
  .isInt({ min: 0 })
    .withMessage("O salário mínimo deve ser um número inteiro não negativo.")
  .toInt();

const salaryMaxField = body("salary_max")
  .optional({ nullable: true, checkFalsy: true })
  .isInt({ min: 0 })
    .withMessage("O salário máximo deve ser um número inteiro não negativo.")
  .toInt()
  .custom((value, { req }) => {
    const min = req.body.salary_min;
    if (min !== undefined && min !== null && min !== "" && Number(min) > value) {
      throw new Error("O salário máximo não pode ser menor que o salário mínimo.");
    }
    return true;
  });

const yearsExperienceField = body("years_experience")
  .optional({ nullable: true, checkFalsy: true })
  .isInt({ min: 0 })
    .withMessage("Anos de experiência deve ser um número inteiro não negativo.")
  .toInt();

const maxCandidatesField = body("max_candidates")
  .optional({ nullable: true, checkFalsy: true })
  .isInt({ min: 0 })
    .withMessage("O número máximo de candidatos deve ser um número inteiro não negativo.")
  .toInt();

// ──────────────────────────────────────────────────────────
// Validador do parâmetro :id das rotas de vaga
// ──────────────────────────────────────────────────────────
const jobIdParam = param("id")
  .notEmpty()
    .withMessage("O ID da vaga é obrigatório.")
  .isInt({ min: 1 })
    .withMessage("O ID da vaga deve ser um número inteiro positivo.")
  .toInt();

// ──────────────────────────────────────────────────────────
// Validators exportados
// ──────────────────────────────────────────────────────────

/**
 * POST /api/empresa/jobs
 * Todos os campos obrigatórios (exceto description e active).
 */
const validateCreateJob = [
  titleField(true),
  levelField(true),
  descField,
  modalityField,
  contractTypeField,
  englishLevelField,
  areaField,
  categoryField,
  foreignLanguageField,
  foreignLevelField,
  salaryMinField,
  salaryMaxField,
  yearsExperienceField,
  maxCandidatesField,
  handleValidation,
];

/**
 * PATCH /api/empresa/jobs/:id
 * Todos os campos são opcionais — apenas os enviados são validados.
 */
const validateUpdateJob = [
  jobIdParam,
  titleField(false),
  levelField(false),
  descField,
  activeField,
  modalityField,
  contractTypeField,
  englishLevelField,
  areaField,
  categoryField,
  foreignLanguageField,
  foreignLevelField,
  salaryMinField,
  salaryMaxField,
  yearsExperienceField,
  maxCandidatesField,
  handleValidation,
];

module.exports = { validateCreateJob, validateUpdateJob, jobIdParam };