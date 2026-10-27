import { Link } from "react-router-dom";

// Mostrado no lugar da tela quando o plano/adicionais da empresa nao incluem o recurso (SaaS Fase 2).
export default function RecursoBloqueado({ titulo, basePath }) {
  return (
    <div className="max-w-xl mx-auto mt-10 bg-[#1a1d27] border border-gray-800 rounded-xl p-8 text-center space-y-4" data-testid="recurso-bloqueado">
      <div className="text-4xl" aria-hidden="true">🔒</div>
      <h1 className="text-xl font-bold text-white">{titulo} não está incluído no seu plano</h1>
      <p className="text-sm text-gray-400">
        Contrate um plano que inclua este recurso ou compre o adicional mensal na tela de Assinatura.
      </p>
      <Link to={`${basePath}/assinatura`} className="inline-block bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-lg text-sm font-medium">
        Ver planos e adicionais
      </Link>
    </div>
  );
}
