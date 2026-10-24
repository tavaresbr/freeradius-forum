import React, { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import AdminLayout from "../../components/admin/AdminLayout";

const API = "";

// Catalogo de integracoes disponiveis; "configurado" vem do backend.
const CATALOGO = [
  {
    chave: "sgp",
    nome: "SGP",
    descricao: "Importe os clientes do seu SGP (sistema de gestão de provedores) para o cadastro de Clientes.",
    caminho: "sgp",
  },
];

export default function Integracoes() {
  const { empresaSlug } = useParams();
  const [status, setStatus] = useState({});
  const [erro, setErro] = useState("");
  const token = localStorage.getItem("admin_token");

  useEffect(() => {
    fetch(`${API}/api/integracoes`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((lista) => setStatus(Object.fromEntries(lista.map((i) => [i.chave, i.configurado]))))
      .catch(() => setErro("Não foi possível carregar o status das integrações"));
  }, [token]);

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold text-white">Integrações</h1>
          <p className="text-gray-400 text-sm mt-1">Conecte o Hotspot a outros sistemas da sua empresa</p>
        </div>
        {erro && <p className="text-red-400 text-sm">{erro}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {CATALOGO.map((i) => (
            <Link
              key={i.chave}
              to={`/admin/${empresaSlug}/integracoes/${i.caminho}`}
              className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 hover:bg-[#252b3b] transition-colors block"
            >
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold text-white">{i.nome}</h2>
                <span
                  className={`text-xs px-2 py-1 rounded-md border ${
                    status[i.chave]
                      ? "bg-green-900/40 text-green-400 border-green-800/50"
                      : "bg-gray-800 text-gray-400 border-gray-700"
                  }`}
                >
                  {status[i.chave] ? "Configurado" : "Não configurado"}
                </span>
              </div>
              <p className="text-sm text-gray-400">{i.descricao}</p>
            </Link>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
