import { useRef, useState } from "react";
import useLogoEmpresa from "../../hooks/useLogoEmpresa";

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("admin_token")}` });

// Configuracoes > Logomarca da empresa: cada empresa troca a sua, sem afetar as outras.
export default function LogoEmpresa({ slug }) {
  const { logoUrl, recarregar } = useLogoEmpresa(slug);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);

  const enviar = async (e) => {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.append("logo", arquivo);
      const r = await fetch("/api/empresas/minha/logo", { method: "POST", headers: auth(), body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || "Não foi possível enviar a imagem.");
      await recarregar();
      setMsg({ ok: true, texto: "Logomarca atualizada." });
    } catch (err) {
      setMsg({ ok: false, texto: err.message });
    } finally { setBusy(false); }
  };

  const remover = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/empresas/minha/logo", { method: "DELETE", headers: auth() });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Não foi possível remover.");
      await recarregar();
      setMsg({ ok: true, texto: "Logomarca removida. O painel volta a usar a logo padrão." });
    } catch (err) {
      setMsg({ ok: false, texto: err.message });
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4 mb-6">
      <h2 className="text-lg font-semibold text-white">Logomarca da empresa</h2>
      <p className="text-sm text-gray-400 mb-3">Aparece no painel da sua empresa. Não altera as outras empresas. JPG, PNG ou WEBP, até 2 MB.</p>
      <div className="flex flex-wrap items-center gap-4">
        <div className="h-20 min-w-[120px] max-w-[240px] rounded-lg border border-gray-700 bg-white flex items-center justify-center p-2">
          {logoUrl ? <img src={logoUrl} alt="Logomarca" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-gray-500">Logo padrão</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={enviar} />
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded disabled:opacity-50">
            {busy ? "Enviando..." : logoUrl ? "Trocar logomarca" : "Enviar logomarca"}
          </button>
          {logoUrl && (
            <button type="button" disabled={busy} onClick={remover} className="border border-red-800/50 text-red-400 px-4 py-2 rounded hover:bg-red-900/20 disabled:opacity-50">Remover</button>
          )}
        </div>
      </div>
      {msg && <p className={`text-sm mt-3 ${msg.ok ? "text-green-400" : "text-red-500"}`}>{msg.texto}</p>}
    </div>
  );
}
