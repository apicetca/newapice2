const mysql = require("mysql2/promise");
const pool = mysql.createPool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT     || 3306,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  waitForConnections: true,
  connectionLimit:    10,
  ssl: { rejectUnauthorized: false }, // obrigatório no Clever Cloud
});
pool.getConnection()
  .then(conn => {
    console.log("Banco de dados conectado com sucesso");
    conn.release();
  })
  .catch(err => {
    console.error("Erro ao conectar no banco:", err.message);
  });
module.exports = pool;