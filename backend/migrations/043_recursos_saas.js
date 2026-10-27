require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 043: recursos por plano SaaS (Fase 2 dos adicionais).
 *
 *  - saas_planos.inclui_whatsapp / inclui_campanhas / inclui_exportacao (TINYINT, default 0)
 *  - saas_planos.max_portais (NULL = ilimitado)
 *
 * Legado: planos existentes PAGOS (valor > 0) passam a incluir os 3 recursos e portais ilimitados,
 * para ninguem perder nada ao atualizar; o plano gratis (valor = 0) fica sem recursos (ajustar em
 * Planos SaaS). Ativa os adicionais de seed dos tipos aplicaveis (portais, whatsapp, campanhas,
 * exportacao) que ainda estejam inativos. Idempotente.
 */
async function colunaExiste(conn, tabela, coluna) {
  const [r] = await conn.execute(
    'SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [tabela, coluna]
  );
  return r.length > 0;
}

async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 043: recursos SaaS ===\n');
    let nova = false;
    for (const [col, ddl] of [
      ['inclui_whatsapp', 'ADD COLUMN inclui_whatsapp TINYINT(1) NOT NULL DEFAULT 0'],
      ['inclui_campanhas', 'ADD COLUMN inclui_campanhas TINYINT(1) NOT NULL DEFAULT 0'],
      ['inclui_exportacao', 'ADD COLUMN inclui_exportacao TINYINT(1) NOT NULL DEFAULT 0'],
      ['max_portais', 'ADD COLUMN max_portais INT NULL'],
    ]) {
      if (!(await colunaExiste(conn, 'saas_planos', col))) {
        await conn.execute(`ALTER TABLE saas_planos ${ddl}`);
        console.log(`   -> saas_planos.${col} criada`);
        if (col === 'inclui_whatsapp') nova = true;
      }
    }
    // Backfill so na primeira execucao (nao sobrescreve o que o super admin ajustar depois).
    if (nova) {
      const [r] = await conn.execute(
        'UPDATE saas_planos SET inclui_whatsapp = 1, inclui_campanhas = 1, inclui_exportacao = 1 WHERE valor > 0'
      );
      console.log(`   -> ${r.affectedRows} plano(s) pago(s) mantem todos os recursos`);
    }
    try {
      const [a] = await conn.execute(
        "UPDATE saas_adicionais SET ativo = 1 WHERE ativo = 0 AND tipo IN ('portais','whatsapp','campanhas','exportacao') AND nome IN ('+1 portal cativo','Modulo WhatsApp','Modulo Campanhas','Exportacao da base de clientes')"
      );
      if (a.affectedRows) console.log(`   -> ${a.affectedRows} adicional(is) de recurso ativado(s)`);
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
    }
    console.log('\n=== Migration 043 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration 043:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
