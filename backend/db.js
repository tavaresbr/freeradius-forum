require("dotenv").config();
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // db.query formata o SQL no cliente: sem isso um JSON {"username":1} no lugar de uma string vira
  // `username` = 1 (sempre verdadeiro) e um DELETE/UPDATE "por usuario" atinge todas as linhas.
  stringifyObjects: true
});

module.exports = pool;
