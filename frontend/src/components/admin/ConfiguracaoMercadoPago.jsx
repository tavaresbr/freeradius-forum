import React, { useState, useEffect } from "react";
import axios from "axios";

export default function ConfiguracaoMercadoPago() {
  const [form, setForm] = useState({
    public_key: "",
    access_token: "",
    client_id: "",
    client_secret: "",
    email_pagador: "",
    webhook_secret: "",
  });

  const token = localStorage.getItem("admin_token");
  const headers = { Authorization: `Bearer ${token}` };

useEffect(() => {
  axios.get("/api/empresa-config/mercadopago", { headers })
    .then(res => {
      setForm({
        public_key: res.data?.public_key || "",
        access_token: res.data?.access_token || "",
        client_id: res.data?.client_id || "",
        client_secret: res.data?.client_secret || "",
        email_pagador: res.data?.email_pagador || "",
        webhook_secret: res.data?.webhook_secret || "",
      });
    })
    .catch(err => console.error("Erro ao carregar config:", err));
}, []);
const salvar = () => {
  axios.post("/api/empresa-config/mercadopago", form, { headers })
    .then(() => alert("Configurações salvas com sucesso!"))
    .catch(() => alert("Erro ao salvar configurações."));
};

const testarConexao = () => {
  axios.post("/api/empresa-config/mercadopago/testar", {}, { headers })
    .then(res => {
      alert("✅ Comunicação OK com Mercado Pago!\nUsuário: " + res.data.usuario.nickname);
    })
    .catch(err => {
      console.error(err);
      alert("❌ Falha na comunicação com Mercado Pago.");
    });
};

  return (
    <div className="space-y-4">
      <div>
        <label className="block font-medium text-gray-300">Public Key</label>
        <input
          type="text"
          value={form.public_key}
          onChange={(e) => setForm({ ...form, public_key: e.target.value })}
          className="w-full p-2 bg-[#0d1117] border border-gray-700 text-white rounded focus:outline-none focus:border-blue-500 dado-sensivel"
        />
      </div>

      <div>
        <label className="block font-medium text-gray-300">Access Token</label>
        <input
          type="text"
          value={form.access_token}
          onChange={(e) => setForm({ ...form, access_token: e.target.value })}
          className="w-full p-2 bg-[#0d1117] border border-gray-700 text-white rounded focus:outline-none focus:border-blue-500 dado-sensivel"
        />
      </div>

      <div>
        <label className="block font-medium text-gray-300">Client ID</label>
        <input
          type="text"
          value={form.client_id}
          onChange={(e) => setForm({ ...form, client_id: e.target.value })}
          className="w-full p-2 bg-[#0d1117] border border-gray-700 text-white rounded focus:outline-none focus:border-blue-500 dado-sensivel"
        />
      </div>

      <div>
        <label className="block font-medium text-gray-300">Client Secret</label>
        <input
          type="text"
          value={form.client_secret}
          onChange={(e) => setForm({ ...form, client_secret: e.target.value })}
          className="w-full p-2 bg-[#0d1117] border border-gray-700 text-white rounded focus:outline-none focus:border-blue-500 dado-sensivel"
        />
      </div>
      <div>
        <label className="block font-medium text-gray-300">Email do Pagador (fallback)</label>
        <input
          type="email"
          value={form.email_pagador}
          onChange={(e) => setForm({ ...form, email_pagador: e.target.value })}
          placeholder="email@empresa.com"
          className="w-full p-2 bg-[#0d1117] border border-gray-700 text-white rounded focus:outline-none focus:border-blue-500 dado-sensivel"
        />
        <p className="text-xs text-gray-500 mt-1">Usado quando o cliente não preencher email</p>
      </div>
	  <div>
  <label className="block font-medium text-gray-300">Webhook URL</label>
  <input
    type="text"
    value={`${window.location.origin}/api/pagamentos/notificacao`}
    readOnly
    className="w-full p-2 border rounded bg-[#0d1117] text-gray-500"
  />
</div>
	  <div className="mb-4">
  <label className="block mb-1 font-medium text-gray-300">Webhook Secret</label>
  <input
    type="text"
    className="w-full bg-[#0d1117] border border-gray-700 text-white p-2 rounded focus:outline-none focus:border-blue-500 dado-sensivel"
    value={form.webhook_secret}
    onChange={(e) => setForm({ ...form, webhook_secret: e.target.value })}
  />
</div>


      <button
        onClick={salvar}
        className="bg-blue-600 text-white px-4 py-2 rounded">
        Salvar
      </button>
	  <button
  onClick={testarConexao}
  className="ml-2 bg-green-600 text-white px-4 py-2 rounded">
  Testar Conexão
</button>
    </div>
  );
}

