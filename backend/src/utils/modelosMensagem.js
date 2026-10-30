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
];

module.exports = { CATEGORIAS, categoriaValida, MODELOS_PADRAO };
