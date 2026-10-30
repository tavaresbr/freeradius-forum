// Alertas tecnicos: config (monitoramento + aviso aos clientes) e mensagens. Funcoes puras, sem banco.
const MAX_MSG = 1000;
const MIN_APOS = 5;
const MAX_APOS = 240;

const MSG_QUEDA = "Olá, {{nome}}! Identificamos uma instabilidade em {{equipamento}} desde {{inicio}}. Nossa equipe já está trabalhando para normalizar o serviço. Obrigado pela compreensão.";
const MSG_VOLTA = "Olá, {{nome}}! A conexão em {{equipamento}} foi normalizada. Obrigado pela paciência.";

const padrao = () => ({
  ativo: false, // monitora os equipamentos e registra no feed (nao envia nada)
  avisar_clientes_auto: false,
  apos_minutos: 15,
  avisar_volta: true,
  mensagem_queda: MSG_QUEDA,
  mensagem_volta: MSG_VOLTA,
});

function validarConfig(body) {
  const erro = (m) => Object.assign(new Error(m), { status: 400 });
  const b = body && typeof body === "object" ? body : {};
  const apos = b.apos_minutos === undefined || b.apos_minutos === "" ? 15 : Number(b.apos_minutos);
  if (!Number.isInteger(apos) || apos < MIN_APOS || apos > MAX_APOS) throw erro(`Avisar após: entre ${MIN_APOS} e ${MAX_APOS} minutos`);
  const msg = (v, padraoTxt, nome) => {
    const t = typeof v === "string" ? v.trim() : "";
    if (t.length > MAX_MSG) throw erro(`${nome}: máximo ${MAX_MSG} caracteres`);
    return t || padraoTxt;
  };
  const cfg = {
    ativo: !!b.ativo,
    avisar_clientes_auto: !!b.avisar_clientes_auto,
    apos_minutos: apos,
    avisar_volta: b.avisar_volta !== false,
    mensagem_queda: msg(b.mensagem_queda, MSG_QUEDA, "Mensagem de queda"),
    mensagem_volta: msg(b.mensagem_volta, MSG_VOLTA, "Mensagem de volta"),
  };
  if (cfg.avisar_clientes_auto && !cfg.ativo) throw erro("Ligue o monitoramento para avisar os clientes automaticamente");
  return cfg;
}

const mesclarComPadrao = (salva) => ({ ...padrao(), ...(salva && typeof salva === "object" ? salva : {}) });

const TIPOS = ["equipamento_offline", "equipamento_online", "whatsapp_desconectado", "manual"];

module.exports = { MSG_QUEDA, MSG_VOLTA, TIPOS, padrao, validarConfig, mesclarComPadrao };
