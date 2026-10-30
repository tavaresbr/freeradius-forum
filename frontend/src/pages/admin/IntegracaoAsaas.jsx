import React from "react";
import { Link, useParams } from "react-router-dom";
import AdminLayout from "../../components/admin/AdminLayout";
import ConfiguracaoAsaas from "../../components/admin/ConfiguracaoAsaas";

export default function IntegracaoAsaas() {
  const { empresaSlug } = useParams();
  return (
    <AdminLayout>
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Integração Asaas</h1>
            <p className="text-gray-400 text-sm mt-1">Configurações › Integrações › Asaas</p>
          </div>
          <Link
            to={`/admin/${empresaSlug}/integracoes`}
            className="px-4 py-2 bg-[#1a1d27] border border-gray-800 text-gray-300 rounded-lg hover:bg-[#252b3b] transition-colors text-sm"
          >
            Voltar
          </Link>
        </div>
        <ConfiguracaoAsaas />
      </div>
    </AdminLayout>
  );
}
