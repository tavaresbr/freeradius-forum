// Rate limiters compartilhados (express-rate-limit v8).
// Protegem endpoints publicos sensiveis contra brute-force / abuso.
// Atras do nginx: server.js define app.set('trust proxy', 1) pra keying por IP real.
const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const jsonHandler = (mensagem) => (req, res /*, next, options */) => {
  res.status(429).json({ error: mensagem });
};

// Logins admin/portal: agressivo (brute-force de credenciais).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,      // 15 min
  limit: 30,                     // 30 FALHAS de login por IP por janela
  skipSuccessfulRequests: true,  // login OK (2xx) nao consome cota: quem acerta a senha nunca trava
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Muitas tentativas de login. Tente novamente em alguns minutos.'),
});

// Falhas de login por E-MAIL + IP (alem do teto por IP): freia a adivinhacao de senha de uma conta
// especifica sem permitir que um terceiro tranque o dono (a chave inclui o IP de quem erra).
const loginPorContaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    return `${ipKeyGenerator(req.ip)}|${crypto.createHash('sha256').update(email).digest('hex').slice(0, 24)}`;
  },
  handler: jsonHandler('Muitas tentativas de login para esta conta. Tente novamente em alguns minutos.'),
});

// Cartao no hotspot (POST /api/pagamentos/gerar-cartao): endpoint publico que cobra na conta MP da empresa.
// Sem teto proprio serve para "testar cartoes" em massa. Conta so as FALHAS (recusa/erro = 4xx) por IP e por
// aparelho (MAC) / CPF informado; a compra aprovada nao consome cota.
const hashCurto = (v) => crypto.createHash('sha256').update(String(v || '').toLowerCase()).digest('hex').slice(0, 24);
const falhasCartao = (limit, keyGenerator) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  handler: jsonHandler('Muitas tentativas de pagamento com cartao. Aguarde alguns minutos ou pague com PIX.'),
});
const cartaoHotspotLimiters = [
  falhasCartao(10, (req) => `ip:${ipKeyGenerator(req.ip)}`),
  falhasCartao(5, (req) => `dev:${hashCurto(req.body?.mac)}|${hashCurto(req.body?.cpf || req.body?.identification_number)}`),
];

// Registro de empresa: evita criacao em massa.
const registroLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Muitas solicitacoes de registro. Tente novamente mais tarde.'),
});

// Consulta de CNPJ (GET /api/cnpj/:cnpj): publica, chama API externa; teto por IP.
const cnpjLookupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Muitas consultas de CNPJ. Tente novamente mais tarde.'),
});

// Consulta de CEP (GET /api/cep/:cep): publica, chama API externa; teto por IP.
const cepLookupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Muitas consultas de CEP. Tente novamente mais tarde.'),
});

// Pedido de contratacao do site (POST /api/site/pedido): evita spam de leads.
const sitePedidoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Muitos pedidos enviados. Tente novamente mais tarde.'),
});

// Promocoes por WhatsApp (criar/iniciar/teste): poucas por hora e por IP; o ritmo real de envio e' do job.
const promocaoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Muitas operações de promoção. Tente novamente mais tarde.'),
});

// Cartao da assinatura SaaS: limita tentativas (card testing) por IP.
const cartaoAssinaturaLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Muitas tentativas de pagamento com cartão. Tente novamente mais tarde.'),
});

// Endpoints publicos do captive portal (pagamentos, acesso temporario, etc).
// Limite mais folgado por causa de polling de status, mas ainda limita abuso/enumeracao.
const publicApiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Muitas requisicoes. Aguarde alguns instantes.'),
});

// Metricas do pre-portal (view/clique de campanha): publico e disparado pelo navegador de cada cliente,
// que no hotspot divide o IP do estabelecimento — limite folgado, so contem abuso grosseiro.
const campanhaMetricaLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Muitas requisicoes. Aguarde alguns instantes.'),
});

// Check de atualizacao dos alunos (valida email Hotmart) - anti-enumeracao.
const updateCheckLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 min
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Muitas verificacoes de atualizacao. Aguarde.'),
});

// Busca de cadastro por CPF (POST /api/lgpd/consulta-cpf): protege dados de terceiros.
// Tres travas empilhadas (cada busca bem-sucedida usa 2 chamadas: buscar + confirmar):
//  - por dispositivo (IP + MAC do corpo): 10 chamadas/hora;
//  - por CPF consultado: 10 chamadas/hora, para barrar tentativa de adivinhar a data de nascimento;
//  - por IP: 120 chamadas/hora, teto de seguranca (hotspots dividem o IP publico, por isso folgado).
// Memoria do processo: zera se o PM2 reiniciar.
const macDoCorpo = (req) => String((req.body && req.body.mac) || '').toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 12);
const cpfDoCorpo = (req) => String((req.body && req.body.cpf) || '').replace(/\D/g, '').slice(0, 11);
const msgCpf = 'Muitas tentativas de busca. Tente novamente mais tarde.';
// So as buscas que NAO acharam (palpites de data) consomem as travas por dispositivo e por CPF: quem
// acerta a data ja tem o segundo fator, e assim o titular nao se tranca sozinho ao consultar/confirmar
// (cada busca bem-sucedida usa 2 chamadas). O controller marca res.locals.consultaEncontrada.
const buscaAchou = (req, res) => res.locals.consultaEncontrada === true;

const cpfLookupPorDispositivo = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${macDoCorpo(req)}`,
  skipSuccessfulRequests: true,
  requestWasSuccessful: buscaAchou,
  handler: jsonHandler(msgCpf),
});

const cpfLookupPorCpf = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Guarda so um hash do CPF na memoria do limitador
  keyGenerator: (req) => {
    const cpf = cpfDoCorpo(req);
    return cpf ? 'cpf:' + crypto.createHash('sha256').update(cpf).digest('hex') : ipKeyGenerator(req.ip);
  },
  skipSuccessfulRequests: true,
  requestWasSuccessful: buscaAchou,
  handler: jsonHandler(msgCpf),
});

const cpfLookupPorIp = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler(msgCpf),
});

const cpfLookupLimiters = [cpfLookupPorIp, cpfLookupPorDispositivo, cpfLookupPorCpf];

module.exports = { cartaoHotspotLimiters, loginLimiter, loginPorContaLimiter, registroLimiter, cnpjLookupLimiter, cepLookupLimiter, sitePedidoLimiter, cartaoAssinaturaLimiter, publicApiLimiter, campanhaMetricaLimiter, promocaoLimiter, updateCheckLimiter, cpfLookupLimiters };
