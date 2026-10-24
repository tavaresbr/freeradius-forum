require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 029: cadastro completo de clientes em leads.
 *
 * Acrescenta endereco, documentos (RG, CNPJ, razao social), tipo de pessoa e os campos
 * de rastreio da importacao (id_externo, sistema_origem, importado_em). Converte
 * leads.origem de ENUM para VARCHAR(30) (o codigo ja grava valores fora do ENUM original)
 * e cria indices de busca por CPF e por id externo. Nao cria UNIQUE: o legado tem duplicados.
 *
 * Idempotente: so adiciona o que nao existe.
 */
const COLUNAS = [
  ['tipo_pessoa', "ENUM('PF','PJ') NOT NULL DEFAULT 'PF'"],
  ['rg', 'VARCHAR(30) NULL'],
  ['cnpj', 'VARCHAR(20) NULL'],
  ['razao_social', 'VARCHAR(255) NULL'],
  ['cep', 'VARCHAR(10) NULL'],
  ['logradouro', 'VARCHAR(255) NULL'],
  ['numero', 'VARCHAR(20) NULL'],
  ['complemento', 'VARCHAR(100) NULL'],
  ['bairro', 'VARCHAR(100) NULL'],
  ['cidade', 'VARCHAR(100) NULL'],
  ['uf', 'CHAR(2) NULL'],
  ['id_externo', 'VARCHAR(64) NULL'],
  ['sistema_origem', 'VARCHAR(30) NULL'],
  ['importado_em', 'TIMESTAMP NULL DEFAULT NULL'],
];

const INDICES = [
  ['idx_leads_empresa_cpf', '(empresa_id, cpf)'],
  ['idx_leads_empresa_idext', '(empresa_id, sistema_origem, id_externo)'],
];

async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 029: cadastro completo em leads ===\n');

    for (const [nome, ddl] of COLUNAS) {
      const [rows] = await conn.execute(
        "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads' AND COLUMN_NAME = ?",
        [nome]
      );
      if (rows[0].cnt > 0) {
        console.log(`   -> ${nome} ja existe`);
      } else {
        await conn.query(`ALTER TABLE leads ADD COLUMN ${nome} ${ddl}`);
        console.log(`   -> ${nome} adicionada`);
      }
    }

    const [[origem]] = await conn.execute(
      "SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'origem'"
    );
    if (origem && origem.DATA_TYPE === 'enum') {
      await conn.query("ALTER TABLE leads MODIFY COLUMN origem VARCHAR(30) NOT NULL DEFAULT 'portal'");
      console.log('   -> origem convertida de ENUM para VARCHAR(30)');
    } else {
      console.log('   -> origem ja nao e ENUM');
    }

    // empresa_configs.config_type e' ENUM: acrescenta 'sgp' (config da API do SGP por empresa)
    const [[cfgTipo]] = await conn.execute(
      "SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'empresa_configs' AND COLUMN_NAME = 'config_type'"
    );
    if (cfgTipo && /^enum\(/i.test(cfgTipo.COLUMN_TYPE) && !/'sgp'/.test(cfgTipo.COLUMN_TYPE)) {
      const novo = cfgTipo.COLUMN_TYPE.replace(/\)$/, ",'sgp')");
      await conn.query(`ALTER TABLE empresa_configs MODIFY COLUMN config_type ${novo} NOT NULL`);
      console.log("   -> 'sgp' adicionado ao ENUM empresa_configs.config_type");
    } else {
      console.log("   -> empresa_configs.config_type ja aceita 'sgp'");
    }

    for (const [nome, cols] of INDICES) {
      const [rows] = await conn.execute(
        "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads' AND INDEX_NAME = ?",
        [nome]
      );
      if (rows[0].cnt > 0) {
        console.log(`   -> indice ${nome} ja existe`);
      } else {
        await conn.query(`CREATE INDEX ${nome} ON leads ${cols}`);
        console.log(`   -> indice ${nome} criado`);
      }
    }

    console.log('\n=== Migration 029 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration 029:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
