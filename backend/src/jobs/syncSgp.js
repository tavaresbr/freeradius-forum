/**
 * Job: importacao automatica de clientes do SGP.
 *
 * Para cada empresa com config SGP e sync_auto ligado, importa de novo quando
 * passou sync_horas desde a ultima execucao (ultima_sync.em, tentativa com ou sem
 * sucesso, para um SGP fora do ar nao ser martelado a cada hora). Usa a mesma
 * regra da importacao manual: cliente existente so tem campos vazios preenchidos.
 *
 * Usage: node src/jobs/syncSgp.js  (ou importar e chamar syncSgp() do cron)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const db = require('../../db');
const sgp = require('../utils/sgpClient');
const { sugerirMapeamento, processarImportacao } = require('../utils/importCadastros');

let rodando = false;

async function sincronizarEmpresa(empresaId, cfg) {
  const em = new Date().toISOString();
  try {
    if (!cfg.url || !cfg.app || !cfg.token || !sgp.urlPermitida(cfg.url)) throw new sgp.SgpError('Config do SGP incompleta');
    const linhas = await sgp.buscarTodos(cfg);
    const mapeamento = sugerirMapeamento([...new Set(linhas.flatMap((l) => Object.keys(l)))]);
    if (!mapeamento.nome || !(mapeamento.cpf || mapeamento.cnpj)) throw new sgp.SgpError('Nome e CPF/CNPJ nao identificados nos dados do SGP');
    const r = await processarImportacao(linhas, mapeamento, empresaId, { sistemaOrigem: 'sgp', dryRun: false });
    await sgp.registrarSync(empresaId, { em, ok: true, total: r.total, criados: r.criados, atualizados: r.atualizados, erros: r.erros.length });
    console.log(`[syncSgp] empresa ${empresaId}: ${r.total} lidos, ${r.criados} criados, ${r.atualizados} completados, ${r.erros.length} erros`);
  } catch (err) {
    const motivo = err instanceof sgp.SgpError ? err.message : 'Falha ao consultar o SGP';
    console.error(`[syncSgp] empresa ${empresaId}: ${err.message}`);
    await sgp.registrarSync(empresaId, { em, ok: false, erro: motivo }).catch(() => {});
  }
}

async function syncSgp() {
  if (rodando) return;
  rodando = true;
  try {
    const [rows] = await db.execute("SELECT empresa_id FROM empresa_configs WHERE config_type = 'sgp'");
    for (const { empresa_id } of rows) {
      const cfg = await sgp.carregarConfig(empresa_id);
      if (!cfg || !cfg.sync_auto) continue;
      const ultima = cfg.ultima_sync && Date.parse(cfg.ultima_sync.em);
      const prazoMs = sgp.horasValidas(cfg.sync_horas) * 3600 * 1000;
      if (ultima && Date.now() - ultima < prazoMs - 60 * 1000) continue;
      await sincronizarEmpresa(empresa_id, cfg);
    }
  } finally {
    rodando = false;
  }
}

module.exports = syncSgp;

if (require.main === module) {
  syncSgp().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
