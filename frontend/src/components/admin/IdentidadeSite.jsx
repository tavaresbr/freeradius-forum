import { useEffect, useState } from "react";
import useBranding, { ALTURAS } from "../../hooks/useBranding";

const LOCAIS = [["site", "Cabeçalho do site"], ["login", "Tela de login"], ["painel", "Barra lateral do painel"]];
const PRESETS = [["p", "P"], ["m", "M"], ["g", "G"], ["xg", "XG"]];

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("admin_token")}` });

export default function IdentidadeSite() {
  const { nome, logoUrl, tamanhos, recarregar } = useBranding();
  const [tam, setTam] = useState(tamanhos);
  const [campo, setCampo] = useState(nome);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setCampo(nome); }, [nome]);
  useEffect(() => { setTam(tamanhos); }, [tamanhos]);

  async function chamar(url, opts, ok) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(url, opts);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || d.error || "Erro ao salvar");
      await recarregar();
      setMsg({ ok: true, texto: ok });
    } catch (e) {
      setMsg({ ok: false, texto: e.message });
    } finally { setBusy(false); }
  }

  const salvarNome = () => chamar("/api/branding", {
    method: "PUT",
    headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify({ nome: campo }),
  }, "Nome atualizado.");

  const salvarTamanhos = () => chamar("/api/branding", {
    method: "PUT",
    headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify({ tamanhos: tam }),
  }, "Tamanhos atualizados.");

  const enviarLogo = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const fd = new FormData();
    fd.append("logo", f);
    chamar("/api/branding/logo", { method: "POST", headers: auth(), body: fd }, "Logo atualizada.");
  };

  const removerLogo = () => chamar("/api/branding/logo", { method: "DELETE", headers: auth() }, "Logo padrão restaurada.");

  return (
    <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4 mb-6">
      <h2 className="text-lg font-semibold">Identidade do site</h2>
      <p className="text-sm text-gray-500 mb-4">Nome e logo da plataforma (site, login e painel). Vale para todas as empresas.</p>
      <label className="block text-sm text-gray-400 mb-1">Nome do site</label>
      <div className="flex gap-2 mb-4">
        <input value={campo} maxLength={60} onChange={(e) => setCampo(e.target.value)}
          className="flex-1 bg-[#0f1117] border border-gray-700 rounded px-3 py-2 text-white" />
        <button disabled={busy || !campo.trim()} onClick={salvarNome}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded">Salvar</button>
      </div>
      <label className="block text-sm text-gray-400 mb-1">Logo (JPG, PNG ou WEBP, até 2 MB)</label>
      <div className="flex items-center gap-4 flex-wrap">
        <div className="bg-white border border-gray-200 rounded p-3 min-w-[140px] flex items-center justify-center">
          {logoUrl ? <img src={logoUrl} alt={nome} className="h-10 w-auto" /> : <span className="text-xs text-blue-200">Logo padrão</span>}
        </div>
        <label className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded cursor-pointer">
          Enviar logo
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={enviarLogo} disabled={busy} />
        </label>
        {logoUrl && <button disabled={busy} onClick={removerLogo} className="text-red-400 hover:text-red-300 text-sm">Remover logo</button>}
      </div>
      {logoUrl ? (
        <div className="mt-5">
          <label className="block text-sm text-gray-400 mb-2">Tamanho da logo em cada lugar</label>
          <div className="space-y-3">
            {LOCAIS.map(([local, rotulo]) => (
              <div key={local} className="flex flex-wrap items-center gap-3">
                <span className="w-56 text-sm text-gray-300">{rotulo}</span>
                <div className="inline-flex rounded-lg overflow-hidden border border-gray-700">
                  {PRESETS.map(([k, t]) => (
                    <button key={k} type="button" onClick={() => setTam({ ...tam, [local]: k })}
                      className={`px-3 py-1.5 text-sm cursor-pointer ${tam?.[local] === k ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}>{t}</button>
                  ))}
                </div>
                <div className="bg-white border border-gray-200 rounded p-2 flex items-center">
                  <img src={logoUrl} alt="" style={{ height: ALTURAS[tam?.[local]] || ALTURAS.m }} className="w-auto max-w-[240px] object-contain" />
                </div>
              </div>
            ))}
          </div>
          <button disabled={busy} onClick={salvarTamanhos}
            className="mt-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded">Salvar tamanhos</button>
        </div>
      ) : (
        <p className="mt-4 text-xs text-gray-500">Envie uma logo para escolher o tamanho em cada lugar (a logo padrão já tem tamanho fixo).</p>
      )}
      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-green-400" : "text-red-400"}`}>{msg.texto}</p>}
    </div>
  );
}
