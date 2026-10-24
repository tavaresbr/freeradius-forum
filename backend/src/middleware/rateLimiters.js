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

// Registro de empresa: evita criacao em massa.
const registroLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Muitas solicitacoes de registro. Tente novamente mais tarde.'),
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

const cpfLookupPorDispositivo = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${macDoCorpo(req)}`,
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

module.exports = { loginLimiter, registroLimiter, publicApiLimiter, updateCheckLimiter, cpfLookupLimiters };
