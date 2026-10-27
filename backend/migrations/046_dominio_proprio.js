require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 046: dominio proprio no portal (SaaS Fase 3).
 *
 *  - empresas.dominio_portal (UNIQUE), dominio_status, dominio_erro, dominio_ativado_em
 *  - saas_planos.inclui_dominio (recurso liga/desliga, como os da 043)
 *
 * Legado: planos PAGOS (valor > 0) passam a incluir o recurso so na primeira execucao; ativa o
 * adicional de seed "Dominio proprio no portal" se ainda estiver inativo. Idempotente.
 */
async function colunaExiste(conn, tabela, coluna) {
  const [r] = await conn.execute(
    'SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [tabela, coluna]
  );
  return r.length > 0;
}
async function indiceExiste(conn, tabela, nome) {
  const [r] = await conn.execute(
    'SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
    [tabela, nome]
  );
  return r.length > 0;
}

async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 046: dominio proprio ===\n');
    for (const [col, ddl] of [
      ['dominio_portal', 'ADD COLUMN dominio_portal VARCHAR(253) NULL'],
      ['dominio_status', "ADD COLUMN dominio_status ENUM('pendente','dns_ok','ativo','erro') NULL"],
      ['dominio_erro', 'ADD COLUMN dominio_erro VARCHAR(255) NULL'],
      ['dominio_ativado_em', 'ADD COLUMN dominio_ativado_em DATETIME NULL'],
    ]) {
      if (!(await colunaExiste(conn, 'empresas', col))) {
        await conn.execute(`ALTER TABLE empresas ${ddl}`);
        console.log(`   -> empresas.${col} criada`);
      }
    }
    if (!(await indiceExiste(conn, 'empresas', 'uk_empresas_dominio'))) {
      try {
        await conn.execute('ALTER TABLE empresas ADD UNIQUE KEY uk_empresas_dominio (dominio_portal)');
        console.log('   -> uk_empresas_dominio criado');
      } catch (e) {
        console.warn('   !! nao foi possivel criar uk_empresas_dominio:', e.message);
      }
    }

    let nova = false;
    if (!(await colunaExiste(conn, 'saas_planos', 'inclui_dominio'))) {
      await conn.execute('ALTER TABLE saas_planos ADD COLUMN inclui_dominio TINYINT(1) NOT NULL DEFAULT 0');
      console.log('   -> saas_planos.inclui_dominio criada');
      nova = true;
    }
    if (nova) {
      const [r] = await conn.execute('UPDATE saas_planos SET inclui_dominio = 1 WHERE valor > 0');
      console.log(`   -> ${r.affectedRows} plano(s) pago(s) incluem dominio proprio`);
    }
    try {
      const [a] = await conn.execute(
        "UPDATE saas_adicionais SET ativo = 1 WHERE ativo = 0 AND tipo = 'dominio'"
      );
      if (a.affectedRows) console.log(`   -> ${a.affectedRows} adicional(is) de dominio ativado(s)`);
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
    }
    console.log('\n=== Migration 046 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration 046:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
