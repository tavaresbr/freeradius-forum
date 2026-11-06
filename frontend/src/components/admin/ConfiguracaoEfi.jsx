import React, { useState, useEffect } from "react";
import axios from "axios";

export default function ConfiguracaoEfi() {
  const [form, setForm] = useState({
    client_id: "",
    client_secret: "",
    chave_pix: "",
    ambiente: "sandbox",
    certificado_nome: "",
  });

  useEffect(() => {
    axios.get("/api/empresa-config/efi")
      .then(res => {
        setForm({
          client_id: res.data?.client_id || "",
          client_secret: res.data?.client_secret || "",
          chave_pix: res.data?.chave_pix || "",
          ambiente: res.data?.ambiente || "sandbox",
          certificado_nome: res.data?.certificado_nome || "",
        });
      })
      .catch(err => console.error("Erro ao carregar config EFI:", err));
  }, []);

  const salvar = () => {
    axios.post("/api/empresa-config/efi", form)
      .then(() => alert("Configurações EFI salvas com sucesso!"))
      .catch(() => alert("Erro ao salvar configurações EFI."));
  };

  return (
    <div className="space-y-4">
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
        <label className="block font-medium text-gray-300">Chave PIX</label>
        <input
          type="text"
          value={form.chave_pix}
          onChange={(e) => setForm({ ...form, chave_pix: e.target.value })}
          className="w-full p-2 bg-[#0d1117] border border-gray-700 text-white rounded focus:outline-none focus:border-blue-500 dado-sensivel"
        />
      </div>

      <div>
        <label className="block font-medium text-gray-300">Ambiente</label>
        <select
          value={form.ambiente}
          onChange={(e) => setForm({ ...form, ambiente: e.target.value })}
          className="w-full p-2 bg-[#0d1117] border border-gray-700 text-white rounded focus:outline-none focus:border-blue-500"
        >
          <option value="sandbox">Sandbox</option>
          <option value="producao">Produção</option>
        </select>
      </div>

      <div>
        <label className="block font-medium text-gray-300">Nome do Certificado</label>
        <input
          type="text"
          value={form.certificado_nome}
          onChange={(e) => setForm({ ...form, certificado_nome: e.target.value })}
          className="w-full p-2 bg-[#0d1117] border border-gray-700 text-white rounded focus:outline-none focus:border-blue-500 dado-sensivel"
        />
      </div>

      <button
        onClick={salvar}
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-500 transition-colors"
      >
        Salvar
      </button>
    </div>
  );
}
