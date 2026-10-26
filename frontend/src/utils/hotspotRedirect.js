/**
 * Redireciona o cliente para o "login final" do gateway apos a liberacao.
 *
 * O backend devolve `gateway_info` nas respostas de liberacao dizendo qual
 * vendor esta por tras e o que o navegador precisa fazer:
 *
 *   - MikroTik (ou gateway_info ausente — fluxo legado):
 *       GET http://{gateway}/login?username&password  (hotspot RouterOS)
 *   - Omada External RADIUS (gateway_info.browserauth presente):
 *       form-POST em {scheme}://{target}:{targetPort}/portal/radius/browserauth
 *       com o contexto do redirect + username/password. O controller valida no
 *       FreeRADIUS (doc TP-Link 13025, controller 5.3.1+).
 *   - Omada modo API / UniFi:
 *       o BACKEND ja autorizou via API (extPortal/auth / authorize-guest);
 *       aqui so redirecionamos pro destino original (redirect_url) ou pra um
 *       destino neutro pra fechar o mini-browser do captive portal.
 *
 * @param {string} gateway - Hostname/IP/URL retornado pelo backend (MikroTik)
 * @param {string} username - Username RADIUS
 * @param {string} password - Senha (geralmente igual ao username)
 * @param {number} delayMs - Delay opcional antes do redirect (ms)
 * @param {Object} [gatewayInfo] - `gateway_info` da resposta do backend
 * @param {{voltarPara?: string}} [opcoes] - `voltarPara`: URL para onde o hotspot MikroTik devolve o cliente
 *   apos o login (`dst`); usado pelo acesso gratis do PIX para voltar a tela com o codigo. Outros vendors ignoram.
 */
import { urlSegura } from "./urlSegura";

export function redirecionarHotspot(gateway, username, password, delayMs = 0, gatewayInfo = null, opcoes = {}) {
  const tipo = gatewayInfo?.tipo || "mikrotik";

  const executar = () => {
    // --- Grandstream: GET no login_url do gateway GWN (External RADIUS) ---
    // O RADIUS ja foi provisionado no backend; aqui o navegador so faz o
    // "login final" no proprio gateway, que valida no nosso FreeRADIUS.
    if (tipo === "grandstream") {
      if (gatewayInfo?.ok === false) {
        console.error("Liberacao no gateway falhou:", gatewayInfo?.erro);
      }
      const redirect = urlSegura(gatewayInfo?.redirect_url, "http://neverssl.com");
      if (gatewayInfo?.gwn_login_url && username) {
        const url = new URL(urlSegura(gatewayInfo.gwn_login_url, "http://neverssl.com"));
        url.searchParams.set("username", username);
        url.searchParams.set("password", password || username);
        url.searchParams.set("redirect", redirect);
        window.location.href = url.toString();
      } else {
        window.location.href = redirect;
      }
      return;
    }

    // --- Omada External RADIUS: navegador submete o form browserauth ---
    if (tipo === "omada" && gatewayInfo?.browserauth?.url) {
      submeterFormBrowserauth(gatewayInfo.browserauth, username, password || username);
      return;
    }

    // --- Omada modo API / UniFi: backend ja autorizou via API ---
    if (tipo === "unifi" || tipo === "omada") {
      if (gatewayInfo?.ok === false) {
        console.error("Liberacao no gateway falhou:", gatewayInfo?.erro);
      }
      // Destino original do cliente ou um endereco http simples que confirma
      // a saida do walled garden (fecha o mini-browser do captive portal).
      window.location.href = urlSegura(gatewayInfo?.redirect_url, "http://neverssl.com");
      return;
    }

    // --- MikroTik (fluxo legado, inalterado) ---
    if (!gateway || !username) {
      console.error("redirecionarHotspot: gateway ou username vazios", { gateway, username });
      return;
    }
    let url = String(gateway).trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = `http://${url}`;
    }
    if (!url.includes("/login")) {
      url = url.replace(/\/$/, "") + "/login";
    }
    const dst = opcoes?.voltarPara ? `&dst=${encodeURIComponent(opcoes.voltarPara)}` : "";
    window.location.href = `${url}?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password || username)}${dst}`;
  };

  if (delayMs > 0) {
    setTimeout(executar, delayMs);
  } else {
    executar();
  }
}

/**
 * Monta e submete um form POST (application/x-www-form-urlencoded) invisivel
 * pro endpoint browserauth do Omada. Precisa ser POST de navegador (nao fetch):
 * o controller responde com o redirect de sucesso do proprio portal.
 */
function submeterFormBrowserauth(browserauth, username, password) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = browserauth.url;
  form.style.display = "none";

  const campos = { ...(browserauth.fields || {}), username, password };
  Object.entries(campos).forEach(([name, value]) => {
    if (value === null || value === undefined || value === "") return;
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = String(value);
    form.appendChild(input);
  });

  document.body.appendChild(form);
  form.submit();
}

/**
 * Limpa CPF removendo caracteres especiais.
 */
export function limparCpf(cpf) {
  return cpf ? String(cpf).replace(/\D/g, "") : null;
}
