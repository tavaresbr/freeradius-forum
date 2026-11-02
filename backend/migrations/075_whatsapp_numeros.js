require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Varios numeros de WhatsApp por empresa: tabela whatsapp_numeros (alem do numero principal, que continua
// sendo a instancia de empresa_configs 'whatsapp'), whatsapp_conversas.numero_id (0 = principal), chave unica da
// conversa por numero, limite no plano (saas_planos.max_whatsapp_numeros, padrao 1) e adicional "+1 numero". Idempotente.

async function tabelaExiste(conn, tabela) {
  const [r] = await conn.execute(
    'SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [tabela]);
  return r.length > 0;
}
async function colunaExiste(conn, tabela, coluna) {
  const [r] = await conn.execute(
    'SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [tabela, coluna]);
  return r.length > 0;
}
async function indiceExiste(conn, tabela, indice) {
  const [r] = await conn.execute(
    'SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1', [tabela, indice]);
  return r.length > 0;
}

async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 075: varios numeros de WhatsApp ===\n');

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS whatsapp_numeros (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        nome VARCHAR(60) NOT NULL,
        instance_name VARCHAR(80) NOT NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_wa_numero_instancia (instance_name),
        KEY idx_wa_numero_empresa (empresa_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('1. tabela whatsapp_numeros pronta.');

    if (await tabelaExiste(conn, 'whatsapp_conversas')) {
      if (!(await colunaExiste(conn, 'whatsapp_conversas', 'numero_id'))) {
        await conn.execute('ALTER TABLE whatsapp_conversas ADD COLUMN numero_id INT NOT NULL DEFAULT 0');
        console.log('2. whatsapp_conversas.numero_id criada (0 = numero principal).');
      } else console.log('2. whatsapp_conversas.numero_id ja existe.');
      // A mesma pessoa pode falar com dois numeros da empresa: a chave da conversa passa a incluir o numero.
      if (!(await indiceExiste(conn, 'whatsapp_conversas', 'uk_wa_conversa_numero'))) {
        await conn.execute('ALTER TABLE whatsapp_conversas ADD UNIQUE KEY uk_wa_conversa_numero (empresa_id, numero_id, jid)');
        console.log('3. chave unica (empresa, numero, jid) criada.');
      }
      if (await indiceExiste(conn, 'whatsapp_conversas', 'uk_wa_conversa')) {
        await conn.execute('ALTER TABLE whatsapp_conversas DROP INDEX uk_wa_conversa');
        console.log('   chave antiga (empresa, jid) removida.');
      }
    } else {
      console.log('2-3. whatsapp_conversas nao existe (rode a migration 048 e depois esta de novo).');
    }

    if (await tabelaExiste(conn, 'saas_planos')) {
      if (!(await colunaExiste(conn, 'saas_planos', 'max_whatsapp_numeros'))) {
        await conn.execute('ALTER TABLE saas_planos ADD COLUMN max_whatsapp_numeros INT NULL');
        // Ninguem perde nada hoje: todo plano existente inclui 1 numero (o principal). NULL = ilimitado.
        await conn.execute('UPDATE saas_planos SET max_whatsapp_numeros = 1');
        console.log('4. saas_planos.max_whatsapp_numeros criada (1 em todos os planos).');
      } else console.log('4. saas_planos.max_whatsapp_numeros ja existe.');
    }

    if (await tabelaExiste(conn, 'saas_adicionais')) {
      const [[col]] = await conn.execute(
        "SELECT COLUMN_TYPE AS t FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'saas_adicionais' AND COLUMN_NAME = 'tipo'");
      if (col && String(col.t).indexOf("'whatsapp_numeros'") === -1) {
        const valores = String(col.t).replace(/^enum\(/i, '').replace(/\)$/, '');
        await conn.execute(`ALTER TABLE saas_adicionais MODIFY COLUMN tipo ENUM(${valores},'whatsapp_numeros') NOT NULL`);
        console.log("5. ENUM saas_adicionais.tipo ganhou 'whatsapp_numeros'.");
      }
      const [[ja]] = await conn.execute("SELECT COUNT(*) AS n FROM saas_adicionais WHERE tipo = 'whatsapp_numeros'");
      if (!ja.n) {
        const [[{ prox }]] = await conn.execute('SELECT COALESCE(MAX(ordem), 0) + 1 AS prox FROM saas_adicionais');
        await conn.execute(
          `INSERT INTO saas_adicionais (nome, descricao, tipo, incremento, valor, ciclo_dias, plano_minimo_id, ativo, ordem)
           VALUES ('+1 número de WhatsApp', 'Conecte mais 1 número de WhatsApp ao atendimento', 'whatsapp_numeros', 1, 39.90, 30, NULL, 1, ?)`, [prox]);
        console.log('   -> adicional "+1 número de WhatsApp" criado (ativo; ajuste o valor em Planos SaaS).');
      }
    }

    console.log('\n=== Migration 075 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
