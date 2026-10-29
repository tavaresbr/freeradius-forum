import React, { useCallback, useEffect, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";

const inputCls = "w-full bg-[#0d1117] border border-gray-700 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500 text-sm";
const btnPrimario = "bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-500 disabled:opacity-50 cursor-pointer";
const btnSecundario = "border border-gray-700 text-gray-300 px-3 py-2 rounded text-sm hover:bg-[#252b3b] disabled:opacity-50 cursor-pointer";
const VAZIO = { id: null, codigo: "", tipo: "percentual", valor: "", plano_id: "", valido_ate: "", max_usos: "", ativo: true };
const reais = (c) => (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const descricao = (c) => (c.tipo === "percentual" ? `${c.valor}%` : reais(c.valor));
const dataBr = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "Sem prazo");

// Cupons de desconto do portal de planos. O calculo e a validacao sao do servidor.
export default function Cupons() {
  const token = localStorage.getItem("admin_token");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const [lista, setLista] = useState([]);
  const [planos, setPlanos] = useState([]);
  const [form, setForm] = useState(VAZIO);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/cupons", { headers });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tipo: "erro", texto: d.error || "Não foi possível carregar" }); return; }
      setLista(Array.isArray(d) ? d : []);
    } catch { setMsg({ tipo: "erro", texto: "Erro de conexão" }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    carregar();
    fetch("/api/planos", { headers }).then((r) => r.json()).then((d) => setPlanos(Array.isArray(d) ? d : d.data || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregar]);

  const set = (campo, valor) => { setMsg(null); setForm((f) => ({ ...f, [campo]: valor })); };

  const editar = (c) => setForm({
    id: c.id, codigo: c.codigo, tipo: c.tipo,
    valor: c.tipo === "valor" ? (c.valor / 100).toFixed(2).replace(".", ",") : String(c.valor),
    plano_id: c.plano_id ? String(c.plano_id) : "", valido_ate: c.valido_ate ? String(c.valido_ate).slice(0, 10) : "",
    max_usos: c.max_usos ? String(c.max_usos) : "", ativo: !!c.ativo,
  });

  const salvar = async (e) => {
    e.preventDefault();
    setMsg(null); setBusy(true);
    const valor = form.tipo === "valor" ? Math.round(parseFloat(String(form.valor).replace(",", ".") || "0") * 100) : Number(form.valor);
    const corpo = { codigo: form.codigo, tipo: form.tipo, valor, plano_id: form.plano_id || null, valido_ate: form.valido_ate || null, max_usos: form.max_usos || null, ativo: form.ativo };
    try {
      const r = await fetch(form.id ? `/api/cupons/${form.id}` : "/api/cupons", { method: form.id ? "PUT" : "POST", headers, body: JSON.stringify(corpo) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tipo: "erro", texto: d.error || "Não foi possível salvar" }); return; }
      setForm(VAZIO); setMsg({ tipo: "ok", texto: "Cupom salvo." }); carregar();
    } catch { setMsg({ tipo: "erro", texto: "Erro de conexão" }); }
    finally { setBusy(false); }
  };

  const excluir = async (c) => {
    if (!window.confirm(`Excluir o cupom ${c.codigo}?`)) return;
    setMsg(null);
    try {
      const r = await fetch(`/api/cupons/${c.id}`, { method: "DELETE", headers });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tipo: "erro", texto: d.error || "Não foi possível excluir" }); return; }
      carregar();
    } catch { setMsg({ tipo: "erro", texto: "Erro de conexão" }); }
  };

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-xl font-bold text-white">Cupons de desconto</h1>
          <p className="text-sm text-gray-400 mt-1">O cliente digita o código na tela de pagamento do portal. O desconto é calculado pelo servidor e o plano nunca fica abaixo de R$ 1,00. Cada CPF usa o mesmo cupom uma única vez.</p>
        </div>

        <form onSubmit={salvar} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-gray-200">{form.id ? "Editar cupom" : "Novo cupom"}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Código</label>
              <input value={form.codigo} onChange={(e) => set("codigo", e.target.value.toUpperCase())} maxLength={32} placeholder="BEMVINDO10" className={inputCls} required />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Tipo de desconto</label>
              <select value={form.tipo} onChange={(e) => set("tipo", e.target.value)} className={inputCls}>
                <option value="percentual">Percentual (%)</option>
                <option value="valor">Valor fixo (R$)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">{form.tipo === "percentual" ? "Percentual (1 a 99)" : "Desconto em R$"}</label>
              <input value={form.valor} onChange={(e) => set("valor", e.target.value)} inputMode="decimal" placeholder={form.tipo === "percentual" ? "10" : "2,00"} className={inputCls} required />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Vale para</label>
              <select value={form.plano_id} onChange={(e) => set("plano_id", e.target.value)} className={inputCls}>
                <option value="">Todos os planos</option>
                {planos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Válido até (opcional)</label>
              <input type="date" value={form.valido_ate} onChange={(e) => set("valido_ate", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Limite de usos (opcional)</label>
              <input type="number" min={1} value={form.max_usos} onChange={(e) => set("max_usos", e.target.value)} className={inputCls} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
            <input type="checkbox" checked={form.ativo} onChange={(e) => set("ativo", e.target.checked)} /> Cupom ativo
          </label>
          {msg && <p className={`text-sm ${msg.tipo === "ok" ? "text-green-400" : "text-red-400"}`}>{msg.texto}</p>}
          <div className="flex gap-2 flex-wrap">
            <button type="submit" disabled={busy} className={btnPrimario}>{busy ? "Salvando..." : "Salvar cupom"}</button>
            {form.id && <button type="button" className={btnSecundario} onClick={() => { setForm(VAZIO); setMsg(null); }}>Cancelar edição</button>}
          </div>
        </form>

        <div className="bg-[#1a1d27] border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="text-gray-400 border-b border-gray-800">
              <tr><th className="p-3">Código</th><th className="p-3">Desconto</th><th className="p-3">Plano</th><th className="p-3">Validade</th><th className="p-3">Usos</th><th className="p-3">Situação</th><th className="p-3">Ações</th></tr>
            </thead>
            <tbody className="text-gray-200">
              {lista.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-gray-500">Nenhum cupom cadastrado.</td></tr>}
              {lista.map((c) => (
                <tr key={c.id} className="border-b border-gray-800/60">
                  <td className="p-3 font-mono">{c.codigo}</td>
                  <td className="p-3">{descricao(c)}</td>
                  <td className="p-3">{c.plano_nome || "Todos"}</td>
                  <td className="p-3">{dataBr(c.valido_ate)}</td>
                  <td className="p-3">{c.usos}{c.max_usos ? ` / ${c.max_usos}` : ""}</td>
                  <td className="p-3">{c.ativo ? <span className="text-green-400">Ativo</span> : <span className="text-gray-500">Inativo</span>}</td>
                  <td className="p-3 whitespace-nowrap">
                    <button onClick={() => editar(c)} className="text-blue-400 hover:text-blue-300 mr-3 cursor-pointer">Editar</button>
                    <button onClick={() => excluir(c)} className="text-red-400 hover:text-red-300 cursor-pointer">Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
