import React, { useEffect, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { VENDORS, vendorDoTipo } from "../../constants/gatewayTipos";

// "Nova Telecom" -> "Nova-Telecom" (sem acentos; so letras, numeros e hifen, como o nome do roteador exige)
function baseNomePeer(nomeEmpresa) {
  return String(nomeEmpresa || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 40).replace(/-+$/, "") || "Peer";
}

// Proximo nome livre: base-01, base-02... (maior sufixo existente + 1)
export function sugerirNomePeer(nomeEmpresa, peers) {
  const base = baseNomePeer(nomeEmpresa);
  const nomes = new Set((peers || []).map((c) => String(c.name || "").toLowerCase()));
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`, "i");
  let maior = 0;
  for (const c of peers || []) {
    const m = re.exec(String(c.name || ""));
    if (m) maior = Math.max(maior, parseInt(m[1], 10));
  }
  let n = maior + 1;
  const nome = (i) => `${base}-${String(i).padStart(2, "0")}`;
  while (nomes.has(nome(n).toLowerCase())) n++;
  return nome(n);
}

// Copia para a area de transferencia (com fallback para http/navegadores antigos). Lanca erro se falhar.
async function copiarTexto(texto) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(texto);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = texto;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

// Modal com o script de instalacao rapida (colar no terminal do MikroTik).
// acaoExtra = { label, onClick } opcional: botao de "proximo passo" ao lado de Copiar.
export function ScriptPeerModal({ open, script, onClose, acaoExtra }) {
  const [copiado, setCopiado] = useState(false);
  if (!open) return null;

  const copiar = async () => {
    try {
      await copiarTexto(script);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch (err) {
      alert("Não foi possível copiar automaticamente. Selecione o texto e copie com Ctrl+C.");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm p-4">
      <div className="bg-[#1a1d27] border border-gray-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col p-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3 className="text-lg font-bold text-white">Script de Instalação Rápida</h3>
            <p className="text-gray-400 text-xs mt-1">
              Para um Mikrotik <strong>resetado com "No Default Configuration"</strong> (ether1 = internet). Cole no terminal (New Terminal) do roteador: configura internet, DNS, NAT, firewall, hora, VPN, API e Wi-Fi, e deixa só o wizard de Hotspot para o painel.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none" title="Fechar">&times;</button>
        </div>

        <p className="text-yellow-400 text-xs mb-3">
          Depois de colar: se o servidor tiver a senha padrão configurada, ela já vai no script; senão defina a senha do admin (<code>/user set admin password=...</code>). Use a mesma ao cadastrar o equipamento. Pode colar de novo sem erro.
        </p>

        <div className="bg-[#0d1117] rounded-lg border border-gray-800 overflow-auto min-h-0 flex-1 max-h-[50vh]">
          <pre className="text-xs leading-relaxed text-green-400 font-mono whitespace-pre-wrap break-words p-3">
            <span className="dado-sensivel">{script}</span>
          </pre>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
          <span className="text-gray-500 text-xs">{script ? script.split("\n").length : 0} linhas</span>
          <div className="flex flex-wrap gap-2">
            <button onClick={onClose} className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600">Fechar</button>
            {acaoExtra && (
              <button onClick={acaoExtra.onClick} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500">
                {acaoExtra.label}
              </button>
            )}
            <button
              onClick={copiar}
              className={`px-4 py-2 text-white rounded font-medium transition-colors ${copiado ? "bg-green-600 hover:bg-green-500" : "bg-blue-600 hover:bg-blue-500"}`}
            >
              {copiado ? "Copiado!" : "Copiar script"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Configuracao WireGuard padrao (.conf) para os tipos que nao tem script de instalacao (Omada, UniFi, ...).
export function ConfPeerModal({ open, conf, nome, tipo, onClose, acaoExtra }) {
  const [copiado, setCopiado] = useState(false);
  if (!open) return null;

  const copiar = async () => {
    try {
      await copiarTexto(conf);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch (err) {
      alert("Não foi possível copiar automaticamente. Selecione o texto e copie com Ctrl+C.");
    }
  };

  const baixar = () => {
    const arquivo = `${String(nome || "peer").replace(/[^A-Za-z0-9._-]/g, "-")}.conf`;
    const url = URL.createObjectURL(new Blob([conf], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = arquivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm p-4">
      <div className="bg-[#1a1d27] border border-gray-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col p-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3 className="text-lg font-bold text-white">Configuração WireGuard ({vendorDoTipo(tipo).nome})</h3>
            <p className="text-gray-400 text-xs mt-1">
              Este tipo de equipamento não tem script de instalação. Use esta configuração no equipamento ou servidor que faz a VPN deste local.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none" title="Fechar">&times;</button>
        </div>

        <p className="text-yellow-400 text-xs mb-3">
          Só use este peer se o controller/AP (ou o roteador na frente dele) realmente enviar o tráfego RADIUS por esta VPN. O IP do peer será o IP do equipamento no cadastro.
        </p>

        <div className="bg-[#0d1117] rounded-lg border border-gray-800 overflow-auto min-h-0 flex-1 max-h-[50vh]">
          <pre className="text-xs leading-relaxed text-green-400 font-mono whitespace-pre-wrap break-words p-3">
            <span className="dado-sensivel">{conf}</span>
          </pre>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-4">
          <button onClick={onClose} className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600">Fechar</button>
          <button onClick={baixar} className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600">Baixar .conf</button>
          {acaoExtra && (
            <button onClick={acaoExtra.onClick} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500">{acaoExtra.label}</button>
          )}
          <button
            onClick={copiar}
            className={`px-4 py-2 text-white rounded font-medium transition-colors ${copiado ? "bg-green-600 hover:bg-green-500" : "bg-blue-600 hover:bg-blue-500"}`}
          >
            {copiado ? "Copiado!" : "Copiar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Escolhe o modal certo pelo tipo do peer: MikroTik = script de instalacao; os demais = .conf.
export function PeerConfigModal({ open, tipo, script, conf, nome, onClose, acaoExtra }) {
  if (tipo && tipo !== "mikrotik") {
    return <ConfPeerModal open={open} conf={conf} nome={nome} tipo={tipo} onClose={onClose} acaoExtra={acaoExtra} />;
  }
  return <ScriptPeerModal open={open} script={script} onClose={onClose} acaoExtra={acaoExtra} />;
}

/*
 * Fluxo "Adicionar Peer": modal de nome -> cria o peer -> mostra o script.
 * Usado na tela VPN, no Dashboard e na pagina "Comece por aqui".
 * Props: open, onClose, onCreated?(), peers? (lista atual, so para sugerir o nome;
 * se omitida o componente consulta /api/wireguard/status), proximoPasso? ({label, onClick}).
 */
export default function AdicionarPeerFlow({ open, onClose, onCreated, peers, proximoPasso }) {
  const { user } = useAuth();
  const token = localStorage.getItem("admin_token");
  const [nome, setNome] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [tipo, setTipo] = useState("mikrotik");
  const [script, setScript] = useState("");
  const [conf, setConf] = useState("");
  const [mostrarScript, setMostrarScript] = useState(false);

  // Ao abrir: sugere o proximo nome livre (usa a lista recebida ou consulta o status)
  useEffect(() => {
    if (!open) return;
    setTipo("mikrotik");
    let cancelado = false;
    const sugerir = (lista) => { if (!cancelado) setNome(sugerirNomePeer(user?.empresa_nome || user?.empresa_slug, lista)); };
    if (peers) {
      sugerir(peers);
    } else {
      sugerir([]);
      fetch("/api/wireguard/status", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && sugerir(d.clients))
        .catch(() => {});
    }
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fecharScript = () => { setMostrarScript(false); setScript(""); setConf(""); onClose && onClose(); };

  const criar = async (e) => {
    e.preventDefault();
    if (!nome || enviando) return;
    setEnviando(true);
    try {
      const res = await fetch("/api/wireguard/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: nome, tipo }),
      });
      const criado = await res.json().catch(() => ({}));
      if (!res.ok || !criado.id) throw new Error(criado.message || "Erro ao criar peer");

      const scriptRes = await fetch(`/api/wireguard/clients/${criado.id}/config`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const scriptJson = await scriptRes.json();

      setScript(scriptJson.routerOsScript || "");
      setConf(scriptJson.conf || "");
      setMostrarScript(true);
      onCreated && onCreated(criado);
    } catch (err) {
      alert(err.message || "Erro ao criar peer");
    } finally {
      setEnviando(false);
    }
  };

  if (mostrarScript) {
    return (
      <PeerConfigModal
        open
        tipo={tipo}
        script={script}
        conf={conf}
        nome={nome}
        onClose={fecharScript}
        acaoExtra={proximoPasso ? { label: proximoPasso.label, onClick: () => { fecharScript(); proximoPasso.onClick(); } } : null}
      />
    );
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-[#1a1d27] border border-gray-700 rounded-xl shadow-2xl w-full max-w-md p-6">
        <h3 className="text-xl font-bold text-white mb-4">Adicionar Peer</h3>
        <form onSubmit={criar} className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 block mb-2">Tipo do equipamento</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {VENDORS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setTipo(v.id)}
                  className={`text-left px-3 py-2 rounded-lg border text-xs cursor-pointer transition-colors ${tipo === v.id ? "border-blue-500 bg-blue-500/10 text-blue-300" : "border-gray-700 hover:border-gray-500 text-gray-300 bg-[#0d1117]"}`}
                >
                  <span className={`inline-block px-1.5 py-0.5 rounded border ${v.badge}`}>{v.nome}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {tipo === "mikrotik" ? "Gera o script de instalação rápida para colar no roteador." : "Gera a configuração WireGuard (.conf). O peer fica pronto para escolher em Adicionar Equipamento."}
            </p>
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1">Identificação</label>
            <input
              autoFocus
              onFocus={(e) => e.target.select()}
              placeholder={tipo === "mikrotik" ? "Ex: RB-Torre-Centro" : "Ex: Omada-Loja-Centro"}
              className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:border-blue-500"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded text-gray-400 hover:text-white">Cancelar</button>
            <button type="submit" disabled={enviando} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50">
              {enviando ? "Gerando..." : tipo === "mikrotik" ? "Salvar e Gerar Script" : "Salvar e continuar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
