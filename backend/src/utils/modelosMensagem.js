// Modelos de mensagem do hub WhatsApp (respostas rapidas com categoria). Funcoes puras, sem banco.
const CATEGORIAS = {
  geral: "Geral",
  boas_vindas: "Boas-vindas",
  cobranca: "Cobrança e renovação",
  promocao: "Promoção",
  manutencao: "Manutenção e avisos",
};

const categoriaValida = (c) => (Object.prototype.hasOwnProperty.call(CATEGORIAS, c) ? c : "geral");

// Modelos prontos (atalho unico por empresa; "criar modelos padrao" nunca sobrescreve os existentes).
const MODELOS_PADRAO = [
  { atalho: "ola", titulo: "Boas-vindas", categoria: "boas_vindas", texto: "Olá {{nome}}! Aqui é da {{empresa}}. Como podemos ajudar?" },
  { atalho: "renovar", titulo: "Convite para renovar", categoria: "cobranca", texto: "Olá {{nome}}! Seu plano {{plano}} da {{empresa}} acabou. Para voltar a navegar, escolha um plano aqui: {{link}}" },
  { atalho: "acabando", titulo: "Tempo acabando", categoria: "cobranca", texto: "Olá {{nome}}! Seu tempo de internet acaba em cerca de {{minutos}} minutos. Para continuar conectado, escolha um plano: {{link}}" },
  { atalho: "obrigado", titulo: "Agradecimento pela compra", categoria: "boas_vindas", texto: "Olá {{nome}}! Obrigado pela compra do plano {{plano}} na {{empresa}}. Se precisar de ajuda, é só responder esta mensagem." },
  { atalho: "promo", titulo: "Promoção", categoria: "promocao", texto: "Olá {{nome}}! Temos uma oferta especial na {{empresa}} para você. Responda esta mensagem para saber mais." },
  { atalho: "manutencao", titulo: "Aviso de manutenção", categoria: "manutencao", texto: "Olá {{nome}}! Faremos uma manutenção programada na rede da {{empresa}}. Pode haver instabilidade durante esse período. Agradecemos a compreensão." },
  { atalho: "instabilidade", titulo: "Instabilidade na rede", categoria: "manutencao", texto: "Olá {{nome}}! Estamos com uma instabilidade na rede neste momento e já estamos trabalhando para resolver. Pedimos desculpas pelo transtorno." },
  // Atendimento
  { atalho: "bomdia", titulo: "Bom dia", categoria: "geral", texto: "Bom dia, {{nome}}! Aqui é da {{empresa}}. Em que posso ajudar?" },
  { atalho: "boatarde", titulo: "Boa tarde", categoria: "geral", texto: "Boa tarde, {{nome}}! Aqui é da {{empresa}}. Em que posso ajudar?" },
  { atalho: "boanoite", titulo: "Boa noite", categoria: "geral", texto: "Boa noite, {{nome}}! Aqui é da {{empresa}}. Em que posso ajudar?" },
  { atalho: "aguarde", titulo: "Aguarde um instante", categoria: "geral", texto: "Certo, {{nome}}! Um instante enquanto verifico isso para você." },
  { atalho: "verificando", titulo: "Estamos verificando", categoria: "geral", texto: "{{nome}}, estamos verificando sua solicitação e retornamos em breve. Obrigado pela paciência!" },
  { atalho: "conectar", titulo: "Como conectar ao Wi-Fi", categoria: "geral", texto: "Para conectar: 1) ative o Wi-Fi do celular e escolha a rede da {{empresa}}; 2) aguarde a página de acesso abrir sozinha; 3) faça o cadastro ou escolha seu plano. Se a página não abrir, abra o navegador e acesse qualquer site." },
  { atalho: "portalnaoabre", titulo: "Página de acesso não abre", categoria: "geral", texto: "{{nome}}, se a página de acesso não abriu: desative os dados móveis, esqueça a rede Wi-Fi, conecte de novo e abra o navegador em um endereço http (ex.: neverssl.com). Se continuar, me avise por aqui." },
  { atalho: "lento", titulo: "Internet lenta", categoria: "geral", texto: "{{nome}}, sentimos pelo incômodo! Para ajudar, pode me dizer onde você está conectado e há quanto tempo a lentidão ocorre? Vamos verificar a rede." },
  { atalho: "reconectar", titulo: "Pedir para reconectar", categoria: "geral", texto: "{{nome}}, tente desligar e ligar o Wi-Fi do aparelho e conectar novamente à rede da {{empresa}}. Se ainda não funcionar, me avise por aqui." },
  { atalho: "outroaparelho", titulo: "Acesso em outro aparelho", categoria: "geral", texto: "{{nome}}, seu acesso só pode ficar ativo em um aparelho por vez. Para usar em outro, é só refazer o acesso no novo aparelho e confirmar a troca." },
  { atalho: "tempo", titulo: "Quanto tempo resta", categoria: "geral", texto: "{{nome}}, vou conferir o seu tempo de acesso e já te respondo." },
  { atalho: "horario", titulo: "Horário de atendimento", categoria: "geral", texto: "{{nome}}, nosso atendimento por aqui funciona em horário comercial. Deixe sua mensagem que respondemos assim que possível. Obrigado pela compreensão!" },
  { atalho: "resolvido", titulo: "Atendimento resolvido", categoria: "geral", texto: "Que bom que conseguimos resolver, {{nome}}! Se precisar de algo mais, é só chamar. A {{empresa}} agradece!" },
  { atalho: "encerrar", titulo: "Encerrar atendimento", categoria: "geral", texto: "{{nome}}, vou encerrar este atendimento por enquanto. Se precisar, é só responder esta mensagem. Obrigado por falar com a {{empresa}}!" },
  { atalho: "desculpa", titulo: "Pedido de desculpas", categoria: "geral", texto: "{{nome}}, pedimos desculpas pelo transtorno. Estamos trabalhando para resolver o mais rápido possível." },
  // Boas-vindas
  { atalho: "bemvindo", titulo: "Boas-vindas ao Wi-Fi", categoria: "boas_vindas", texto: "Seja bem-vindo(a) à rede da {{empresa}}, {{nome}}! Qualquer dúvida sobre sua conexão, é só responder por aqui." },
  { atalho: "cadastro", titulo: "Cadastro concluído", categoria: "boas_vindas", texto: "{{nome}}, seu cadastro na {{empresa}} foi concluído com sucesso. Bom proveito da conexão!" },
  { atalho: "avaliar", titulo: "Pedir avaliação", categoria: "boas_vindas", texto: "{{nome}}, como foi sua experiência com a {{empresa}}? Responda com uma nota de 1 a 5. Sua opinião ajuda a melhorar!" },
  // Cobrança e renovação
  { atalho: "planos", titulo: "Enviar planos", categoria: "cobranca", texto: "{{nome}}, veja os planos disponíveis da {{empresa}} e escolha o melhor para você: {{link}}" },
  { atalho: "pagamento", titulo: "Pagamento confirmado", categoria: "cobranca", texto: "{{nome}}, recebemos seu pagamento do plano {{plano}}. Seu acesso já está liberado. Obrigado!" },
  { atalho: "pagamentopendente", titulo: "Pagamento pendente", categoria: "cobranca", texto: "{{nome}}, ainda não identificamos o pagamento do seu plano. Se já pagou, aguarde alguns minutos; se não, conclua por aqui: {{link}}" },
  { atalho: "vencimento", titulo: "Plano perto de vencer", categoria: "cobranca", texto: "{{nome}}, seu plano {{plano}} está perto de vencer. Renove agora e continue conectado: {{link}}" },
  { atalho: "vencido", titulo: "Plano vencido", categoria: "cobranca", texto: "{{nome}}, seu plano {{plano}} venceu. Renove para voltar a navegar: {{link}}" },
  { atalho: "voltou", titulo: "Sentimos sua falta", categoria: "cobranca", texto: "{{nome}}, faz um tempo que você não se conecta à {{empresa}}. Que tal voltar? Veja nossos planos: {{link}}" },
  { atalho: "comprovante", titulo: "Pedir comprovante", categoria: "cobranca", texto: "{{nome}}, pode me enviar o comprovante do pagamento por aqui? Assim conferimos e liberamos seu acesso." },
  // Promoção
  { atalho: "desconto", titulo: "Cupom de desconto", categoria: "promocao", texto: "{{nome}}, temos um cupom de desconto para você na {{empresa}}! Aproveite na próxima compra: {{link}}" },
  { atalho: "indicacao", titulo: "Convite de indicação", categoria: "promocao", texto: "{{nome}}, indique a {{empresa}} para um amigo e ganhe desconto quando ele comprar o primeiro plano. Peça seu código por aqui!" },
  { atalho: "novidade", titulo: "Novidade", categoria: "promocao", texto: "{{nome}}, temos novidades na {{empresa}}! Responda esta mensagem para saber mais." },
  // Manutenção e avisos
  { atalho: "voltoutudo", titulo: "Rede normalizada", categoria: "manutencao", texto: "{{nome}}, a rede da {{empresa}} já foi normalizada. Obrigado pela paciência!" },
  { atalho: "manutencaoconcluida", titulo: "Manutenção concluída", categoria: "manutencao", texto: "{{nome}}, a manutenção na rede da {{empresa}} foi concluída. Se notar qualquer problema, nos avise por aqui." },
  { atalho: "equipamento", titulo: "Equipamento fora do ar", categoria: "manutencao", texto: "{{nome}}, o ponto de acesso em que você costuma se conectar está temporariamente fora do ar. Já estamos agindo para restabelecer." },
];

module.exports = { CATEGORIAS, categoriaValida, MODELOS_PADRAO };
