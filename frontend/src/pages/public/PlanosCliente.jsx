import { useSearchParams } from "react-router-dom";
import React, { useEffect, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";

export default function PlanosCliente() {
  const [searchParams] = useSearchParams();
  const mac = searchParams.get("mac");
  const ip = searchParams.get("ip");
  const mikrotikId = searchParams.get("mikrotik_id");
  const empresaId = searchParams.get("empresa_id");
  const clienteId = searchParams.get("cliente_id");
  const clienteNome = searchParams.get("cliente_nome");
  // portal_id explicito (vindo do redirect entre portais).
  // Quando o cliente vem do portal Login -> Planos via "Clique aqui",
  // esse id identifica o portal Planos correto pra carregar configs.
  const portalId = searchParams.get("portal_id");
  const [planos, setPlanos] = useState([]);
  const navigate = useNavigate();
  const [cfg, setCfg] = useState({});

  useEffect(() => {
    if (empresaId) {
      fetch(`/api/portal-config/planos?empresa_id=${empresaId}`)
        .then(r => r.json()).then(setCfg).catch(() => {});
    }
  }, [empresaId]);

  useEffect(() => {
    const carregarPlanos = async () => {
      try {
        // Filtrar planos pela empresa via mikrotik_id ou empresa_id
        const params = new URLSearchParams();
        if (mikrotikId) params.set("mikrotik_id", mikrotikId);
        else if (empresaId) params.set("empresa_id", empresaId);

        const res = await fetch(`/api/planos-publicos?${params.toString()}`);
        const data = await res.json();
        const ativos = data.filter((p) => p.ativo === 1);
        setPlanos(ativos);
      } catch (err) {
        console.error("Erro ao carregar planos:", err);
      }
    };

    carregarPlanos();
  }, [mikrotikId, empresaId]);

  const bgStyle = cfg.cor_fundo_1 ? { background: `linear-gradient(135deg, ${cfg.cor_fundo_1}, ${cfg.cor_fundo_2 || cfg.cor_fundo_1})` } : undefined;
  const btnStyle = cfg.cor_botao ? { backgroundColor: cfg.cor_botao } : undefined;
  const textColor = cfg.cor_fundo_1 ? 'text-white' : 'text-gray-800';
  const subtextColor = cfg.cor_fundo_1 ? 'text-gray-200' : 'text-gray-600';

  // Redireciona para cadastro se não tem cliente_id
  if (!clienteId) {
    const params = new URLSearchParams({ mac: mac || '', ip: ip || '', mikrotik_id: mikrotikId || '', empresa_id: empresaId || '' });
    if (portalId) params.set("portal_id", portalId);
    return <Navigate to={`/cadastro-cliente?${params.toString()}`} replace />;
  }

  return (
    <div className={`min-h-screen flex flex-col items-center px-4 py-10 ${!bgStyle ? 'bg-gradient-to-br from-gray-50 via-blue-50 to-gray-100' : ''}`} style={bgStyle}>
      {/* Header */}
      <div className="text-center mb-10 animate-fade-in">
        {cfg.logo_url ? (
          <img src={cfg.logo_url} alt="Logo" className="max-h-20 mx-auto mb-6" />
        ) : (
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full mb-4 shadow-lg" style={cfg.cor_botao ? { background: cfg.cor_botao } : {}}>
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        <h1 className={`text-4xl font-bold mb-3 ${textColor}`}>
          {cfg.titulo || 'Escolha seu Plano'}
        </h1>
        <p className={`max-w-2xl mx-auto ${subtextColor}`}>
          {cfg.subtitulo || 'Selecione o plano ideal para sua conexão e navegue com velocidade e qualidade'}
        </p>
      </div>

      {/* Info do dispositivo */}
      {mac && ip && (
        <div className="mb-8 bg-white border border-blue-200 rounded-xl p-4 shadow-sm max-w-md w-full animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="flex-1 text-sm">
              <p className="text-gray-600 mb-1">
                <span className="font-medium text-gray-700">MAC:</span>{" "}
                <span className="font-mono text-gray-800">{mac}</span>
              </p>
              <p className="text-gray-600">
                <span className="font-medium text-gray-700">IP:</span>{" "}
                <span className="font-mono text-gray-800">{ip}</span>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Grid de Planos */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-6xl">
        {planos.map((plano, index) => (
          <div
            key={plano.id}
            className="bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 p-6 flex flex-col justify-between border border-gray-100 hover:-translate-y-1 animate-fade-in"
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <div>
              {/* Cabeçalho do Card */}
              <div className="mb-4">
                <div className="inline-flex items-center justify-center w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl mb-3 shadow-md">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-gray-800 mb-2">
                  {plano.nome}
                </h2>
                <p className="text-sm text-gray-500 leading-relaxed">
                  {plano.descricao}
                </p>
              </div>

              {/* Features do Plano */}
              <div className="space-y-3 mb-6">
                <div className="flex items-center gap-3 text-gray-700">
                  <div className="flex-shrink-0 w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 uppercase font-medium">Duração</p>
                    <p className="text-sm font-semibold">{plano.duracao_minutos} minutos</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-gray-700">
                  <div className="flex-shrink-0 w-8 h-8 bg-green-50 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 uppercase font-medium">Upload</p>
                    <p className="text-sm font-semibold">{plano.velocidade_up} Mbps</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-gray-700">
                  <div className="flex-shrink-0 w-8 h-8 bg-purple-50 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16l-4-4m0 0l4-4m-4 4h18" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 uppercase font-medium">Download</p>
                    <p className="text-sm font-semibold">{plano.velocidade_down} Mbps</p>
                  </div>
                </div>
              </div>

              {/* Preço */}
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 mb-6 border border-blue-100">
                <p className="text-xs text-gray-600 uppercase font-medium mb-1">Valor</p>
                <p className="text-3xl font-bold text-blue-600">
                  R$ {(parseFloat(plano.valor) / 100).toFixed(2)}
                </p>
              </div>
            </div>

            {/* Botão de Ação */}
            <button
              onClick={() => navigate(`/pagamento/${plano.id}?mac=${encodeURIComponent(mac || "")}&ip=${encodeURIComponent(ip || "")}&mikrotik_id=${encodeURIComponent(mikrotikId || '')}&empresa_id=${encodeURIComponent(empresaId || '')}&cliente_id=${encodeURIComponent(clienteId ?? "")}${portalId ? `&portal_id=${encodeURIComponent(portalId)}` : ''}`)}
              className={`w-full text-white font-semibold py-3.5 rounded-xl shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200 flex items-center justify-center gap-2 ${!btnStyle ? 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800' : 'hover:opacity-90'}`}
              style={btnStyle}
            >
              <span>{cfg.texto_botao || 'Escolher este Plano'}</span>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {planos.length === 0 && (
        <div className="text-center py-16 animate-fade-in">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gray-100 rounded-full mb-4">
            <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          </div>
          <p className={`text-lg ${cfg.cor_fundo_1 ? 'text-gray-300' : 'text-gray-500'}`}>Nenhum plano disponível no momento</p>
        </div>
      )}

      {/* Footer */}
      <div className={`mt-12 text-center text-sm ${cfg.cor_fundo_1 ? 'text-gray-400' : 'text-gray-500'}`}>
        <p>💳 {cfg.texto_rodape || 'Pagamento 100% seguro • 🔒 Conexão protegida'}</p>
      </div>
    </div>
  );
}
