require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 041: adicionais mensais avulsos da assinatura SaaS.
 *
 *  - saas_adicionais: catalogo (o que a empresa pode comprar por cima do plano)
 *  - assinatura_adicionais: compras da empresa (1 linha por compra, vence_em proprio)
 *  - assinatura_cobrancas: adicional_id, quantidade, assinatura_adicional_id (renovacao)
 *
 * Seeds (so com a tabela vazia): +1/+5 equipamentos e +1 admin ativos; os demais ficam
 * cadastrados e INATIVOS ate o sistema conseguir aplica-los (WhatsApp, Campanhas, etc.).
 * Idempotente (CREATE IF NOT EXISTS; colunas conferidas em INFORMATION_SCHEMA).
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
    console.log('=== Migration 041: adicionais SaaS ===\n');

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS saas_adicionais (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        descricao VARCHAR(255) NULL,
        tipo ENUM('equipamentos','admins','portais','whatsapp','campanhas','exportacao','sem_marca','dominio') NOT NULL,
        incremento INT NOT NULL DEFAULT 1,
        valor DECIMAL(10,2) NOT NULL DEFAULT 0,
        ciclo_dias INT NOT NULL DEFAULT 30,
        plano_minimo_id INT NULL,
        ativo TINYINT(1) NOT NULL DEFAULT 1,
        ordem INT NOT NULL DEFAULT 0,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_adicionais_plano_min FOREIGN KEY (plano_minimo_id) REFERENCES saas_planos(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS assinatura_adicionais (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        adicional_id INT NOT NULL,
        quantidade INT NOT NULL DEFAULT 1,
        vence_em DATETIME NOT NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_ass_adic_empresa (empresa_id, vence_em),
        CONSTRAINT fk_ass_adic_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
        CONSTRAINT fk_ass_adic_adicional FOREIGN KEY (adicional_id) REFERENCES saas_adicionais(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    for (const [col, ddl] of [
      ['adicional_id', 'ADD COLUMN adicional_id INT NULL'],
      ['quantidade', 'ADD COLUMN quantidade INT NOT NULL DEFAULT 1'],
      ['assinatura_adicional_id', 'ADD COLUMN assinatura_adicional_id INT NULL'],
    ]) {
      if (!(await colunaExiste(conn, 'assinatura_cobrancas', col))) {
        await conn.execute(`ALTER TABLE assinatura_cobrancas ${ddl}`);
        console.log(`   -> assinatura_cobrancas.${col} criada`);
      }
    }

    const [[{ n }]] = await conn.execute('SELECT COUNT(*) AS n FROM saas_adicionais');
    if (n === 0) {
      const planoId = async (nome) => {
        const [[p]] = await conn.execute('SELECT id FROM saas_planos WHERE LOWER(nome) = ? LIMIT 1', [nome.toLowerCase()]);
        return p ? p.id : null;
      };
      const start = await planoId('Start');
      const pro = await planoId('Pro');
      const business = await planoId('Business');
      // nome, descricao, tipo, incremento, valor, plano minimo, ativo
      const seeds = [
        ['+1 equipamento', 'Mais 1 equipamento por mes', 'equipamentos', 1, 29.90, start, 1],
        ['+5 equipamentos', 'Mais 5 equipamentos por mes', 'equipamentos', 5, 119.90, start, 1],
        ['+1 administrador', 'Mais 1 administrador por mes', 'admins', 1, 14.90, start, 1],
        ['+1 portal cativo', 'Mais 1 portal cativo', 'portais', 1, 19.90, start, 0],
        ['Modulo WhatsApp', 'Login e avisos por WhatsApp', 'whatsapp', 1, 49.90, start, 0],
        ['Modulo Campanhas', 'Campanhas no portal', 'campanhas', 1, 39.90, start, 0],
        ['Remover "Powered by Apex"', 'Portal sem a marca da plataforma', 'sem_marca', 1, 29.90, pro, 0],
        ['Dominio proprio no portal', 'Portal no seu dominio', 'dominio', 1, 39.90, business, 0],
        ['Exportacao da base de clientes', 'Exportar clientes em CSV', 'exportacao', 1, 19.90, start, 0],
      ];
      let ordem = 1;
      for (const [nome, descricao, tipo, inc, valor, minimo, ativo] of seeds) {
        await conn.execute(
          `INSERT INTO saas_adicionais (nome, descricao, tipo, incremento, valor, ciclo_dias, plano_minimo_id, ativo, ordem)
           VALUES (?, ?, ?, ?, ?, 30, ?, ?, ?)`,
          [nome, descricao, tipo, inc, valor, minimo, ativo, ordem++]
        );
      }
      console.log(`   -> ${seeds.length} adicionais criados (3 ativos, 6 inativos)`);
    }

    console.log('\n=== Migration 041 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration 041:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
