import { useEffect, useState } from "react";
import useBranding, { ALTURAS } from "../../hooks/useBranding";

const LOCAIS = [["site", "Cabeçalho do site"], ["login", "Tela de login"], ["painel", "Barra lateral do painel"]];
const PRESETS = [["p", "P"], ["m", "M"], ["g", "G"], ["xg", "XG"]];

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("admin_token")}` });

export default function IdentidadeSite() {
  const { nome, logoUrl, faviconUrl, appleIconUrl, tamanhos, recarregar } = useBranding();
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

  const enviarIcone = (rota, ok) => (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const fd = new FormData();
    fd.append("arquivo", f);
    chamar(rota, { method: "POST", headers: auth(), body: fd }, ok);
  };
  const enviarFavicon = enviarIcone("/api/branding/favicon", "Favicon atualizado. Use Ctrl+F5 se a aba não mudar.");
  const enviarApple = enviarIcone("/api/branding/apple-icon", "Ícone do iPhone atualizado. No iPhone, refaça o \"Adicionar à Tela de Início\".");
  const removerIcone = (rota, ok) => () => chamar(rota, { method: "DELETE", headers: auth() }, ok);

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
        <div className="border border-gray-500/40 rounded p-3 min-w-[140px] flex items-center justify-center">
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
                <div className="border border-gray-500/40 rounded p-2 flex items-center">
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
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {[
          { titulo: "Favicon (aba do navegador)", dica: "PNG, ICO ou WEBP, até 512 KB (ideal 32×32 ou 48×48)", url: faviconUrl, accept: "image/png,image/x-icon,image/vnd.microsoft.icon,image/webp,.ico", onEnviar: enviarFavicon, onRemover: removerIcone("/api/branding/favicon", "Favicon padrão restaurado."), redondo: false },
          { titulo: "Ícone para iPhone (tela inicial)", dica: "PNG, até 1 MB (ideal 180×180, sem transparência)", url: appleIconUrl, accept: "image/png", onEnviar: enviarApple, onRemover: removerIcone("/api/branding/apple-icon", "Ícone do iPhone removido."), redondo: true },
        ].map((i) => (
          <div key={i.titulo}>
            <label className="block text-sm text-gray-400 mb-1">{i.titulo}</label>
            <div className="flex items-center gap-3 flex-wrap">
              <div className={`border border-gray-500/40 w-16 h-16 flex items-center justify-center overflow-hidden ${i.redondo ? "rounded-2xl" : "rounded"}`}>
                {i.url ? <img src={i.url} alt="" className="w-full h-full object-contain" /> : <span className="text-xs text-blue-200 text-center">Padrão</span>}
              </div>
              <label className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded cursor-pointer">
                Enviar
                <input type="file" accept={i.accept} className="hidden" onChange={i.onEnviar} disabled={busy} />
              </label>
              {i.url && <button disabled={busy} onClick={i.onRemover} className="text-red-400 hover:text-red-300 text-sm">Remover</button>}
            </div>
            <p className="text-xs text-gray-500 mt-1">{i.dica}</p>
          </div>
        ))}
      </div>
      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-green-400" : "text-red-400"}`}>{msg.texto}</p>}
    </div>
  );
}
