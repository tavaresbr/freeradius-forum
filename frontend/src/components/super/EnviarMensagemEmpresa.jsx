import { useState } from "react";

// Modelos de mensagem do dono da plataforma para a empresa. Variaveis trocadas no servidor:
// {{nome}} {{empresa}} {{plano}} {{trial_ate}} {{vence_em}} {{link_painel}}.
export const MODELOS = [
  { rotulo: "Boas-vindas", texto: "Olá, {{nome}}! Bem-vindo(a) à Apex Telecom. Qualquer dúvida na configuração é só responder aqui." },
  { rotulo: "Precisa de ajuda?", texto: "Olá, {{nome}}! Tudo certo com a conta {{empresa}}? Se precisar de ajuda para conectar seu equipamento, estou à disposição." },
  { rotulo: "Teste terminando", texto: "Olá, {{nome}}! Seu teste do plano {{plano}} termina em {{trial_ate}}. Para continuar usando, é só assinar pelo painel: {{link_painel}}" },
  { rotulo: "Cobrança", texto: "Olá, {{nome}}! Sua assinatura vence em {{vence_em}}. Você pode renovar pelo painel (menu Assinatura): {{link_painel}}" },
];

export default function EnviarMensagemEmpresa({ empresa, req, onFechar, onEnviada }) {
  const [texto, setTexto] = useState(MODELOS[0].texto);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  const enviar = async (ev) => {
    ev.preventDefault();
    if (!window.confirm(`Enviar esta mensagem para ${empresa.nome} (${empresa.telefone})?`)) return;
    setEnviando(true);
    setErro("");
    try {
      const r = await req("/whatsapp", { method: "POST", body: JSON.stringify({ texto }) });
      if (r.ok) { onEnviada(r.corpo.message || "Mensagem enviada."); return; }
      setErro(r.corpo.message || "Não foi possível enviar.");
    } catch {
      setErro("Erro de conexão.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <form onSubmit={enviar} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold text-white mb-1">Enviar mensagem pelo WhatsApp</h2>
        <p className="text-gray-500 text-sm mb-4">Sai pelo número da plataforma. Para {empresa.nome}.</p>
        {erro && <p className="text-red-400 text-sm mb-3 bg-red-900/20 p-2 rounded">{erro}</p>}
        <div className="flex flex-wrap gap-2 mb-3">
          {MODELOS.map((m) => (
            <button key={m.rotulo} type="button" onClick={() => setTexto(m.texto)}
              className="px-3 py-1 rounded-full border border-gray-700 text-gray-300 hover:bg-gray-800 text-xs">{m.rotulo}</button>
          ))}
        </div>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={7} maxLength={1000} required
          className="w-full min-w-0 px-3 py-2 bg-[#0f111a] border border-gray-800 rounded-lg text-sm text-gray-200" />
        <p className="text-gray-600 text-xs mt-1">{texto.length}/1000 · Variáveis: {"{{nome}} {{empresa}} {{plano}} {{trial_ate}} {{vence_em}} {{link_painel}}"}</p>
        <div className="flex justify-end gap-3 mt-4">
          <button type="button" onClick={onFechar} className="px-4 py-2 rounded-lg text-sm bg-gray-700 text-gray-300">Cancelar</button>
          <button type="submit" disabled={enviando || !texto.trim()} className="px-4 py-2 rounded-lg text-sm bg-green-600 text-white hover:bg-green-500 disabled:opacity-50">
            {enviando ? "Enviando..." : "Enviar"}
          </button>
        </div>
      </form>
    </div>
  );
}
