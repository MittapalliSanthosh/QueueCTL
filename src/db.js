// src/db.js
const mysql = require('mysql2/promise');
const { getEnv } = require('./config');

let pool;

async function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: getEnv('DB_HOST', '127.0.0.1'),
      user: getEnv('DB_USER', 'root'),
      password: getEnv('DB_PASSWORD', ''),
      database: getEnv('DB_NAME', 'queuectl'),
      port: getEnv('DB_PORT', 3306),
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }
  return pool;
}

module.exports = { getPool };

