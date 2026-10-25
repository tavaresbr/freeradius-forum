/**
 * Job (cron horario): assinaturas SaaS.
 *  1. trial/ativa com periodo passado -> status 'vencida' (o middleware ja bloqueia pela data;
 *     isto mantem o status coerente para telas/relatorios)
 *  2. avisos por WhatsApp (instancia da plataforma = SITE_EMPRESA_ID): D-3 e no vencimento,
 *     1 vez cada (assinaturas.ultimo_aviso), sem bloquear o job se o envio falhar.
 *
 * Usage: node src/jobs/verificaAssinaturas.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const db = require('../../db');
const { invalidar, tabelaInexistente } = require('../utils/assinatura');

const FIM = "IF(a.status = 'trial', a.trial_ate, a.vence_em)";

function mensagem(tipo, nome, dataFim) {
  const data = new Date(dataFim).toLocaleDateString('pt-BR');
  if (tipo === 'd3') return `Olá, ${nome}! Sua assinatura do sistema vence em ${data}. Renove pelo painel (menu Assinatura) para não perder o acesso.`;
  return `Olá, ${nome}! Sua assinatura venceu em ${data}. Renove pelo painel (menu Assinatura) para continuar usando o sistema.`;
}

async function avisar(tipo, empresaPlataforma) {
  const cond = tipo === 'd3'
    ? `a.status IN ('trial','ativa') AND ${FIM} > NOW() AND ${FIM} <= DATE_ADD(NOW(), INTERVAL 3 DAY) AND a.ultimo_aviso IS NULL`
    : `a.status = 'vencida' AND (a.ultimo_aviso IS NULL OR a.ultimo_aviso = 'd3')`;
  const [rows] = await db.query(
    `SELECT a.id, e.nome, e.telefone, ${FIM} AS fim
       FROM assinaturas a JOIN empresas e ON e.id = a.empresa_id WHERE ${cond}`
  );
  if (!rows.length) return;
  const { enviarMensagemDireta } = require('../controllers/whatsappController');
  for (const r of rows) {
    try {
      if (r.telefone) await enviarMensagemDireta(r.telefone, mensagem(tipo, r.nome, r.fim), empresaPlataforma);
    } catch (err) {
      console.error(`[verificaAssinaturas] aviso ${tipo} falhou (assinatura ${r.id}):`, err.message);
    }
    await db.query('UPDATE assinaturas SET ultimo_aviso = ? WHERE id = ?', [tipo, r.id]);
  }
}

async function verificaAssinaturas() {
  try {
    const [r] = await db.query(
      `UPDATE assinaturas a SET a.status = 'vencida'
        WHERE a.status IN ('trial','ativa') AND ${FIM} IS NOT NULL AND ${FIM} < NOW()`
    );
    if (r.affectedRows) {
      invalidar();
      console.log(`[verificaAssinaturas] ${r.affectedRows} assinatura(s) marcada(s) como vencida(s).`);
    }
    const plataforma = parseInt(process.env.SITE_EMPRESA_ID, 10) || 1;
    await avisar('d3', plataforma);
    await avisar('d0', plataforma);
  } catch (err) {
    if (!tabelaInexistente(err)) console.error('[verificaAssinaturas] erro:', err.message);
  }
}

module.exports = verificaAssinaturas;

if (require.main === module) {
  verificaAssinaturas().then(() => process.exit(0));
}
