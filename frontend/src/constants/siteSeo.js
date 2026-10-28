// Fonte unica do conteudo institucional da landing (`/`). Usado pela pagina (ApexHome.jsx), pelo hook de SEO e
// pelo plugin do Vite (vitePluginSeo.js), que gera meta tags, JSON-LD, robots.txt, sitemap.xml e llms.txt no build.
// Dados puros (sem JSX): precisa rodar no Node. So afirmacoes verdadeiras para o produto; nada de numeros inventados.

export const SITE_URL = "https://apextelecom.com.br";
export const NOME = "Apex Telecom";
export const TITULO = `${NOME} | Sistema de Wi-Fi Hotspot com captive portal para provedores`;
export const DESCRICAO =
  "Sistema de Wi-Fi Hotspot com captive portal, pagamento por PIX e cartão, WhatsApp automático, vários equipamentos (MikroTik, Omada, UniFi, Grandstream) e conformidade com LGPD e Marco Civil. Teste grátis por 7 dias.";
export const RESUMO =
  "A Apex Telecom é um sistema web para provedores de internet e estabelecimentos venderem e controlarem acesso Wi-Fi. Reúne captive portal, cadastro de clientes, pagamento por PIX e cartão, vouchers, mensagens por WhatsApp e registros de conexão (Marco Civil) e consentimento (LGPD) em um só painel.";

export const WHATSAPP = "5593991935695";
export const TELEFONE = "(93) 99193-5695";
export const EMAIL = "adm@tavarestelecom.com.br";
export const IDIOMA = "pt-BR";

export const EQUIPAMENTOS = ["MikroTik", "TP-Link Omada", "UniFi", "Grandstream (GWN)"];

export const COMO_FUNCIONA = [
  ["O cliente conecta ao Wi-Fi", "O roteador ou controlador redireciona o aparelho para o portal do seu negócio."],
  ["Ele se cadastra ou paga", "O portal pede o cadastro com aceite LGPD, um voucher ou o pagamento por PIX ou cartão."],
  ["O acesso é liberado sozinho", "Aprovado o cadastro ou o pagamento, a internet é liberada na hora e as credenciais podem ir por WhatsApp."],
];

// chave = nome do icone em ApexHome.jsx
export const RECURSOS = [
  { chave: "portais", titulo: "Portais de acesso", texto: "LGPD, cadastro de lead, venda de planos e login por usuário e senha, com editor visual." },
  { chave: "pagamentos", titulo: "PIX e cartão", texto: "Mercado Pago e EFI, liberação automática do acesso e PIX com acesso grátis de teste." },
  { chave: "whatsapp", titulo: "WhatsApp automático", texto: "Mensagem com as credenciais assim que o acesso é liberado, com texto que você edita." },
  { chave: "conformidade", titulo: "LGPD e Marco Civil", texto: "Aceite com o termo gravado e logs de conexão com exportação em CSV." },
  { chave: "equipamentos", titulo: "Vários equipamentos", texto: "MikroTik, Omada, UniFi e Grandstream no mesmo painel, com script de instalação rápida e VPN WireGuard." },
  { chave: "clientes", titulo: "Clientes e sessões", texto: "Cadastro completo, importação por planilha ou SGP, sessões ativas com tempo restante e desconexão remota." },
  { chave: "campanhas", titulo: "Campanhas", texto: "Imagens e vídeos antes do portal para divulgar suas ofertas." },
  { chave: "equipe", titulo: "Equipe e acesso", texto: "Perfis de Administrador e Usuário Padrão, painel pelo navegador e pelo celular." },
];

// Perguntas em linguagem de busca, com resposta direta logo na primeira frase (AEO).
export const FAQ = [
  [
    "O que é um sistema de Wi-Fi hotspot com captive portal?",
    "É o sistema que mostra uma página de entrada (o captive portal) quando a pessoa conecta ao Wi-Fi, e só libera a internet depois do cadastro, do aceite dos termos, de um voucher ou do pagamento. A Apex Telecom reúne essa página, o controle de acesso e os relatórios em um painel web.",
  ],
  [
    "Como o cliente paga e conecta ao Wi-Fi?",
    "Ele escolhe um plano no portal e paga por PIX ou cartão (Mercado Pago ou EFI). Quando o pagamento é aprovado, o acesso é liberado automaticamente e as credenciais podem ser enviadas por WhatsApp. O PIX também pode liberar alguns minutos de acesso grátis enquanto o cliente paga.",
  ],
  [
    "Quais equipamentos funcionam com a Apex Telecom?",
    "MikroTik, TP-Link Omada, UniFi e Grandstream (GWN). Dá para cadastrar vários equipamentos e misturar marcas no mesmo painel. Para equipamentos atrás de NAT há conexão por VPN WireGuard.",
  ],
  [
    "O sistema atende à LGPD e ao Marco Civil da Internet?",
    "Ele registra o aceite do cliente com o texto do termo e guarda os logs de conexão (usuário, MAC, IP, início e fim da sessão), com exportação em CSV. Esses registros ajudam o provedor a cumprir a LGPD e o Marco Civil; a responsabilidade legal continua sendo de quem opera a rede.",
  ],
  [
    "Como funciona o teste grátis?",
    "Você cria sua conta e usa o sistema por 7 dias, sem cartão. Depois escolhe um plano e paga por PIX ou cartão.",
  ],
  [
    "O que muda entre os planos?",
    "Muda o limite de equipamentos e de administradores. Os recursos do sistema são os mesmos nos planos pagos, e você pode trocar de plano a qualquer momento pelo menu Assinatura do painel.",
  ],
  [
    "Posso vender acesso por voucher?",
    "Sim. Você gera lotes de vouchers por plano e equipamento, imprime os cartões (com QR code) e o cliente digita o código no portal para ganhar o acesso.",
  ],
  [
    "Consigo importar meus clientes de outro sistema?",
    "Sim. A importação funciona por planilha (CSV ou Excel) ou pela integração com o SGP, e só preenche os campos que estiverem vazios no cadastro.",
  ],
  [
    "E se eu atrasar o pagamento da assinatura?",
    "Os seus clientes continuam conectando normalmente. Só o painel administrativo fica bloqueado até a renovação.",
  ],
];
