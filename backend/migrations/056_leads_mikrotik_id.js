/**
 * Migration 056 — equipamento do aceite em leads.
 *
 * - leads.mikrotik_id (INT NULL) + indice (empresa_id, mikrotik_id): equipamento (mikrotiks.id) em que o cliente
 *   fez o cadastro/aceite; alimenta o filtro "Equipamento" da tela Cadastros LGPD. SEM FK de proposito: apagar um
 *   equipamento nao pode apagar consentimento (ver Compliance, gotcha da cascata).
 * - Backfill (so onde esta NULL): 1) radius_users.nas_id pelo username = CPF do lead; 2) connection_logs -> mikrotiks
 *   por nas_ip = mikrotiks.ip e MAC do lead (sessao mais recente).
 * Idempotente.
 */
const db = require("../db");

async function colunaExiste(tabela, coluna) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tabela, coluna]
  );
  return rows[0].n > 0;
}

async function indiceExiste(tabela, indice) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [tabela, indice]
  );
  return rows[0].n > 0;
}

async function up() {
  if (!(await colunaExiste("leads", "mikrotik_id"))) {
    await db.query("ALTER TABLE leads ADD COLUMN mikrotik_id INT NULL");
    console.log("056: leads.mikrotik_id criada.");
  }
  if (!(await indiceExiste("leads", "idx_leads_empresa_mikrotik"))) {
    await db.query("CREATE INDEX idx_leads_empresa_mikrotik ON leads (empresa_id, mikrotik_id)");
    console.log("056: indice idx_leads_empresa_mikrotik criado.");
  }

  // 1) Pelo acesso RADIUS do CPF (nas_id guarda o mikrotiks.id no momento da liberacao)
  try {
    const [r1] = await db.query(
      `UPDATE leads l
       JOIN radius_users ru ON ru.empresa_id = l.empresa_id
         AND ru.username COLLATE utf8mb4_unicode_ci = l.cpf COLLATE utf8mb4_unicode_ci
       JOIN mikrotiks m ON m.id = ru.nas_id AND m.empresa_id = l.empresa_id
       SET l.mikrotik_id = ru.nas_id
       WHERE l.mikrotik_id IS NULL AND l.cpf IS NOT NULL AND l.cpf <> ''`
    );
    console.log(`056: backfill por radius_users: ${r1.affectedRows} cadastro(s).`);
  } catch (err) {
    console.warn("056: backfill por radius_users falhou (segue):", err.message);
  }

  // 2) Pela sessao mais recente do MAC em connection_logs
  try {
    const [r2] = await db.query(
      `UPDATE leads l
       JOIN (
         SELECT cl.empresa_id, cl.mac, m.id AS mikrotik_id
         FROM connection_logs cl
         JOIN (
           SELECT empresa_id, mac, MAX(inicio_conexao) AS ini FROM connection_logs WHERE mac <> '' GROUP BY empresa_id, mac
         ) u ON u.empresa_id = cl.empresa_id AND u.mac = cl.mac AND u.ini = cl.inicio_conexao
         JOIN mikrotiks m ON m.empresa_id = cl.empresa_id
           AND m.ip COLLATE utf8mb4_unicode_ci = cl.nas_ip COLLATE utf8mb4_unicode_ci
       ) c ON c.empresa_id = l.empresa_id
          AND c.mac COLLATE utf8mb4_unicode_ci = l.mac COLLATE utf8mb4_unicode_ci
       SET l.mikrotik_id = c.mikrotik_id
       WHERE l.mikrotik_id IS NULL AND l.mac IS NOT NULL AND l.mac <> ''`
    );
    console.log(`056: backfill por connection_logs: ${r2.affectedRows} cadastro(s).`);
  } catch (err) {
    console.warn("056: backfill por connection_logs falhou (segue):", err.message);
  }
}

module.exports = { up };

if (require.main === module) {
  up()
    .then(() => { console.log("056 concluida."); process.exit(0); })
    .catch((err) => { console.error("056 falhou:", err); process.exit(1); });
}
