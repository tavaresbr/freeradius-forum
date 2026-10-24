require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 028: aviso de uso da data de nascimento nos termos LGPD CUSTOMIZADOS.
 *
 * Complementa a 027 (que so trocou o texto default): nos portais com texto proprio,
 * acrescenta uma frase ao final de portais.configuracoes.texto_lgpd, preservando o
 * texto escrito pela empresa (e o "*" de campo obrigatorio, que continua no fim).
 *
 * Idempotente: pula texto que ja menciona "data de nascimento".
 */
const AVISO = "Sua data de nascimento será utilizada para confirmar sua identidade e recuperar seu cadastro.";

function acrescentarAviso(texto) {
  const t = texto.trimEnd();
  const asterisco = t.endsWith("*");
  const base = (asterisco ? t.slice(0, -1) : t).trimEnd();
  const pontuado = /[.!?]$/.test(base) ? base : `${base}.`;
  return `${pontuado} ${AVISO}${asterisco ? " *" : ""}`;
}

async function migrate() {
  try {
    console.log('=== Migration 028: aviso da data de nascimento em termos LGPD customizados ===\n');

    const [portais] = await db.execute("SELECT id, configuracoes FROM portais WHERE configuracoes IS NOT NULL");
    let atualizados = 0;

    for (const p of portais) {
      let cfg;
      try {
        cfg = typeof p.configuracoes === 'string' ? JSON.parse(p.configuracoes) : p.configuracoes;
      } catch (e) {
        continue;
      }
      if (!cfg || typeof cfg.texto_lgpd !== 'string' || !cfg.texto_lgpd.trim()) continue;
      if (/data de nascimento/i.test(cfg.texto_lgpd)) continue;

      cfg.texto_lgpd = acrescentarAviso(cfg.texto_lgpd);
      await db.execute("UPDATE portais SET configuracoes = ? WHERE id = ?", [JSON.stringify(cfg), p.id]);
      atualizados++;
      console.log(`   -> portal ${p.id}: aviso acrescentado`);
    }

    console.log(`\n   ${atualizados} portal(is) atualizado(s)`);
    console.log('\n=== Migration 028 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration 028:', err);
    throw err;
  } finally {
    process.exit(0);
  }
}

migrate();
