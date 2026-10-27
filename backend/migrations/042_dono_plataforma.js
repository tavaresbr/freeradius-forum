require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 042: perfil "Dono da plataforma" (admins.dono_plataforma).
 * So o dono ve/usa Planos SaaS, Empresas, Assinatura das empresas, Atualizar/Backups/Logs.
 * Seed: tavaresdobrasil@outlook.com (so se ja for super_admin). Idempotente.
 */
const DONO_INICIAL = 'tavaresdobrasil@outlook.com';

(async () => {
  try {
    const [c] = await db.execute(
      "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admins' AND COLUMN_NAME = 'dono_plataforma' LIMIT 1"
    );
    if (c.length === 0) {
      await db.execute('ALTER TABLE admins ADD COLUMN dono_plataforma TINYINT(1) NOT NULL DEFAULT 0');
      console.log('[042] admins.dono_plataforma criada');
    }
    const [r] = await db.execute("UPDATE admins SET dono_plataforma = 1 WHERE email = ? AND role = 'super_admin'", [DONO_INICIAL]);
    console.log(r.affectedRows ? `[042] ${DONO_INICIAL} marcado como dono da plataforma` : `[042] ${DONO_INICIAL} nao encontrado como super_admin: ninguem marcado (todos os super admins seguem valendo ate alguem ser marcado)`);
  } catch (err) {
    console.error('[042] falhou:', err.message);
    process.exitCode = 1;
  } finally {
    process.exit();
  }
})();
