require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Claude no chat do WhatsApp: recurso "ia" no plano (inclui_ia + limite mensal de respostas), adicional "ia",
// tabela de uso mensal (ia_uso) e whatsapp_mensagens.ia (resposta escrita pela IA). Idempotente.

async function tabelaExiste(conn, t) {
  const [r] = await conn.execute('SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [t]);
  return r.length > 0;
}
async function colunaExiste(conn, t, c) {
  const [r] = await conn.execute('SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [t, c]);
  return r.length > 0;
}

async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 077: IA no atendimento (Claude) ===\n');

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ia_uso (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        mes CHAR(7) NOT NULL,
        respostas INT NOT NULL DEFAULT 0,
        tokens_in BIGINT NOT NULL DEFAULT 0,
        tokens_out BIGINT NOT NULL DEFAULT 0,
        UNIQUE KEY uk_ia_uso (empresa_id, mes)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('1. tabela ia_uso pronta.');

    if (await tabelaExiste(conn, 'whatsapp_mensagens') && !(await colunaExiste(conn, 'whatsapp_mensagens', 'ia'))) {
      await conn.execute('ALTER TABLE whatsapp_mensagens ADD COLUMN ia TINYINT(1) NOT NULL DEFAULT 0');
      console.log('2. whatsapp_mensagens.ia criada.');
    } else console.log('2. whatsapp_mensagens.ia ok.');

    if (await tabelaExiste(conn, 'saas_planos')) {
      if (!(await colunaExiste(conn, 'saas_planos', 'inclui_ia'))) {
        // Recurso que gera custo: nenhum plano existente ganha IA sozinho (o dono liga em Planos SaaS).
        await conn.execute('ALTER TABLE saas_planos ADD COLUMN inclui_ia TINYINT(1) NOT NULL DEFAULT 0');
        console.log('3. saas_planos.inclui_ia criada (0 em todos os planos).');
      }
      if (!(await colunaExiste(conn, 'saas_planos', 'ia_respostas_mes'))) {
        await conn.execute('ALTER TABLE saas_planos ADD COLUMN ia_respostas_mes INT NULL');
        console.log('4. saas_planos.ia_respostas_mes criada (NULL = ilimitado).');
      }
    }

    if (await tabelaExiste(conn, 'saas_adicionais')) {
      const [[col]] = await conn.execute(
        "SELECT COLUMN_TYPE AS t FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'saas_adicionais' AND COLUMN_NAME = 'tipo'");
      if (col && String(col.t).indexOf("'ia'") === -1) {
        const valores = String(col.t).replace(/^enum\(/i, '').replace(/\)$/, '');
        await conn.execute(`ALTER TABLE saas_adicionais MODIFY COLUMN tipo ENUM(${valores},'ia') NOT NULL`);
        console.log("5. ENUM saas_adicionais.tipo ganhou 'ia'.");
      }
      const [[ja]] = await conn.execute("SELECT COUNT(*) AS n FROM saas_adicionais WHERE tipo = 'ia'");
      if (!ja.n) {
        const [[{ prox }]] = await conn.execute('SELECT COALESCE(MAX(ordem), 0) + 1 AS prox FROM saas_adicionais');
        // Inativo de proposito: o preco depende do custo da API; o dono ajusta e ativa em Planos SaaS.
        await conn.execute(
          `INSERT INTO saas_adicionais (nome, descricao, tipo, incremento, valor, ciclo_dias, plano_minimo_id, ativo, ordem)
           VALUES ('Atendente com IA', 'Claude responde clientes no WhatsApp e ajuda a equipe', 'ia', 1, 99.90, 30, NULL, 0, ?)`, [prox]);
        console.log('   -> adicional "Atendente com IA" criado (INATIVO; ajuste o valor e ative em Planos SaaS).');
      }
    }

    console.log('\n=== Migration 077 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration 077:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
