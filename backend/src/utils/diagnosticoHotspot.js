// Diagnostico do hotspot de um MikroTik em UM clique (so leitura): le o roteador e diz, item por item,
// o que esta certo e o que impede o portal de abrir. Nasceu dos casos RB08/RB09, em que cada rodada
// descobria um defeito por prints soltos do terminal (dns-name de exemplo, DNS externo no DHCP, etc.).
//
// `ler(path, args)` devolve { ok, itens }: ok=false quando a leitura expirou/falhou (NAO e' lista
// vazia: um check "indeterminado" vira aviso, nunca "nao existe"). Nunca lanca.
const { calcularRede } = require("./redeHotspot");

const NOME_HOTSPOT = "hotspot1";
const NOME_PROFILE = "hsprof-hotspot";
const NOME_BRIDGE = "bridge-hotspot";

const verdadeiro = (v) => v === true || v === "true" || v === "yes";
const ok = (id, titulo, detalhe = "") => ({ id, titulo, status: "ok", detalhe });
const aviso = (id, titulo, detalhe, correcao) => ({ id, titulo, status: "aviso", detalhe, ...(correcao ? { correcao } : {}) });
const erro = (id, titulo, detalhe, correcao) => ({ id, titulo, status: "erro", detalhe, ...(correcao ? { correcao } : {}) });
const indeterminado = (id, titulo) => aviso(id, titulo, "Nao consegui ler do roteador (demorou demais). Rode o diagnostico de novo.");

/**
 * @param {object} p
 * @param {(path:string,args?:string[])=>Promise<{ok:boolean,itens:object[]}>} p.ler
 * @param {object} p.mikrotik  linha do banco (id, end_hotspot, portal_id)
 * @param {string} [p.portalHost] dominio do portal (walled garden e login.html)
 * @param {(host:string)=>Promise<boolean>} [p.resolve] true se o nome resolve na internet
 * @returns {Promise<{checks:object[], resumo:{ok:number,aviso:number,erro:number}}>}
 */
async function diagnosticarHotspot({ ler, mikrotik, portalHost = "", resolve = async () => true }) {
  const checks = [];
  const add = (c) => checks.push(c);
  const L = async (path, args) => {
    try { return (await ler(path, args)) || { ok: false, itens: [] }; } catch (e) { return { ok: false, itens: [] }; }
  };

  // --- hotspot server (define interface e rede) ---
  const hsR = await L("/ip/hotspot/print");
  const hs = hsR.itens.find((h) => h.name === NOME_HOTSPOT) || hsR.itens[0];
  let ifName = "";
  if (!hsR.ok) add(indeterminado("hotspot", "Hotspot server"));
  else if (!hs) add(erro("hotspot", "Hotspot server", "Nao existe hotspot configurado neste roteador.", "Rode o assistente 'Hotspot' (e nao reaplique o script de instalacao depois)."));
  else if (verdadeiro(hs.disabled)) add(erro("hotspot", "Hotspot server", `${hs.name} esta desabilitado.`, "Habilite: /ip hotspot enable hotspot1"));
  else { ifName = hs.interface || ""; add(ok("hotspot", "Hotspot server", `${hs.name} em ${ifName}, pool ${hs["address-pool"] || "?"}`)); }

  // --- perfil do hotspot (RADIUS e dns-name) ---
  const pfR = await L("/ip/hotspot/profile/print");
  const prof = pfR.itens.find((p) => p.name === (hs && hs.profile) || p.name === NOME_PROFILE);
  let dnsNameHotspot = "";
  if (!pfR.ok) add(indeterminado("profile", "Perfil do hotspot (RADIUS)"));
  else if (!prof) add(erro("profile", "Perfil do hotspot (RADIUS)", "Perfil hsprof-hotspot nao existe.", "Rode o assistente 'Hotspot'."));
  else if (!verdadeiro(prof["use-radius"])) add(erro("profile", "Perfil do hotspot (RADIUS)", `${prof.name} esta sem use-radius: ninguem consegue logar pelo RADIUS.`, "Rode o assistente 'Hotspot'."));
  else { dnsNameHotspot = String(prof["dns-name"] || "").trim(); add(ok("profile", "Perfil do hotspot (RADIUS)", `${prof.name} com RADIUS${dnsNameHotspot ? `, dns-name ${dnsNameHotspot}` : ", sem dns-name (usa o IP)"}`)); }

  // --- IP do gateway na interface do hotspot ---
  const ipR = await L("/ip/address/print");
  const ipIf = ifName ? ipR.itens.find((a) => a.interface === ifName) : null;
  let gateway = "";
  let rede = null;
  if (!ifName) add(aviso("ip", "IP do hotspot", "Sem hotspot configurado, nao ha interface para conferir."));
  else if (!ipR.ok) add(indeterminado("ip", "IP do hotspot"));
  else if (!ipIf) add(erro("ip", "IP do hotspot", `A interface ${ifName} nao tem IP.`, "Rode o assistente 'Hotspot'."));
  else { gateway = String(ipIf.address || "").split("/")[0]; rede = calcularRede(ipIf.address); add(ok("ip", "IP do hotspot", `${ipIf.address} em ${ifName}`)); }

  // --- bridge e portas ---
  if (ifName === NOME_BRIDGE) {
    const bpR = await L("/interface/bridge/port/print");
    const doBridge = bpR.itens.filter((b) => b.bridge === NOME_BRIDGE);
    if (!bpR.ok) add(indeterminado("bridge", "Portas da bridge"));
    else if (!doBridge.length) add(erro("bridge", "Portas da bridge", "A bridge-hotspot existe mas nao tem nenhuma porta: o cliente nao chega ao hotspot.", "Rode o assistente 'Hotspot' marcando as portas."));
    else add(ok("bridge", "Portas da bridge", doBridge.map((b) => b.interface).join(", ")));
  }

  // --- Wi-Fi ---
  const wR = await L("/interface/wireless/print");
  if (wR.ok && wR.itens.length) {
    const radios = wR.itens;
    const ligados = radios.filter((r) => !verdadeiro(r.disabled));
    if (!ligados.length) add(erro("wifi", "Wi-Fi", "Todos os radios estao desabilitados: ninguem enxerga a rede.", "Rode o assistente 'Hotspot' com o SSID preenchido."));
    else {
      const semSsid = ligados.filter((r) => !String(r.ssid || "").trim());
      if (semSsid.length) add(aviso("wifi", "Wi-Fi", `${semSsid.map((r) => r.name).join(", ")} sem SSID.`));
      else add(ok("wifi", "Wi-Fi", ligados.map((r) => `${r.name}: "${r.ssid}"${verdadeiro(r.running) ? "" : " (parado)"}`).join(", ")));
    }
  }

  // --- DHCP: o cliente deve usar o proprio roteador como DNS ---
  const nR = await L("/ip/dhcp-server/network/print");
  const dhcpR = await L("/ip/dhcp-server/print");
  if (!gateway) add(aviso("dhcp", "DHCP do hotspot", "Sem IP do hotspot para conferir."));
  else if (!nR.ok || !dhcpR.ok) add(indeterminado("dhcp", "DHCP do hotspot"));
  else {
    const servidor = dhcpR.itens.find((d) => d.interface === ifName);
    const rn = nR.itens.find((n) => rede && rede.ok ? n.address === rede.network : false) || nR.itens.find((n) => String(n.gateway || "") === gateway);
    if (!servidor) add(erro("dhcp", "DHCP do hotspot", `Nao existe servidor DHCP em ${ifName}: o celular nao recebe IP.`, "Rode o assistente 'Hotspot'."));
    else if (verdadeiro(servidor.disabled)) add(erro("dhcp", "DHCP do hotspot", "O servidor DHCP esta desabilitado.", "/ip dhcp-server enable"));
    else if (!rn) add(erro("dhcp", "DHCP do hotspot", "Falta a rede do DHCP (gateway e DNS).", "Rode o assistente 'Hotspot'."));
    else {
      const dns = String(rn["dns-server"] || "");
      if (dns.split(",").map((s) => s.trim()).includes(gateway)) add(ok("dhcp", "DNS entregue aos clientes", `${dns} (o proprio roteador)`));
      else add(erro("dns_dhcp", "DNS entregue aos clientes", `O DHCP entrega ${dns || "nenhum DNS"}, nao o roteador (${gateway}). O hotspot nao consegue redirecionar o cliente ao portal.`, { acao: "dns_dhcp", texto: `Entregar ${gateway} como DNS` }));
    }
  }

  // --- DNS do proprio roteador ---
  const dnsR = await L("/ip/dns/print");
  if (!dnsR.ok) add(indeterminado("dns_remoto", "DNS do roteador"));
  else if (!dnsR.itens[0] || !verdadeiro(dnsR.itens[0]["allow-remote-requests"])) add(erro("dns_remoto", "DNS do roteador", "allow-remote-requests esta desligado: o roteador nao responde DNS aos clientes.", { acao: "dns_remoto", texto: "Habilitar allow-remote-requests" }));
  else add(ok("dns_remoto", "DNS do roteador", `servidores ${dnsR.itens[0].servers || dnsR.itens[0]["dynamic-servers"] || "(dinamicos)"}`));

  // --- dns-name do perfil ---
  if (prof && dnsNameHotspot) {
    const resolve_ = await resolve(dnsNameHotspot).catch(() => false);
    if (!resolve_) add(erro("dns_name", "Nome do portal (dns-name)", `O dns-name "${dnsNameHotspot}" nao existe na internet. O celular e redirecionado para esse nome e para na tela de erro de DNS.`, { acao: "dns_name", texto: "Remover o dns-name (usar o IP do hotspot)" }));
    else add(aviso("dns_name", "Nome do portal (dns-name)", `${dnsNameHotspot} resolve na internet. Funciona so se o cliente tambem alcanca esse nome (e o HTTPS tiver certificado valido para ele).`));
  }

  // --- regras dinamicas do hotspot (redirects) ---
  const natR = await L("/ip/firewall/nat/print");
  if (natR.ok && natR.itens.length) {
    const hotspotRegras = natR.itens.filter((r) => r.chain === "hotspot" || r.chain === "hs-unauth");
    if (!hotspotRegras.length) add(erro("nat", "Redirecionamento do hotspot (firewall)", "As regras dinamicas do hotspot nao existem: o hotspot nao esta interceptando os clientes.", "Desabilite e habilite o hotspot: /ip hotspot disable hotspot1; /ip hotspot enable hotspot1"));
    else {
      const redirDns = hotspotRegras.find((r) => r.chain === "hotspot" && r["dst-port"] === "53" && r.action === "redirect");
      const redirHttp = hotspotRegras.find((r) => r.chain === "hs-unauth" && r["dst-port"] === "80" && r.action === "redirect");
      const pk = (r) => (r && r.packets != null ? Number(r.packets) : null);
      const partes = [`DNS ${redirDns ? "ok" : "ausente"}`, `HTTP ${redirHttp ? "ok" : "ausente"}`];
      if (pk(redirHttp) != null) partes.push(`HTTP interceptado: ${pk(redirHttp)} pacotes`);
      if (!redirHttp) add(erro("nat", "Redirecionamento do hotspot (firewall)", partes.join("; "), "Reinicie o hotspot: /ip hotspot disable hotspot1; /ip hotspot enable hotspot1"));
      else add(ok("nat", "Redirecionamento do hotspot (firewall)", partes.join("; ")));
    }
  }

  // --- walled garden com o portal ---
  const wgR = await L("/ip/hotspot/walled-garden/print");
  if (!portalHost) add(aviso("walled", "Walled garden", "Dominio do portal desconhecido."));
  else if (!wgR.ok) add(indeterminado("walled", "Walled garden"));
  else if (!wgR.itens.some((w) => String(w["dst-host"] || "").includes(portalHost) && w.action !== "deny")) add(erro("walled", "Walled garden", `O dominio do portal (${portalHost}) nao esta liberado: o celular nao consegue abrir o portal antes de logar.`, "Rode o assistente 'Hotspot'."));
  else add(ok("walled", "Walled garden", `${portalHost} liberado`));

  // --- RADIUS e pool ---
  const rR = await L("/radius/print");
  if (!rR.ok) add(indeterminado("radius", "Cliente RADIUS"));
  else if (!rR.itens.some((r) => String(r.service || "").includes("hotspot"))) add(erro("radius", "Cliente RADIUS", "O roteador nao tem cliente RADIUS para o hotspot.", "Rode o assistente 'Hotspot'."));
  else add(ok("radius", "Cliente RADIUS", rR.itens.find((r) => String(r.service || "").includes("hotspot")).address));

  const poolR = await L("/ip/pool/print");
  const nomePool = hs && hs["address-pool"];
  if (nomePool && nomePool !== "none") {
    if (!poolR.ok) add(indeterminado("pool", "Pool de enderecos"));
    else if (!poolR.itens.some((p) => p.name === nomePool)) add(erro("pool", "Pool de enderecos", `O pool ${nomePool} nao existe.`, "Rode o assistente 'Hotspot'."));
    else add(ok("pool", "Pool de enderecos", `${nomePool} (${(poolR.itens.find((p) => p.name === nomePool) || {}).ranges || "?"})`));
  }

  // --- paginas login.html / error.html ---
  const fR = await L("/file/print", ["=.proplist=name,size"]);
  if (!fR.ok) add(indeterminado("arquivos", "Paginas do hotspot (login.html)"));
  else {
    const dir = (prof && prof["html-directory"]) || "hotspot";
    const login = fR.itens.find((f) => f.name === `${dir}/login.html`);
    const err = fR.itens.find((f) => f.name === `${dir}/error.html`);
    const redirect = fR.itens.find((f) => f.name === `${dir}/redirect.html`);
    if (!redirect) add(erro("redirect_html", "Pagina de redirecionamento (redirect.html)", `${dir}/redirect.html nao existe: qualquer site HTTP responde "404 Not Found" e o portal so abre digitando o IP.`, { acao: "reset_html", texto: "Restaurar paginas padrao" }));
    else add(ok("redirect_html", "Pagina de redirecionamento (redirect.html)", `${dir}/redirect.html presente`));
    const statusF = fR.itens.find((f) => f.name === `${dir}/status.html`);
    if (!statusF) add(aviso("status_html", "Pagina de status (status.html)", `${dir}/status.html nao existe: o cliente logado ve a pagina padrao (ou nenhuma).`, { acao: "enviar_status", texto: "Enviar status.html" }));
    else add(ok("status_html", "Pagina de status (status.html)", `${dir}/status.html presente (${statusF.size} bytes)`));
    if (!login) add(erro("arquivos", "Paginas do hotspot (login.html)", `${dir}/login.html nao existe: o hotspot mostra a pagina padrao do MikroTik.`, "Use o botao 'Login' da linha do equipamento."));
    else {
      let detalhe = `${dir}/login.html (${login.size} bytes)`;
      let status = "ok";
      const conteudo = await L("/file/print", [`?name=${dir}/login.html`, "=.proplist=name,contents"]);
      const txt = (conteudo.itens[0] && conteudo.itens[0].contents) || "";
      if (conteudo.ok && txt && !new RegExp(`hotspot/redirect/${mikrotik.id}\\b`).test(txt)) { status = "erro"; detalhe += ": nao aponta para o portal deste equipamento"; }
      add(status === "ok" ? ok("arquivos", "Paginas do hotspot (login.html)", detalhe + (err ? ", error.html presente" : ", error.html ausente")) : erro("arquivos", "Paginas do hotspot (login.html)", detalhe, "Use o botao 'Login' da linha do equipamento."));
    }
  }

  // --- clientes ---
  const hostsR = await L("/ip/hotspot/host/print");
  const actR = await L("/ip/hotspot/active/print");
  if (hostsR.ok && actR.ok) add(ok("clientes", "Clientes agora", `${hostsR.itens.length} aparelho(s) no hotspot, ${actR.itens.length} logado(s)`));

  // --- banco x roteador ---
  const esperado = dnsNameHotspot || gateway;
  if (gateway) {
    if (!mikrotik.end_hotspot) add(erro("end_hotspot", "Destino do login final (banco)", "end_hotspot vazio no cadastro do equipamento.", { acao: "end_hotspot", texto: `Gravar ${esperado}` }));
    else if (mikrotik.end_hotspot !== esperado) add(erro("end_hotspot", "Destino do login final (banco)", `O cadastro tem "${mikrotik.end_hotspot}" mas o hotspot usa "${esperado}": o login depois de pagar vai para o lugar errado.`, { acao: "end_hotspot", texto: `Gravar ${esperado}` }));
    else add(ok("end_hotspot", "Destino do login final (banco)", mikrotik.end_hotspot));
  }

  const resumo = { ok: 0, aviso: 0, erro: 0 };
  for (const c of checks) resumo[c.status] += 1;
  return { checks, resumo, gateway, interface: ifName };
}

module.exports = { diagnosticarHotspot, NOME_HOTSPOT, NOME_PROFILE, NOME_BRIDGE };
