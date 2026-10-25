require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 036: padroniza os planos gratis LGPD/Lead da empresa `default` (slug).
 *
 * A empresa tinha varios planos com o mesmo nome (e velocidades 0/0, 15/30, 200/200); os portais
 * pegam `LIMIT 1` por nome, entao nao havia como saber qual valia. Para cada nome:
 *   - fica UM plano: o mais referenciado (radius_users + pagamentos), depois o que tem
 *     equipamento, depois o de menor id;
 *   - as referencias dos duplicados (qualquer tabela com coluna `plano_id` + radusergroup) sao
 *     reapontadas para o que fica, e entao os duplicados sao apagados;
 *   - o que fica vira 60 min, 20 Mbps down / 10 Mbps up, valor 0, ativo (e herda o equipamento
 *     de um duplicado se estava sem).
 *
 * So age quando ha duplicados do mesmo nome: depois de rodar, nao repete (nao sobrescreve ajuste
 * posterior). `node migrations/036_planos_default_dedup.js --dry` so mostra o que faria.
 */
const NOMES = ['lgpd', 'lead'];
const NAO_TOCAR = new Set(['assinaturas', 'assinatura_cobrancas']); // plano_id la e' de saas_planos

async function migrate() {
  const dry = process.argv.includes('--dry');
  const conn = await db.getConnection();
  try {
    console.log(`=== Migration 036: planos LGPD/Lead da empresa default${dry ? ' (DRY RUN)' : ''} ===\n`);

    const [[emp]] = await conn.execute("SELECT id FROM empresas WHERE slug = 'default'");
    if (!emp) {
      console.log('   -> empresa default nao existe, nada a fazer');
      return;
    }

    const [tabs] = await conn.execute(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'plano_id'`
    );
    const tabelas = tabs.map((t) => t.TABLE_NAME).filter((t) => !NAO_TOCAR.has(t));

    await conn.beginTransaction();
    for (const nome of NOMES) {
      const [planos] = await conn.execute(
        'SELECT id, mikrotik_id FROM planos WHERE empresa_id = ? AND LOWER(nome) = ? ORDER BY id',
        [emp.id, nome]
      );
      if (planos.length <= 1) {
        console.log(`   -> ${nome}: ${planos.length} plano, nada a fazer`);
        continue;
      }

      for (const p of planos) {
        let refs = 0;
        for (const t of tabelas) {
          const [[r]] = await conn.query('SELECT COUNT(*) AS n FROM ?? WHERE plano_id = ?', [t, p.id]);
          refs += r.n;
        }
        p.refs = refs;
      }
      planos.sort((a, b) => b.refs - a.refs || (b.mikrotik_id ? 1 : 0) - (a.mikrotik_id ? 1 : 0) || a.id - b.id);
      const keep = planos[0];
      const dups = planos.slice(1);
      const mk = keep.mikrotik_id || (dups.find((d) => d.mikrotik_id) || {}).mikrotik_id || null;
      console.log(`   -> ${nome}: fica id ${keep.id} (${keep.refs} ref.); apaga ${dups.map((d) => d.id).join(', ')}`);
      if (dry) continue;

      const ids = dups.map((d) => d.id);
      for (const t of tabelas) {
        await conn.query('UPDATE ?? SET plano_id = ? WHERE plano_id IN (?)', [t, keep.id, ids]);
      }
      await conn.query('UPDATE radusergroup SET groupname = ? WHERE groupname IN (?)', [String(keep.id), ids.map(String)]);
      await conn.query('DELETE FROM planos WHERE id IN (?) AND empresa_id = ?', [ids, emp.id]);
      await conn.execute(
        `UPDATE planos SET duracao_minutos = 60, velocidade_down = 20, velocidade_up = 10,
                valor = 0, ativo = 1, mikrotik_id = ? WHERE id = ?`,
        [mk, keep.id]
      );
    }
    if (dry) await conn.rollback(); else await conn.commit();

    console.log('\n=== Migration 036 concluida com sucesso! ===');
  } catch (err) {
    try { await conn.rollback(); } catch (e) { /* sem transacao aberta */ }
    console.error('Erro na migration 036:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
