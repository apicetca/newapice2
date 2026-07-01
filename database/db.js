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
  maxIdle: 5,
  idleTimeout: 60000,

  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

async function testarConexao() {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Banco de dados conectado com sucesso");
  } catch (err) {
    console.error("❌ Erro ao conectar no banco:", err.message);
  }
}

testarConexao();

module.exports = pool;