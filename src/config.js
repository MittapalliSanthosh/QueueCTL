// src/config.js
require('dotenv').config();
const { getPool } = require('./db');

function getEnv(key, fallback) {
  return process.env[key] ?? fallback;
}

async function getConfig(name) {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT value FROM config WHERE name = ?', [name]);
  if (rows.length) return rows[0].value;
  return null;
}

async function setConfig(name, value) {
  const pool = await getPool();
  await pool.query(
    'INSERT INTO config(name,value) VALUES(?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [name, value]
  );
}

module.exports = { getEnv, getConfig, setConfig };

