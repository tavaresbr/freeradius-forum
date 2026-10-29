import React, { useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import IdentidadeSite from "../../components/admin/IdentidadeSite";
import { useParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";

const acoes = [
  {
    chave: "radius",
    titulo: "Limpar Usuários RADIUS",
    endpoint: "/api/limpeza/radius",
    aviso: "Todos os usuários RADIUS da empresa serão removidos. Clientes conectados perderão o acesso e precisarão refazer cadastro/pagamento.",
  },
  {
    chave: "pagamentos",
    titulo: "Limpar Pagamentos",
    endpoint: "/api/limpeza/pagamentos",
    aviso: "Apaga TODO o histórico financeiro de pagamentos da empresa. Esses registros podem ser exigidos em disputas de cobrança e fiscalização.",
  },
  {
    chave: "lgpd",
    titulo: "Limpar Logins LGPD",
    endpoint: "/api/limpeza/lgpd",
    aviso: "ATENÇÃO: apaga as PROVAS DE CONSENTIMENTO exigidas pela LGPD. Sem elas, a empresa não consegue comprovar que o titular autorizou o tratamento dos dados. Exporte o CSV na tela Cadastros LGPD antes de limpar.",
  },
];

const PALAVRA_CONFIRMACAO = "LIMPAR";

export default function Configuracoes() {
  const { isSuperAdmin, user } = useAuth();
  const { empresaSlug } = useParams();
  const [modal, setModal] = useState(null);
  const [confirmacao, setConfirmacao] = useState("");
  const [loading, setLoading] = useState(false);

  const token = localStorage.getItem("admin_token");

  const executarAcao = async (acao) => {
    setLoading(true);
    try {
      const res = await fetch(acao.endpoint, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const contentType = res.headers.get("content-type");
      if (!res.ok) {
        const erroTexto = contentType?.includes("application/json")
          ? (await res.json()).message
          : await res.text();
        throw new Error(erroTexto || "Erro desconhecido.");
      }

      const data = await res.json();
      alert(data.message);
    } catch (err) {
      alert("Erro ao executar ação: " + err.message);
      console.error(err);
    } finally {
      setLoading(false);
      setModal(null);
    }
  };

  return (
    <AdminLayout>
      <h1 className="text-2xl font-semibold mb-6">Configurações</h1>

      <IdentidadeSite empresa={empresaSlug || user?.empresa_slug || "default"} />

      {isSuperAdmin && <IdentidadeSite />}

      <div className="space-y-4">
        {acoes.map((acao) => (
          <div key={acao.chave} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4 flex justify-between items-center">
            <div>
              <h2 className="text-lg font-semibold">{acao.titulo}</h2>
              <p className="text-sm text-gray-500">Esta ação é irreversível. Use com cautela.</p>
            </div>
            <button
              className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
              onClick={() => { setConfirmacao(""); setModal(acao); }}
            >
              Executar
            </button>
          </div>
        ))}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#1a1d27] rounded-xl border border-gray-700 p-6 max-w-md w-full">
            <h2 className="text-lg font-bold mb-3">Confirmar Ação</h2>
            <p className="mb-3">Tem certeza que deseja <strong>{modal.titulo}</strong>? Esta ação não pode ser desfeita.</p>
            <p className="mb-4 text-sm text-red-400 bg-red-900/20 border border-red-800/50 rounded p-3">{modal.aviso}</p>
            <label className="block text-sm text-gray-400 mb-2">
              Para confirmar, digite <strong className="text-white">{PALAVRA_CONFIRMACAO}</strong> abaixo:
            </label>
            <input
              autoFocus
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 mb-5 focus:outline-none focus:border-red-500"
              placeholder={PALAVRA_CONFIRMACAO}
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setModal(null); setConfirmacao(""); }}
                className="px-4 py-2 rounded border border-gray-700"
              >
                Cancelar
              </button>
              <button
                onClick={() => executarAcao(modal)}
                className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={loading || confirmacao.trim().toUpperCase() !== PALAVRA_CONFIRMACAO}
              >
                {loading ? "Executando..." : "Confirmar Limpeza"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

