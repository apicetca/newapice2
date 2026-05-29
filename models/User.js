// ============================================
// models/User.js
// Funções de acesso aos dados da tabela `users` e perfis relacionados.
// ============================================
const db = require("../database/db");

module.exports = {
  findByEmail: async (email) => {
    const e = String(email).toLowerCase().trim();
    const [rows] = await db.query("SELECT * FROM users WHERE email = ? LIMIT 1", [e]);
    return rows[0] || null;
  },

  create: async ({ email, passwordHash, type }) => {
    const e = String(email).toLowerCase().trim();
    const [result] = await db.query(
      "INSERT INTO users (email, password_hash, type) VALUES (?, ?, ?)",
      [e, passwordHash, type]
    );
    return result.insertId;
  },

  createDevProfile: async ({ userId, nome, sobrenome, githubLogin, nivel, cpf, telefone, rg }) => {
    await db.query(
      `INSERT INTO user_dev_profiles (user_id, nome, sobrenome, github_login, nivel, cpf, telefone, rg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, nome, sobrenome ?? null, githubLogin ?? null, nivel, cpf ?? null, telefone ?? null, rg ?? null]
    );
  },

  cnpjExists: async (cnpj) => {
    const [rows] = await db.query("SELECT COUNT(*) AS total FROM user_company_profiles WHERE cnpj = ?", [cnpj]);
    return rows[0] && rows[0].total > 0;
  },

  createCompanyProfile: async ({ userId, razaoSocial, nomeFantasia, cnpj, setor, tamanho, site }) => {
    await db.query(
      `INSERT INTO user_company_profiles (user_id, razao_social, nome_fantasia, cnpj, setor, tamanho, site)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, razaoSocial, nomeFantasia, cnpj, setor, tamanho, site]
    );
  },

  findDevProfile: async (userId) => {
    const [rows] = await db.query("SELECT * FROM user_dev_profiles WHERE user_id = ? LIMIT 1", [userId]);
    return rows[0] || null;
  },

  findCompanyProfile: async (userId) => {
    const [rows] = await db.query("SELECT * FROM user_company_profiles WHERE user_id = ? LIMIT 1", [userId]);
    return rows[0] || null;
  },
};
