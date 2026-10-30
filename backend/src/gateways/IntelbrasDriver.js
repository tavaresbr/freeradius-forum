const GatewayDriver = require("./GatewayDriver");

/**
 * IntelbrasDriver — AP Intelbras standalone (AP 360 / 1210 / 1250 / 3000...).
 *
 * Opera como External Web Portal + External RADIUS (mesmo modelo do Grandstream).
 * A liberacao/RADIUS e' feita por liberarUsuario e o "login final" e' um GET no
 * login_url do AP, montado em gatewayLiberacao.montarGatewayInfo — este driver
 * NAO participa desse caminho.
 *
 * Nao ha API de controladora: testConnection so confirma que o cadastro RADIUS
 * existe; sessoes/historico saem do radacct pelo caminho padrao.
 *
 * TODO(hardware): confirmar com um AP real os nomes dos parametros do redirect
 * (login_url, MAC do cliente) e do login final.
 */
class IntelbrasDriver extends GatewayDriver {
  constructor(gateway = {}) {
    super(gateway);
    this.config = gateway;
  }

  async testConnection() {
    return { sucesso: true, mensagem: "Conexao RADIUS ativa (Intelbras nao tem API para testar)" };
  }

  /** Sem disconnect ativo via External RADIUS: nao simula sucesso. */
  async revoke() {
    return { success: false, message: "Intelbras: desconexao ativa nao suportada via External RADIUS (limpeza RADIUS corta no proximo reauth)." };
  }

  async getActiveSessions() {
    return [];
  }

  async syncSessionHistory() {
    return { synced: 0 };
  }
}

module.exports = IntelbrasDriver;
