require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 032: vincula em admin_empresas os admins criados pela tela Usuarios.
 *
 * Ate esta correcao, adminController.criarAdmin gravava so em `admins`. O login
 * (authController.login -> Admin.getEmpresas) exige uma linha em admin_empresas para
 * todo admin que nao seja super_admin, entao esses admins recebiam 403 "sem vinculo".
 * Aqui cada admin com empresa_id e sem NENHUM vinculo ganha o da propria empresa.
 *
 * Idempotente: so insere para quem ainda nao tem vinculo; rodar de novo nao muda nada.
 */
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 032: backfill de admin_empresas ===\n');
    const [result] = await conn.execute(
      `INSERT INTO admin_empresas (admin_id, empresa_id, role)
       SELECT a.id, a.empresa_id, COALESCE(a.role, 'operator')
         FROM admins a
        WHERE a.empresa_id IS NOT NULL
          AND a.role <> 'super_admin'
          AND NOT EXISTS (SELECT 1 FROM admin_empresas ae WHERE ae.admin_id = a.id)`
    );
    console.log(`   -> ${result.affectedRows} admin(s) vinculado(s)`);
    console.log('\n=== Migration 032 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration 032:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
