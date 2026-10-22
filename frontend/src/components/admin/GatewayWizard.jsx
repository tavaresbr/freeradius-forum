import React, { useEffect, useState } from "react";

/**
 * Wizard de cadastro/edicao de gateway (MikroTik / Omada / UniFi).
 * Passos: 0 = tipo, 1 = conexao (campos por vendor), 2 = portal + resumo.
 * Na edicao o tipo e' travado (backend tambem trava) e o wizard abre no passo 1.
 */

const VENDORS = [
  {
    id: "mikrotik",
    nome: "MikroTik",
    desc: "RouterOS via API. Hotspot nativo com FreeRADIUS — setup automático completo.",
    badge: "bg-sky-900/30 border-sky-800/50 text-sky-400",
  },
  {
    id: "omada",
    nome: "TP-Link Omada",
    desc: "Controller Omada (software, OC200/OC300) via External RADIUS. Nomes dos APs via API: botão API na lista.",
    badge: "bg-emerald-900/30 border-emerald-800/50 text-emerald-400",
  },
  {
    id: "unifi",
    nome: "Ubiquiti UniFi",
    desc: "Controller UniFi via API. Autorização e sessões pela API do controller — setup simples, validado em campo.",
    badge: "bg-indigo-900/30 border-indigo-800/50 text-indigo-400",
  },
  {
    id: "grandstream",
    nome: "Grandstream GWN",
    desc: "APs GWN via External Web Portal + External RADIUS. Chaves GWN Cloud opcionais (só monitoramento).",
    badge: "bg-rose-900/30 border-rose-800/50 text-rose-400",
  },
];

const FORM_INICIAL = {
  tipo: "mikrotik",
  nome: "",
  ip: "",
  usuario: "",
  senha: "",
  porta: 8728,
  end_hotspot: "",
  portal_id: "",
  controller_url: "",
  controller_site: "",
  omadac_id: "",
  api_user: "",
  api_pass: "",
  verify_tls: 0,
  gwn_api_key: "",
  gwn_api_secret: "",
  gwn_network_id: "",
};

const inputCls = "w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500";
const labelCls = "block text-xs text-gray-500 mb-1";

export default function GatewayWizard({ open, onClose, onSaved, portais, token, editando }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(FORM_INICIAL);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  // Peers VPN ainda sem equipamento: { carregando, peers, aviso }
  const [vpn, setVpn] = useState({ carregando: false, peers: [], aviso: "" });

  // Só no cadastro novo: busca os peers da VPN que ainda não viraram equipamento.
  useEffect(() => {
    if (!open || editando) return;
    let cancelado = false;
    setVpn({ carregando: true, peers: [], aviso: "" });
    fetch("/api/mikrotiks/vpn-disponiveis", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("falha"))))
      .then((d) => { if (!cancelado) setVpn({ carregando: false, peers: d.peers || [], aviso: d.aviso || "" }); })
      .catch(() => { if (!cancelado) setVpn({ carregando: false, peers: [], aviso: "Não foi possível consultar a VPN agora." }); });
    return () => { cancelado = true; };
  }, [open, editando, token]);

  useEffect(() => {
    if (!open) return;
    setErro("");
    if (editando) {
      setForm({
        ...FORM_INICIAL,
        ...Object.fromEntries(Object.entries(editando).filter(([, v]) => v !== null)),
        tipo: editando.tipo || "mikrotik",
        portal_id: editando.portal_id || "",
        verify_tls: editando.verify_tls === undefined ? 0 : Number(editando.verify_tls),
      });
      setStep(1);
    } else {
      setForm(FORM_INICIAL);
      setStep(0);
    }
  }, [open, editando]);

  if (!open) return null;

  const set = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));
  const vendor = VENDORS.find((v) => v.id === form.tipo) || VENDORS[0];

  const validarConexao = () => {
    if (!form.nome || !form.ip) return "Preencha nome e IP.";
    if (form.tipo === "mikrotik" && (!form.usuario || !form.senha || !form.porta)) {
      return "Preencha usuário, senha e porta da API RouterOS.";
    }
    if (form.tipo === "omada" && !form.senha) return "Informe o Secret RADIUS.";
    if (form.tipo === "grandstream" && !form.senha) return "Informe o Secret RADIUS.";
    if (form.tipo === "unifi" && (!form.controller_url || !form.api_user || !form.api_pass)) {
      return "Preencha Controller URL e credenciais do admin local.";
    }
    return "";
  };

  const avancarConexao = () => {
    const msg = validarConexao();
    if (msg) { setErro(msg); return; }
    setErro("");
    setStep(2);
  };

  const salvar = async () => {
    setSalvando(true);
    setErro("");

    const body = { ...form };
    if (form.tipo === "omada") {
      // A API do controller (captura de nomes de APs) e' gerenciada no botão
      // "API" da lista de equipamentos — o cadastro nunca mexe nesses campos.
      delete body.controller_url;
      delete body.omadac_id;
      delete body.api_user;
      delete body.api_pass;
      delete body.verify_tls;
    }
    if (form.tipo === "mikrotik") body.porta = parseInt(form.porta, 10) || 8728;

    try {
      const url = editando ? `/api/mikrotiks/${editando.id}` : "/api/mikrotiks";
      const res = await fetch(url, {
        method: editando ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.message || "Erro ao salvar gateway.");
      } else {
        onSaved();
      }
    } catch {
      setErro("Erro de conexão com o servidor.");
    } finally {
      setSalvando(false);
    }
  };

  const passos = ["Tipo", "Conexão", "Portal"];

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1d27] rounded-xl border border-gray-700 w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-white">
            {editando ? `Editar Equipamento — ${vendor.nome}` : "Adicionar Equipamento"}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white cursor-pointer">×</button>
        </div>

        {/* Indicador de passos */}
        <div className="flex items-center gap-2 mb-5">
          {passos.map((p, i) => (
            <React.Fragment key={p}>
              {i > 0 && <div className={`flex-1 h-px ${step >= i ? "bg-blue-500" : "bg-gray-700"}`} />}
              <div className={`flex items-center gap-1.5 text-xs ${step >= i ? "text-blue-400" : "text-gray-600"}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center border ${step >= i ? "border-blue-500 bg-blue-500/10" : "border-gray-700"}`}>{i + 1}</span>
                {p}
              </div>
            </React.Fragment>
          ))}
        </div>

        {erro && <p className="text-red-400 text-sm mb-3 bg-red-900/20 border border-red-800/50 rounded px-3 py-2">{erro}</p>}

        {/* Passo 0: Tipo */}
        {step === 0 && (
          <div className="space-y-3">
            {VENDORS.map((v) => (
              <button
                key={v.id}
                onClick={() => { set("tipo", v.id); setErro(""); setStep(1); }}
                className={`w-full text-left p-4 rounded-lg border cursor-pointer transition-colors ${form.tipo === v.id ? "border-blue-500 bg-blue-500/5" : "border-gray-700 hover:border-gray-500 bg-[#0d1117]"}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded border ${v.badge}`}>{v.nome}</span>
                </div>
                <p className="text-xs text-gray-400">{v.desc}</p>
              </button>
            ))}
          </div>
        )}

        {/* Passo 1: Conexão */}
        {step === 1 && (
          <div className="space-y-4">
            {/* Peers da VPN ainda não cadastrados: um clique preenche nome e IP */}
            {!editando && form.tipo === "mikrotik" && (vpn.carregando || vpn.peers.length > 0 || vpn.aviso) && (
              <div className="bg-[#0d1117] rounded-lg p-3 border border-gray-800">
                <p className="text-xs text-gray-500 mb-2">Equipamentos da VPN ainda não cadastrados</p>
                {vpn.carregando && <p className="text-xs text-gray-600">Carregando...</p>}
                {!vpn.carregando && vpn.aviso && <p className="text-xs text-amber-500/90">{vpn.aviso} Preencha o IP manualmente.</p>}
                <div className="flex flex-wrap gap-2">
                  {vpn.peers.map((p) => (
                    <button
                      key={p.ip}
                      type="button"
                      onClick={() => { set("nome", p.nome); set("ip", p.ip); }}
                      className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded border cursor-pointer transition-colors ${form.ip === p.ip ? "border-blue-500 bg-blue-500/10 text-blue-300" : "border-gray-700 text-gray-300 hover:border-gray-500"}`}
                    >
                      <span className={`w-2 h-2 rounded-full ${p.online ? "bg-green-500" : "bg-red-500"}`} />
                      <span className="font-medium">{p.nome}</span>
                      <span className="text-gray-500">{p.ip}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className={labelCls}>Nome</label>
              <input className={inputCls} value={form.nome} onChange={(e) => set("nome", e.target.value)} placeholder={`Ex: ${vendor.nome} Matriz`} />
            </div>

            <div>
              <label className={labelCls}>
                {form.tipo === "mikrotik" && "Endereço IP (ou IP VPN)"}
                {form.tipo === "omada" && "IP do Controller/EAP (origem dos pacotes RADIUS)"}
                {form.tipo === "unifi" && "IP do Controller"}
                {form.tipo === "grandstream" && "IP do Gateway/Router GWN (origem dos pacotes RADIUS)"}
              </label>
              <input className={inputCls} value={form.ip} onChange={(e) => set("ip", e.target.value)} placeholder="192.168.1.1" />
            </div>

            {/* MikroTik */}
            {form.tipo === "mikrotik" && (
              <>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className={labelCls}>Usuário API</label>
                    <input className={inputCls} value={form.usuario} onChange={(e) => set("usuario", e.target.value)} />
                  </div>
                  <div className="w-28">
                    <label className={labelCls}>Porta API</label>
                    <input type="number" className={inputCls} value={form.porta} onChange={(e) => set("porta", e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Senha API</label>
                  <input type="password" className={inputCls} value={form.senha} onChange={(e) => set("senha", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Endereço Hotspot (preenchido pelo wizard de Hotspot)</label>
                  <input className={inputCls} value={form.end_hotspot} onChange={(e) => set("end_hotspot", e.target.value)} placeholder="hotspot.minharede.com" />
                </div>
              </>
            )}

            {/* Omada — sempre External RADIUS (homologado) */}
            {form.tipo === "omada" && (
              <>
                <div>
                  <label className={labelCls}>Secret RADIUS (o mesmo cadastrado no RADIUS Profile do Omada)</label>
                  <input type="password" className={inputCls} value={form.senha} onChange={(e) => set("senha", e.target.value)} />
                </div>
                <div className="bg-[#0d1117] rounded-lg p-3 border border-gray-800 text-xs text-gray-400 space-y-1">
                  <p className="text-gray-500 font-medium">Configure no controller Omada:</p>
                  <p>• RADIUS Profile → servidor {window.location.hostname} portas 1812 (auth) e 1813 (accounting) com este secret</p>
                  <p>• SSID → Portal → External Web Portal → https://{window.location.hostname}/hotspot/redirect/&lt;id&gt; (o id aparece na lista após salvar)</p>
                  <p>• Pre-Authentication Access → liberar {window.location.hostname}</p>
                  <p className="text-emerald-500/90 pt-1">Nomes dos APs nos relatórios: depois de salvar, use o botão <b>API</b> na lista de equipamentos (opcional — captura de dados via API do controller; o portal continua 100% RADIUS).</p>
                </div>
              </>
            )}

            {/* Grandstream GWN — External Web Portal + External RADIUS */}
            {form.tipo === "grandstream" && (
              <>
                <div>
                  <label className={labelCls}>Secret RADIUS (o mesmo cadastrado no RADIUS do controller GWN)</label>
                  <input type="password" className={inputCls} value={form.senha} onChange={(e) => set("senha", e.target.value)} />
                </div>
                <div className="pt-2 border-t border-gray-800">
                  <p className="text-xs text-gray-500 mb-2">Monitoramento GWN Cloud (opcional — só para status Online/Offline)</p>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className={labelCls}>API Key</label>
                      <input className={inputCls} value={form.gwn_api_key} onChange={(e) => set("gwn_api_key", e.target.value)} />
                    </div>
                    <div className="flex-1">
                      <label className={labelCls}>API Secret</label>
                      <input type="password" className={inputCls} value={form.gwn_api_secret} onChange={(e) => set("gwn_api_secret", e.target.value)} />
                    </div>
                  </div>
                  <div className="mt-2">
                    <label className={labelCls}>Network ID</label>
                    <input className={inputCls} value={form.gwn_network_id} onChange={(e) => set("gwn_network_id", e.target.value)} />
                  </div>
                </div>
                <div className="bg-[#0d1117] rounded-lg p-3 border border-gray-800 text-xs text-gray-400 space-y-1">
                  <p className="text-gray-500 font-medium">Configure no controller/gateway GWN:</p>
                  <p>• RADIUS → servidor {window.location.hostname} portas 1812 (auth) e 1813 (accounting) com este secret</p>
                  <p>• SSID → Captive Portal → External Web Portal → https://{window.location.hostname}/hotspot/redirect/&lt;id&gt; (o id aparece na lista após salvar)</p>
                  <p>• Walled Garden / Pré-autenticação → liberar {window.location.hostname}</p>
                  <p className="text-rose-400/90 pt-1">Passo a passo com prints: menu Documentação → Tutorial Grandstream.</p>
                </div>
              </>
            )}

            {/* UniFi: campos de controller */}
            {form.tipo === "unifi" && (
              <>
                <div>
                  <label className={labelCls}>
                    Controller URL (host:8443 standalone / host:443 UniFi OS)
                  </label>
                  <input className={inputCls} value={form.controller_url} onChange={(e) => set("controller_url", e.target.value)}
                    placeholder="192.168.1.10:8443" />
                </div>
                <div>
                  <label className={labelCls}>Site</label>
                  <input className={inputCls} value={form.controller_site} onChange={(e) => set("controller_site", e.target.value)}
                    placeholder="default" />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className={labelCls}>Admin local</label>
                    <input className={inputCls} value={form.api_user} onChange={(e) => set("api_user", e.target.value)} />
                  </div>
                  <div className="flex-1">
                    <label className={labelCls}>Senha</label>
                    <input type="password" className={inputCls} value={form.api_pass} onChange={(e) => set("api_pass", e.target.value)} />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={!!Number(form.verify_tls)} onChange={(e) => set("verify_tls", e.target.checked ? 1 : 0)} />
                  Validar certificado TLS (deixe desligado — controllers usam certificado self-signed)
                </label>
                <p className="text-xs text-yellow-500/90">Use um admin <b>local</b> do controller — conta cloud Ubiquiti não funciona na API.</p>
                <div className="bg-[#0d1117] rounded-lg p-3 border border-gray-800 text-xs text-gray-400 space-y-1">
                  <p className="text-gray-500 font-medium">Configure no controller UniFi:</p>
                  <p>• Settings → Hotspot → Landing Page → <b>External Portal Server</b> → https://{window.location.hostname}/hotspot/redirect/&lt;id&gt; (o id aparece na lista após salvar)</p>
                  <p>• Pre-Authorization Access / Walled Garden → liberar {window.location.hostname}</p>
                  <p>• A autorização final é feita por este servidor via API (authorize-guest) — nada a configurar de RADIUS.</p>
                </div>
              </>
            )}

            <div className="flex justify-between pt-2 border-t border-gray-800">
              <button onClick={() => (editando ? onClose() : setStep(0))} className="px-4 py-2 text-sm text-gray-300 border border-gray-700 rounded hover:bg-[#252b3b] cursor-pointer">
                {editando ? "Cancelar" : "Voltar"}
              </button>
              <button onClick={avancarConexao} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 cursor-pointer font-medium">
                Avançar
              </button>
            </div>
          </div>
        )}

        {/* Passo 2: Portal + resumo */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Portal Captive vinculado</label>
              <select className={`${inputCls} cursor-pointer`} value={form.portal_id} onChange={(e) => set("portal_id", e.target.value)}>
                <option value="">Nenhum</option>
                {portais.map((p) => (
                  <option key={p.id} value={p.id}>{p.nome} ({p.tipo})</option>
                ))}
              </select>
            </div>

            <div className="bg-[#0d1117] rounded-lg p-4 border border-gray-800 text-sm space-y-2">
              <p className="text-gray-500 text-xs font-medium mb-1">Resumo</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-gray-500">Tipo</span><span className="text-white">{vendor.nome}{(form.tipo === "omada" || form.tipo === "grandstream") ? " (External RADIUS)" : ""}</span>
                <span className="text-gray-500">Nome</span><span className="text-white">{form.nome}</span>
                <span className="text-gray-500">IP</span><span className="text-white">{form.ip}</span>
                {form.tipo === "unifi" && (<><span className="text-gray-500">Controller</span><span className="text-white break-all">{form.controller_url}</span></>)}
              </div>
              <p className="text-xs text-gray-500 pt-1">Após salvar, a conexão é testada automaticamente na lista (status Online/Offline).</p>
            </div>

            <div className="flex justify-between pt-2 border-t border-gray-800">
              <button onClick={() => setStep(1)} className="px-4 py-2 text-sm text-gray-300 border border-gray-700 rounded hover:bg-[#252b3b] cursor-pointer">Voltar</button>
              <button onClick={salvar} disabled={salvando}
                className={`px-4 py-2 text-sm rounded cursor-pointer font-medium ${salvando ? "bg-gray-700 text-gray-400" : "bg-blue-600 text-white hover:bg-blue-500"}`}>
                {salvando ? "Salvando..." : editando ? "Atualizar Equipamento" : "Salvar Equipamento"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
