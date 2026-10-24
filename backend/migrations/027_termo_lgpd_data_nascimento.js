require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 027: aviso de uso da data de nascimento no termo LGPD dos portais existentes.
 *
 * Atualiza portais.configuracoes.texto_lgpd SOMENTE onde o texto ainda e' o default
 * antigo. Textos customizados pela empresa nao sao tocados (o admin edita no PortalEditor).
 *
 * Idempotente: depois de rodar, nenhum portal mantem o texto antigo.
 */
const TEXTO_ANTIGO = "Aceito os termos da Lei Geral de Proteção de Dados (LGPD) e autorizo o tratamento dos meus dados pessoais. *";
const TEXTO_NOVO = "Aceito os termos da Lei Geral de Proteção de Dados (LGPD) e autorizo o tratamento dos meus dados pessoais, incluindo a data de nascimento, que será utilizada para confirmar minha identidade e recuperar meu cadastro. *";

async function migrate() {
  try {
    console.log('=== Migration 027: termo LGPD com data de nascimento ===\n');

    const [portais] = await db.execute("SELECT id, configuracoes FROM portais WHERE configuracoes IS NOT NULL");
    let atualizados = 0;
    let customizados = 0;

    for (const p of portais) {
      let cfg;
      try {
        cfg = typeof p.configuracoes === 'string' ? JSON.parse(p.configuracoes) : p.configuracoes;
      } catch (e) {
        continue;
      }
      if (!cfg || typeof cfg.texto_lgpd !== 'string') continue;

      if (cfg.texto_lgpd === TEXTO_ANTIGO) {
        cfg.texto_lgpd = TEXTO_NOVO;
        await db.execute("UPDATE portais SET configuracoes = ? WHERE id = ?", [JSON.stringify(cfg), p.id]);
        atualizados++;
      } else if (cfg.texto_lgpd !== TEXTO_NOVO) {
        customizados++;
        console.log(`   -> portal ${p.id}: texto customizado mantido (revisar no editor)`);
      }
    }

    console.log(`\n   ${atualizados} portal(is) atualizado(s), ${customizados} customizado(s) mantido(s)`);
    console.log('\n=== Migration 027 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration 027:', err);
    throw err;
  } finally {
    process.exit(0);
  }
}

migrate();
