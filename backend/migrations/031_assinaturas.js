require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 031: SaaS - assinaturas por empresa.
 *
 *  - saas_planos: planos de USO DO SISTEMA (nao confundir com `planos` do hotspot)
 *  - assinaturas: 1 por empresa (status trial/ativa/vencida/cancelada, vencimento)
 *  - assinatura_cobrancas: cobrancas PIX da assinatura (webhook proprio, sem relacao com `pagamentos`)
 *  - plataforma_configs: credenciais do gateway DA PLATAFORMA (separadas de empresa_configs)
 *
 * Seeds: 3 planos exemplo e assinatura de cortesia (ativa, +1 ano) para as empresas que
 * ja existem — sem isso o deploy bloquearia todo mundo.
 * Idempotente (CREATE IF NOT EXISTS; seeds so quando faltam).
 */
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 031: assinaturas SaaS ===\n');

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS saas_planos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        descricao VARCHAR(255) NULL,
        valor DECIMAL(10,2) NOT NULL DEFAULT 0,
        ciclo_dias INT NOT NULL DEFAULT 30,
        max_equipamentos INT NULL,
        max_admins INT NULL,
        ativo TINYINT(1) NOT NULL DEFAULT 1,
        ordem INT NOT NULL DEFAULT 0,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS assinaturas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        plano_id INT NULL,
        status ENUM('trial','ativa','vencida','cancelada') NOT NULL DEFAULT 'trial',
        trial_ate DATETIME NULL,
        vence_em DATETIME NULL,
        carencia_dias INT NOT NULL DEFAULT 3,
        ultimo_aviso VARCHAR(10) NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_assinaturas_empresa (empresa_id),
        CONSTRAINT fk_assinaturas_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
        CONSTRAINT fk_assinaturas_plano FOREIGN KEY (plano_id) REFERENCES saas_planos(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS assinatura_cobrancas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        plano_id INT NULL,
        valor DECIMAL(10,2) NOT NULL,
        metodo VARCHAR(20) NOT NULL DEFAULT 'pix',
        status ENUM('aguardando','aprovada','recusada') NOT NULL DEFAULT 'aguardando',
        mp_pagamento_id VARCHAR(40) NULL,
        copia_cola TEXT NULL,
        qr_code_base64 MEDIUMTEXT NULL,
        pago_em DATETIME NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_cobrancas_empresa (empresa_id, status),
        KEY idx_cobrancas_mp (mp_pagamento_id),
        CONSTRAINT fk_cobrancas_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS plataforma_configs (
        chave VARCHAR(50) PRIMARY KEY,
        config_json JSON NOT NULL,
        atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [[{ n }]] = await conn.execute('SELECT COUNT(*) AS n FROM saas_planos');
    if (n === 0) {
      await conn.execute(
        `INSERT INTO saas_planos (nome, descricao, valor, ciclo_dias, max_equipamentos, max_admins, ordem) VALUES
          ('Basico', 'Para comecar: 1 equipamento', 49.90, 30, 1, 2, 1),
          ('Pro', 'Ate 5 equipamentos', 99.90, 30, 5, 5, 2),
          ('Business', 'Equipamentos e admins ilimitados', 199.90, 30, NULL, NULL, 3)`
      );
      console.log('   -> 3 planos exemplo criados');
    }

    const [[plano]] = await conn.execute('SELECT id FROM saas_planos ORDER BY ordem DESC, id DESC LIMIT 1');
    const [r] = await conn.execute(
      `INSERT INTO assinaturas (empresa_id, plano_id, status, vence_em)
       SELECT e.id, ?, 'ativa', DATE_ADD(NOW(), INTERVAL 365 DAY)
       FROM empresas e WHERE NOT EXISTS (SELECT 1 FROM assinaturas a WHERE a.empresa_id = e.id)`,
      [plano.id]
    );
    console.log(`   -> ${r.affectedRows} assinatura(s) de cortesia criada(s) para empresas existentes`);

    console.log('\n=== Migration 031 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration 031:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
