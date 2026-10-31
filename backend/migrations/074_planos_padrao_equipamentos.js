require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');
const { criarPlanoPadraoEquipamento } = require('../src/utils/empresaSetup');

/**
 * Migration 074: "Plano 60 minutos" gratis nos equipamentos que ainda nao tem NENHUM plano
 * (equipamentos novos ja ganham o plano no cadastro). Nao toca em quem ja tem plano. Idempotente.
 */
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 074: plano padrao nos equipamentos sem plano ===\n');
    const [sem] = await conn.execute(
      `SELECT m.id, m.empresa_id, m.nome
         FROM mikrotiks m
        WHERE NOT EXISTS (SELECT 1 FROM planos p WHERE p.mikrotik_id = m.id)`
    );
    let criados = 0;
    for (const m of sem) {
      await criarPlanoPadraoEquipamento(conn, m.empresa_id, m.id, m.nome);
      criados++;
      console.log(`   -> equipamento ${m.id} (${m.nome}): plano criado`);
    }
    console.log(`\n${criados} equipamento(s) sem plano receberam o plano padrao.`);
    console.log('\n=== Migration 074 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration 074:', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    process.exit();
  }
}

migrate();
