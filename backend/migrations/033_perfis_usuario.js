require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');
const { garantirPerfil, atribuirPerfil } = require('../src/utils/perfis');

/**
 * Migration 033: perfis de usuario (Administrador / Usuário Padrão).
 *
 *  1. Garante os dois grupos do sistema: "Acesso Completo" (ja criado pela 018) e "Usuário Padrão"
 *     (operacional: Dashboard + Clientes/Leads/Pagamentos/Radius/Sessoes sem excluir). Se o grupo ja
 *     existe so completa modulos que faltam; nunca sobrescreve permissao ajustada a mao.
 *  2. Backfill: o PRIMEIRO admin (menor id, nao super_admin) de cada empresa que esteja sem nenhum
 *     grupo vira Administrador. Os demais sem grupo continuam sem acesso (nao concede acesso novo a
 *     quem hoje esta bloqueado de proposito; o dono atribui o perfil na tela Usuarios).
 *
 * Idempotente: rodar de novo nao muda nada alem de completar modulos que faltem.
 */
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 033: perfis de usuario ===\n');

    console.log('1. Garantindo os perfis do sistema...');
    const adm = await garantirPerfil(conn, 'administrador');
    const pad = await garantirPerfil(conn, 'padrao');
    console.log(`   -> Administrador (grupo ${adm}), Usuário Padrão (grupo ${pad})`);

    console.log('2. Primeiro admin de cada empresa sem grupo -> Administrador...');
    const [empresas] = await conn.execute('SELECT id FROM empresas');
    let promovidos = 0;
    for (const e of empresas) {
      const [[primeiro]] = await conn.execute(
        "SELECT MIN(id) AS id FROM admins WHERE empresa_id = ? AND role <> 'super_admin'",
        [e.id]
      );
      if (!primeiro || !primeiro.id) continue;
      const [[{ n }]] = await conn.execute('SELECT COUNT(*) AS n FROM admin_grupos WHERE admin_id = ?', [primeiro.id]);
      if (Number(n) > 0) continue;
      await atribuirPerfil(conn, primeiro.id, 'administrador');
      promovidos++;
      console.log(`   -> empresa ${e.id}: admin ${primeiro.id} agora e Administrador`);
    }
    console.log(`   -> ${promovidos} admin(s) promovido(s)`);

    console.log('\n=== Migration 033 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration 033:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
