/**
 * Migration 075 — completa leads.mikrotik_id (Equipamento da tela Cadastros LGPD).
 *
 * Bug: leads.cpf e' gravado como o cliente digitou (com pontos e traco) e o codigo/backfill da 056 comparavam com o
 * CPF so com digitos, entao quase nenhum cadastro ficava com equipamento. O codigo novo ja normaliza; esta migration
 * refaz o backfill so onde mikrotik_id ainda e NULL, normalizando o CPF: 1) radius_users.nas_id (username = CPF);
 * 2) sessao mais recente do MAC em connection_logs. Idempotente (so toca NULL; nunca sobrescreve).
 */
const db = require("../db");

const CPF_LIMPO = "REPLACE(REPLACE(REPLACE(l.cpf, '.', ''), '-', ''), ' ', '')";

async function up() {
  const [[col]] = await db.query(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'mikrotik_id'"
  );
  if (!col.n) { console.log("075: leads.mikrotik_id nao existe (rode a 056 antes). Nada a fazer."); return; }

  try {
    const [r1] = await db.query(
      `UPDATE leads l
       JOIN radius_users ru ON ru.empresa_id = l.empresa_id
         AND ru.username COLLATE utf8mb4_unicode_ci = ${CPF_LIMPO} COLLATE utf8mb4_unicode_ci
       JOIN mikrotiks m ON m.id = ru.nas_id AND m.empresa_id = l.empresa_id
       SET l.mikrotik_id = ru.nas_id
       WHERE l.mikrotik_id IS NULL AND l.cpf IS NOT NULL AND l.cpf <> ''`
    );
    console.log(`075: backfill por radius_users: ${r1.affectedRows} cadastro(s).`);
  } catch (err) {
    console.warn("075: backfill por radius_users falhou (segue):", err.message);
  }

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
    console.log(`075: backfill por connection_logs: ${r2.affectedRows} cadastro(s).`);
  } catch (err) {
    console.warn("075: backfill por connection_logs falhou (segue):", err.message);
  }

  // 3) Cadastros do hotspot de teste/novos que ainda nao fecharam sessao (sem connection_logs): sessao do radacct pelo MAC
  try {
    const [r3] = await db.query(
      `UPDATE leads l
       JOIN (
         SELECT ra.callingstationid AS mac, MAX(ra.radacctid) AS ultimo
         FROM radacct ra GROUP BY ra.callingstationid
       ) u ON u.mac COLLATE utf8mb4_unicode_ci = l.mac COLLATE utf8mb4_unicode_ci
       JOIN radacct r ON r.radacctid = u.ultimo
       JOIN mikrotiks m ON m.empresa_id = l.empresa_id
         AND m.ip COLLATE utf8mb4_unicode_ci = r.nasipaddress COLLATE utf8mb4_unicode_ci
       SET l.mikrotik_id = m.id
       WHERE l.mikrotik_id IS NULL AND l.mac IS NOT NULL AND l.mac <> ''`
    );
    console.log(`075: backfill por radacct: ${r3.affectedRows} cadastro(s).`);
  } catch (err) {
    console.warn("075: backfill por radacct falhou (segue):", err.message);
  }
}

module.exports = { up };

if (require.main === module) {
  up()
    .then(() => { console.log("075 concluida."); process.exit(0); })
    .catch((err) => { console.error("075 falhou:", err); process.exit(1); });
}
