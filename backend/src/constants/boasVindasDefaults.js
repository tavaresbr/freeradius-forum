// Mensagens padrao de boas-vindas da plataforma (editaveis no Super Admin). Variaveis: {{nome}} (1o nome),
// {{empresa}}, {{plano}}, {{trial_ate}}, {{link_painel}}.
const MENSAGEM_BOAS_VINDAS =
  "Olá, {{nome}}! 👋 Bem-vindo(a) à Apex Telecom.\n\n" +
  "Sua conta *{{empresa}}* já está criada e seu teste do plano *{{plano}}* vai até {{trial_ate}}.\n\n" +
  "Acesse o painel: {{link_painel}}\n\n" +
  "Precisa de ajuda para configurar o primeiro equipamento? É só responder esta mensagem.";

const MENSAGEM_LEMBRETE_ATIVACAO =
  "Olá, {{nome}}! Notamos que a conta *{{empresa}}* ainda não tem nenhum equipamento cadastrado. " +
  "Quer ajuda para conectar o primeiro? Responda esta mensagem que a gente te ajuda. Painel: {{link_painel}}";

const CONFIG_PADRAO = {
  ativo: true,
  mensagem: MENSAGEM_BOAS_VINDAS,
  lembrete_ativacao: { ativo: false, mensagem: MENSAGEM_LEMBRETE_ATIVACAO },
};

module.exports = { MENSAGEM_BOAS_VINDAS, MENSAGEM_LEMBRETE_ATIVACAO, CONFIG_PADRAO };
