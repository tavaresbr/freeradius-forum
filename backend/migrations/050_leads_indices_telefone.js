require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Clientes: busca por telefone (atendimento WhatsApp e importacoes) e lista paginada sem varrer a tabela.
//  - leads.telefone_fim10: coluna GERADA (10 ultimos digitos do telefone) — nenhum caminho que grava
//    telefone precisa mudar; se o MySQL recusar, a migration avisa e segue (o codigo cai no fallback).
//  - indices (empresa_id, telefone_fim10), (empresa_id, criado_em) e (empresa_id, status).
// Idempotente (INFORMATION_SCHEMA). Em tabela grande o ALTER leva alguns segundos e trava escrita em leads.
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 050: leads (telefone_fim10 e indices) ===\n');

    const [[col]] = await conn.execute(
      "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'telefone_fim10'"
    );
    let temColuna = col.n > 0;
    if (!temColuna) {
      try {
        await conn.query(
          "ALTER TABLE leads ADD COLUMN telefone_fim10 VARCHAR(10) GENERATED ALWAYS AS (RIGHT(REGEXP_REPLACE(telefone, '[^0-9]', ''), 10)) STORED"
        );
        temColuna = true;
        console.log('1. Coluna leads.telefone_fim10 criada.');
      } catch (err) {
        console.warn('1. AVISO: nao foi possivel criar leads.telefone_fim10 (' + err.message + '). O sistema segue com a busca antiga (mais lenta).');
      }
    } else {
      console.log('1. Coluna leads.telefone_fim10 ja existe.');
    }

    const indices = [
      ['idx_leads_empresa_fim10', '(empresa_id, telefone_fim10)', temColuna],
      ['idx_leads_empresa_criado', '(empresa_id, criado_em)', true],
      ['idx_leads_empresa_status', '(empresa_id, status)', true],
    ];
    let n = 2;
    for (const [nome, cols, aplicavel] of indices) {
      if (!aplicavel) { console.log(`${n++}. Indice ${nome} pulado (depende da coluna).`); continue; }
      const [[idx]] = await conn.execute(
        "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads' AND INDEX_NAME = ?",
        [nome]
      );
      if (idx.cnt) { console.log(`${n++}. Indice ${nome} ja existe.`); continue; }
      await conn.query(`CREATE INDEX ${nome} ON leads ${cols}`);
      console.log(`${n++}. Indice ${nome} criado.`);
    }

    console.log('\n=== Migration 050 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
