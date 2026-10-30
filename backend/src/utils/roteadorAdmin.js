/**
 * Credencial padrao do roteador (RouterOS) para o script de instalacao rapida e para
 * pre-preencher o cadastro do equipamento. Vem do .env do servidor (nunca do git):
 *   ROUTER_ADMIN_USER (default "admin") e ROUTER_ADMIN_PASSWORD (vazio = nao configura).
 */
function credenciaisRoteador(env = process.env) {
  const usuario = String(env.ROUTER_ADMIN_USER || "admin").trim() || "admin";
  const senha = env.ROUTER_ADMIN_PASSWORD ? String(env.ROUTER_ADMIN_PASSWORD) : null;
  return { usuario, senha };
}

// Texto seguro dentro de aspas do RouterOS: aspas, \, $, [, ], ? viram escape hex (\22 \5C \24 \5B \5D \3F).
function emStringRouterOS(texto) {
  return String(texto).replace(/["\\$\[\]?]/g, (c) => "\\" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
}

// Linhas RouterOS que definem a conta usada pelo painel. Com "admin" so troca a senha (comportamento
// original). Com outro nome cria a conta se faltar (idempotente), limitada a rede da VPN; o admin
// nao e' desativado (o dono ainda usa o Winbox).
function linhasUsuarioRoteador(usuario, senha, rede = "10.8.0.0/24") {
  const u = emStringRouterOS(usuario);
  const p = emStringRouterOS(senha);
  if (usuario === "admin") return [`/user set [find name="${u}"] password="${p}"`];
  return [
    `:if ([:len [/user find name="${u}"]]=0) do={ /user add name="${u}" group=full address=${rede} password="${p}" comment="Painel Hotspot" } else={ /user set [find name="${u}"] password="${p}" address=${rede} }`,
    `:put "AVISO: troque a senha da conta admin (/user set admin password=...); o painel usa a conta ${u}."`,
  ];
}

module.exports = { credenciaisRoteador, emStringRouterOS, linhasUsuarioRoteador };
