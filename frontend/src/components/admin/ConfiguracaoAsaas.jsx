import React, { useState, useEffect } from "react";
import axios from "axios";

const campo = "w-full p-2 bg-[#0d1117] border border-gray-700 text-white rounded focus:outline-none focus:border-blue-500";

export default function ConfiguracaoAsaas() {
  const [form, setForm] = useState({ api_key: "", ambiente: "producao", ativo: "0", cartao: "0" });
  const [webhookUrl, setWebhookUrl] = useState("");
  const [msg, setMsg] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const headers = { Authorization: `Bearer ${localStorage.getItem("admin_token")}` };

  useEffect(() => {
    axios.get("/api/empresa-config/asaas", { headers })
      .then((res) => setForm({
        api_key: res.data?.api_key || "",
        ambiente: res.data?.ambiente || "producao",
        ativo: res.data?.ativo === "1" ? "1" : "0",
        cartao: res.data?.cartao === "1" ? "1" : "0",
      }))
      .catch(() => setMsg({ ok: false, texto: "Não foi possível carregar a configuração." }));
    axios.get("/api/empresa-config/asaas/webhook", { headers })
      .then((res) => setWebhookUrl(res.data?.url || ""))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const executar = async (fn, okTexto) => {
    setOcupado(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: true, texto: typeof okTexto === "function" ? okTexto(r) : okTexto });
    } catch (e) {
      setMsg({ ok: false, texto: e.response?.data?.message || "Erro ao comunicar com o servidor." });
    } finally {
      setOcupado(false);
    }
  };

  const salvar = () =>
    executar(() => axios.post("/api/empresa-config/asaas", form, { headers }), "Configurações salvas.");
  const testar = () =>
    executar(
      () => axios.post("/api/empresa-config/asaas/testar", {}, { headers }),
      (r) => `Comunicação OK com o Asaas (${r.data.ambiente === "sandbox" ? "sandbox" : "produção"}).`
    );
  const ativarWebhook = () =>
    executar(
      () => axios.post("/api/empresa-config/asaas/webhook/ativar", {}, { headers }),
      "Webhook registrado na sua conta Asaas."
    );

  return (
    <div className="space-y-4">
      <div className="bg-[#1a1d27] border border-gray-800 rounded-lg p-4 text-sm text-gray-400">
        PIX e cartão podem ser ligados separadamente; o que ficar desligado continua pelo Mercado Pago. No PIX o cliente
        precisa de um CPF válido; no cartão o cadastro precisa ter e-mail e telefone, e o titular informa CEP e número.
      </div>

      <div>
        <label className="block font-medium text-gray-300">Chave de API</label>
        <input
          type="text"
          value={form.api_key}
          onChange={(e) => setForm({ ...form, api_key: e.target.value })}
          placeholder="$aact_..."
          className={campo}
        />
        <p className="text-xs text-gray-500 mt-1">Asaas › Integrações › Chaves de API.</p>
      </div>

      <div>
        <label className="block font-medium text-gray-300">Ambiente</label>
        <select value={form.ambiente} onChange={(e) => setForm({ ...form, ambiente: e.target.value })} className={campo}>
          <option value="producao">Produção</option>
          <option value="sandbox">Sandbox (testes)</option>
        </select>
      </div>

      <label className="flex items-center gap-2 text-gray-300">
        <input
          type="checkbox"
          checked={form.ativo === "1"}
          onChange={(e) => setForm({ ...form, ativo: e.target.checked ? "1" : "0" })}
        />
        Usar o Asaas para cobrar o PIX do portal
      </label>

      <label className="flex items-center gap-2 text-gray-300">
        <input
          type="checkbox"
          checked={form.cartao === "1"}
          onChange={(e) => setForm({ ...form, cartao: e.target.checked ? "1" : "0" })}
        />
        Usar o Asaas para cobrar o cartão de crédito do portal
      </label>

      <div>
        <label className="block font-medium text-gray-300">URL do webhook</label>
        <input type="text" value={webhookUrl} readOnly className="w-full p-2 border rounded bg-[#0d1117] text-gray-500" />
        <p className="text-xs text-gray-500 mt-1">
          Use “Registrar webhook” (depois de salvar a chave) ou cadastre esta URL em Asaas › Integrações › Webhooks, com os
          eventos de cobrança confirmada/recebida. Mesmo sem o webhook o portal confirma o pagamento sozinho enquanto o
          cliente aguarda.
        </p>
      </div>

      {msg && <p className={`text-sm ${msg.ok ? "text-green-400" : "text-red-400"}`}>{msg.texto}</p>}

      <div className="flex flex-wrap gap-2">
        <button onClick={salvar} disabled={ocupado} className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50">
          Salvar
        </button>
        <button onClick={testar} disabled={ocupado} className="bg-green-600 text-white px-4 py-2 rounded disabled:opacity-50">
          Testar conexão
        </button>
        <button onClick={ativarWebhook} disabled={ocupado} className="bg-gray-700 text-white px-4 py-2 rounded disabled:opacity-50">
          Registrar webhook
        </button>
      </div>
    </div>
  );
}
