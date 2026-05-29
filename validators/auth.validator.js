// ============================================
// validators/auth.validator.js
//
// Regras de validação para autenticação:
//   - POST /api/auth/register  (dev e empresa)
//   - POST /api/auth/login
//
// Usa express-validator v7.
// ============================================

const { body } = require("express-validator");
const { handleValidation } = require("./handle-validation");

// ── Valores aceitos (espelham o schema.sql) ──────────────
const SETORES  = ["tecnologia","financeiro","educacao","saude","varejo","industria","consultoria","outro"];
const TAMANHOS = ["micro","pequena","media","grande"];
const NIVEIS   = ["iniciante","intermediario","avancado"];

// ──────────────────────────────────────────────────────────
// Algoritmo real de validação de CPF
// ──────────────────────────────────────────────────────────
function isValidCPF(raw) {
  const c = raw.replace(/\D/g, "");
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(c[i]) * (10 - i);
  let rem = (sum * 10) % 11;
  if (rem === 10 || rem === 11) rem = 0;
  if (rem !== parseInt(c[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(c[i]) * (11 - i);
  rem = (sum * 10) % 11;
  if (rem === 10 || rem === 11) rem = 0;
  return rem === parseInt(c[10]);
}

// ──────────────────────────────────────────────────────────
// Algoritmo real de validação de CNPJ
// ──────────────────────────────────────────────────────────
function calcDigitoCNPJ(nums, len) {
  let sum = 0, pos = len - 7;
  for (let i = len; i >= 1; i--) {
    sum += parseInt(nums.charAt(len - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  return sum % 11 < 2 ? 0 : 11 - (sum % 11);
}

function isValidCNPJ(raw) {
  const c = raw.replace(/\D/g, "");
  if (c.length !== 14)       return false;
  if (/^(\d)\1+$/.test(c))   return false; // rejeita 00000000000000, etc.
  return calcDigitoCNPJ(c, 12) === parseInt(c[12])
      && calcDigitoCNPJ(c, 13) === parseInt(c[13]);
}

// ──────────────────────────────────────────────────────────
// Campos reutilizáveis exportados
// ──────────────────────────────────────────────────────────

/** Campo email — trim, lowercase, valida formato e tamanho */
const emailField = body("email")
  .trim()
  .toLowerCase()
  .notEmpty()
    .withMessage("O e-mail é obrigatório.")
  .isEmail()
    .withMessage("Informe um e-mail válido.")
  .isLength({ max: 255 })
    .withMessage("E-mail muito longo (máx. 255 caracteres).");

/** Campo senha para criação — mínimo 8, sem espaços nas bordas */
const passwordCreateField = body("password")
  .notEmpty()
    .withMessage("A senha é obrigatória.")
  .isLength({ min: 8 })
    .withMessage("A senha deve ter no mínimo 8 caracteres.")
  .isLength({ max: 128 })
    .withMessage("A senha deve ter no máximo 128 caracteres.")
  .custom(val => {
    if (/^\s|\s$/.test(val)) {
      throw new Error("A senha não pode começar ou terminar com espaços.");
    }
    return true;
  });

/** Campo senha para login — só verifica presença */
const passwordLoginField = body("password")
  .notEmpty()
    .withMessage("A senha é obrigatória.")
  .isLength({ max: 128 })
    .withMessage("Senha inválida.");

// ──────────────────────────────────────────────────────────
// Regras base — comuns a dev e empresa
// ──────────────────────────────────────────────────────────
const registerBaseRules = [
  body("type")
    .trim()
    .notEmpty()
      .withMessage("O tipo de conta é obrigatório.")
    .isIn(["dev", "empresa"])
      .withMessage("Tipo de conta inválido. Use 'dev' ou 'empresa'."),

  emailField,
  passwordCreateField,

  // Confirmação de senha — opcional (front envia, back confirma)
  body("confirm")
    .optional({ nullable: true, checkFalsy: true })
    .custom((val, { req }) => {
      if (val && val !== req.body.password) {
        throw new Error("As senhas não coincidem.");
      }
      return true;
    }),
];

// ──────────────────────────────────────────────────────────
// Regras adicionais — type === "dev"
// ──────────────────────────────────────────────────────────
const registerDevRules = [
  body("nome")
    .if(body("type").equals("dev"))
    .trim()
    .notEmpty()
      .withMessage("O nome é obrigatório.")
    .isLength({ max: 100 })
      .withMessage("Nome deve ter no máximo 100 caracteres.")
    .matches(/^[\p{L}\s'.:-]+$/u)
      .withMessage("Nome contém caracteres inválidos."),

  body("sobrenome")
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 100 })
      .withMessage("Sobrenome deve ter no máximo 100 caracteres.")
    .matches(/^[\p{L}\s'.:-]*$/u)
      .withMessage("Sobrenome contém caracteres inválidos."),

  body("github_login")
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 39 })
      .withMessage("Usuário GitHub deve ter no máximo 39 caracteres.")
    .matches(/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/)
      .withMessage("Usuário GitHub inválido: use apenas letras, números e hífens (sem hífen no início/fim)."),

  body("cpf")
    .optional({ nullable: true, checkFalsy: true })
    .custom(val => {
      if (val && !isValidCPF(val)) throw new Error("CPF inválido. Verifique os dígitos informados.");
      return true;
    }),

  body("telefone")
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 15 })
      .withMessage("Telefone inválido."),

  body("rg")
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 12 })
      .withMessage("RG inválido."),

  body("nivel")
    .if(body("type").equals("dev"))
    .optional({ nullable: true, checkFalsy: true })
    .isIn(NIVEIS)
      .withMessage(`Nível inválido. Use: ${NIVEIS.join(", ")}.`),
];

// ──────────────────────────────────────────────────────────
// Regras adicionais — type === "empresa"
// ──────────────────────────────────────────────────────────
const registerEmpresaRules = [
  body("razao_social")
    .if(body("type").equals("empresa"))
    .trim()
    .notEmpty()
      .withMessage("A razão social é obrigatória.")
    .isLength({ max: 200 })
      .withMessage("Razão social deve ter no máximo 200 caracteres."),

  body("nome_fantasia")
    .if(body("type").equals("empresa"))
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 200 })
      .withMessage("Nome fantasia deve ter no máximo 200 caracteres."),

  body("cnpj")
    .if(body("type").equals("empresa"))
    .notEmpty()
      .withMessage("O CNPJ é obrigatório.")
    .custom(val => {
      if (!isValidCNPJ(val)) {
        throw new Error("CNPJ inválido. Verifique os dígitos informados.");
      }
      return true;
    }),

  body("setor")
    .if(body("type").equals("empresa"))
    .optional({ nullable: true, checkFalsy: true })
    .isIn(SETORES)
      .withMessage(`Setor inválido. Opções: ${SETORES.join(", ")}.`),

  body("tamanho")
    .if(body("type").equals("empresa"))
    .optional({ nullable: true, checkFalsy: true })
    .isIn(TAMANHOS)
      .withMessage(`Tamanho inválido. Opções: ${TAMANHOS.join(", ")}.`),

  body("site")
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isURL({ protocols: ["http", "https"], require_protocol: true })
      .withMessage("URL do site inválida. Deve começar com http:// ou https://."),
];

// ──────────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────────
const validateRegister = [
  ...registerBaseRules,
  ...registerDevRules,
  ...registerEmpresaRules,
  handleValidation,
];

const validateLogin = [
  emailField,
  passwordLoginField,
  handleValidation,
];

module.exports = {
  validateRegister,
  validateLogin,
  // Campos individuais — para composição em outros validators
  emailField,
  passwordCreateField,
};