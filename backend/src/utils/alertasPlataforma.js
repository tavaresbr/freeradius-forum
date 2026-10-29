// Alertas do painel Super Admin: empresas com equipamento offline, sem conexao ha dias ou WhatsApp desconectado.
// Regras puras (sem banco/rede) para poder testar; a coleta dos dados fica em empresaController.alertasEmpresas.

const DIA_MS = 24 * 60 * 60 * 1000;
const STATUS_VALIDO_MIN = 30; // estado de equipamento mais velho que isso nao e' confiavel (job parado/alerta desligado)
const DIAS_PADRAO = 3;

function diasSemConexaoValido(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : DIAS_PADRAO;
}

/**
 * @param {object} p
 * @param {Array} p.empresas  linhas de empresas (id, nome, slug, ativo, criado_em, total_mikrotiks)
 * @param {Map} p.offline     empresa_id -> { offline, total, verificado_em }
 * @param {Map} p.ultimaConexao empresa_id -> Date|string|null (inicio da sessao mais recente)
 * @param {Map} p.whatsapp    empresa_id -> true|false (so empresas com WhatsApp configurado)
 * @param {number} p.dias     limite de "sem conexao"
 * @param {Date} p.agora
 * @returns {Array<{empresa_id, alertas: Array<{tipo, nivel, mensagem}>}>} so empresas com ao menos 1 alerta
 */
function montarAlertas({ empresas, offline, ultimaConexao, whatsapp, dias, agora = new Date() }) {
  const limite = diasSemConexaoValido(dias);
  const saida = [];
  for (const e of empresas) {
    if (!e.ativo) continue;
    const alertas = [];

    const eq = offline.get(e.id);
    if (eq && eq.offline > 0 && eq.verificado_em) {
      const idade = (agora.getTime() - new Date(eq.verificado_em).getTime()) / 60000;
      if (idade <= STATUS_VALIDO_MIN) {
        alertas.push({
          tipo: 'equipamento_offline',
          nivel: eq.offline >= eq.total ? 'critico' : 'aviso',
          mensagem: `${eq.offline} de ${eq.total} equipamento${eq.total === 1 ? '' : 's'} offline`,
        });
      }
    }

    if ((e.total_mikrotiks || 0) > 0) {
      const ultima = ultimaConexao.get(e.id);
      const criada = e.criado_em ? new Date(e.criado_em).getTime() : agora.getTime();
      const idadeEmpresa = (agora.getTime() - criada) / DIA_MS;
      if (ultima) {
        const dd = Math.floor((agora.getTime() - new Date(ultima).getTime()) / DIA_MS);
        if (dd >= limite) {
          alertas.push({ tipo: 'sem_conexao', nivel: 'aviso', mensagem: `Sem conexões há ${dd} dias` });
        }
      } else if (idadeEmpresa >= limite) {
        alertas.push({ tipo: 'sem_conexao', nivel: 'aviso', mensagem: 'Nenhuma conexão registrada' });
      }
    }

    if (whatsapp.get(e.id) === false) {
      alertas.push({ tipo: 'whatsapp_desconectado', nivel: 'aviso', mensagem: 'WhatsApp desconectado' });
    }

    if (alertas.length) saida.push({ empresa_id: e.id, alertas });
  }
  return saida;
}

module.exports = { montarAlertas, diasSemConexaoValido, STATUS_VALIDO_MIN, DIAS_PADRAO };
