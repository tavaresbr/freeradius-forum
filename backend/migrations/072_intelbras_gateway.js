/**
 * Migration 072 — Gateway Intelbras (AP standalone).
 *
 * mikrotiks.tipo e' ENUM (migrations 019/025). MODIFY para incluir 'intelbras'
 * preservando os valores existentes. Sem colunas novas: Intelbras opera como
 * External Web Portal + External RADIUS (igual ao Grandstream), com `ip` = IP do
 * AP e `senha` = secret RADIUS.
 *
 * Idempotente: so altera se o ENUM ainda nao inclui 'intelbras'.
 */
const db = require("../db");

async function up() {
  const [rows] = await db.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mikrotiks' AND COLUMN_NAME = 'tipo'`
  );
  if (rows.length && String(rows[0].t).includes("'intelbras'")) {
    console.log("072: tipo ja inclui 'intelbras'.");
    return;
  }
  await db.query(
    "ALTER TABLE mikrotiks MODIFY COLUMN tipo " +
    "ENUM('mikrotik','omada','unifi','grandstream','intelbras') NOT NULL DEFAULT 'mikrotik'"
  );
  console.log("072: ENUM tipo atualizado com 'intelbras'.");
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("072 falhou:", err);
    process.exit(1);
  });
