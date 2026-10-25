require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 035: planos gratis LGPD/Lead de 100/50 Mbps para 20/10 Mbps (60 min mantidos),
 * o mesmo padrao de empresaSetup.criarPlanosPadrao.
 *
 * So toca planos no padrao anterior (valor 0, 60 min, 100/50 Mbps): plano personalizado
 * na tela Planos nao e sobrescrito. Idempotente.
 */
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 035: planos padrao LGPD/Lead -> 20M/10M ===\n');

    const [r] = await conn.execute(
      `UPDATE planos
          SET velocidade_down = 20, velocidade_up = 10
        WHERE valor = 0 AND duracao_minutos = 60
          AND velocidade_down = 100 AND velocidade_up = 50
          AND LOWER(nome) IN ('lgpd', 'lead')`
    );
    console.log(`   -> ${r.affectedRows} plano(s) atualizado(s)`);

    console.log('\n=== Migration 035 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration 035:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
