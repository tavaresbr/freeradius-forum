import { useEffect, useState } from "react";
import useBranding from "../../hooks/useBranding";

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("admin_token")}` });

export default function IdentidadeSite() {
  const { nome, logoUrl, recarregar } = useBranding();
  const [campo, setCampo] = useState(nome);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setCampo(nome); }, [nome]);

  async function chamar(url, opts, ok) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(url, opts);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Erro ao salvar");
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
        <div className="bg-blue-950 rounded p-3 min-w-[140px] flex items-center justify-center">
          {logoUrl ? <img src={logoUrl} alt={nome} className="h-10 w-auto" /> : <span className="text-xs text-blue-200">Logo padrão</span>}
        </div>
        <label className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded cursor-pointer">
          Enviar logo
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={enviarLogo} disabled={busy} />
        </label>
        {logoUrl && <button disabled={busy} onClick={removerLogo} className="text-red-400 hover:text-red-300 text-sm">Remover logo</button>}
      </div>
      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-green-400" : "text-red-400"}`}>{msg.texto}</p>}
    </div>
  );
}
