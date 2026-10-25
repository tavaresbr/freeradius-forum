require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 034: atualiza os planos gratis LGPD/Lead existentes para o novo padrao
 * (60 min, 100 Mbps down / 50 Mbps up), o mesmo de empresaSetup.criarPlanosPadrao.
 *
 * So toca planos ainda no padrao ANTIGO (valor 0, LGPD 5 min ou Lead 1 min, 2/2 Mbps):
 * quem ja personalizou o plano na tela Planos nao e sobrescrito.
 *
 * Idempotente: depois de rodar, nenhuma linha casa com o filtro.
 */
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 034: planos padrao LGPD/Lead -> 60 min, 100M/50M ===\n');

    const [r] = await conn.execute(
      `UPDATE planos
          SET duracao_minutos = 60, velocidade_down = 100, velocidade_up = 50
        WHERE valor = 0
          AND velocidade_down = 2 AND velocidade_up = 2
          AND ((LOWER(nome) = 'lgpd' AND duracao_minutos = 5)
            OR (LOWER(nome) = 'lead' AND duracao_minutos = 1))`
    );
    console.log(`   -> ${r.affectedRows} plano(s) atualizado(s)`);

    console.log('\n=== Migration 034 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration 034:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
