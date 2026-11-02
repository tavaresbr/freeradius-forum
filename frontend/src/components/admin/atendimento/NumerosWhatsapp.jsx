import React, { useEffect, useRef, useState } from "react";

const ESTADO = {
  open: ["Conectado", "bg-green-500"],
  connecting: ["Conectando", "bg-yellow-500"],
  close: ["Desconectado", "bg-red-500"],
  inexistente: ["Sem instância", "bg-gray-500"],
  desconhecido: ["Indisponível", "bg-gray-500"],
};

// Varios numeros de WhatsApp da empresa (o limite vem do plano). O numero principal e' gerenciado acima, na pagina.
export default function NumerosWhatsapp({ headers: base }) {
  const headers = { ...base, "Content-Type": "application/json" };
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [nome, setNome] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [qr, setQr] = useState(null); // { id, nome, base64 }
  const timer = useRef(null);

  const carregar = async () => {
    try {
      const res = await fetch("/api/whatsapp/numeros", { headers });
      const d = await res.json();
      if (!res.ok) { setErro(d.error || "Erro ao carregar os números"); return null; }
      setErro("");
      setDados(d);
      return d;
    } catch {
      setErro("Erro de conexão");
      return null;
    }
  };

  useEffect(() => { carregar(); return () => clearInterval(timer.current); }, []);

  const fecharQr = () => { clearInterval(timer.current); setQr(null); };

  const abrirQr = async (n) => {
    setErro("");
    try {
      const res = await fetch(`/api/whatsapp/numeros/${n.id}/qrcode`, { headers });
      const d = await res.json();
      if (!res.ok) { setErro(d.error || "Não foi possível gerar o QR code"); return; }
      if (d.base64) {
        setQr({ id: n.id, nome: n.nome, base64: d.base64 });
        clearInterval(timer.current);
        // fecha sozinho quando o celular conectar
        timer.current = setInterval(async () => {
          const novo = await carregar();
          if (novo?.numeros.find((x) => x.id === n.id)?.estado === "open") fecharQr();
        }, 5000);
      } else {
        await carregar();
      }
    } catch { setErro("Erro de conexão"); }
  };

  const adicionar = async (e) => {
    e.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setErro("");
    try {
      const res = await fetch("/api/whatsapp/numeros", { method: "POST", headers, body: JSON.stringify({ nome }) });
      const d = await res.json();
      if (!res.ok) { setErro(d.error || "Não foi possível adicionar o número"); return; }
      setNome("");
      await carregar();
      await abrirQr({ id: d.numero.id, nome: d.numero.nome });
    } catch { setErro("Erro de conexão"); }
    finally { setOcupado(false); }
  };

  const acao = async (n, caminho, metodo, confirma) => {
    if (confirma && !window.confirm(confirma)) return;
    setErro("");
    try {
      const res = await fetch(`/api/whatsapp/numeros/${n.id}${caminho}`, { method: metodo, headers });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setErro(d.error || "Não foi possível concluir");
    } catch { setErro("Erro de conexão"); }
    await carregar();
  };

  const renomear = async (n) => {
    const novo = window.prompt("Novo nome do número:", n.nome);
    if (novo == null || !novo.trim()) return;
    try {
      const res = await fetch(`/api/whatsapp/numeros/${n.id}`, { method: "PUT", headers, body: JSON.stringify({ nome: novo }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setErro(d.error || "Não foi possível renomear");
    } catch { setErro("Erro de conexão"); }
    await carregar();
  };

  if (!dados && !erro) return null;
  const limite = dados?.limite == null ? "ilimitado" : dados.limite;

  return (
    <div className="bg-[#1a1d27] rounded-xl border border-gray-800 p-6 mb-6" data-testid="numeros-whatsapp">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 className="text-lg font-semibold">Números de WhatsApp</h2>
          <p className="text-sm text-gray-400 mt-1">
            Conecte mais de um número e responda cada conversa pelo número em que ela chegou. Respostas automáticas, chatbot e envios em massa usam só o número principal.
          </p>
        </div>
        {dados && <span className="text-xs px-2 py-1 rounded-md border bg-gray-800 text-gray-300 border-gray-700">{dados.usados} de {limite} no plano</span>}
      </div>

      {erro && <p className="text-sm text-red-400 mb-3">{erro}</p>}

      <div className="space-y-2">
        {(dados?.numeros || []).map((n) => {
          const [rotulo, cor] = ESTADO[n.estado] || ESTADO.desconhecido;
          return (
            <div key={n.id} className="bg-[#0f111a] rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="font-medium truncate">{n.nome}</p>
                <p className="text-xs text-gray-500 font-mono truncate">{n.instance_name}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="flex items-center gap-2 text-sm"><span className={`w-2.5 h-2.5 rounded-full ${cor}`} />{rotulo}</span>
                {!n.principal && (
                  <>
                    {n.estado !== "open" && <button onClick={() => abrirQr(n)} className="px-3 py-1.5 bg-green-600/20 text-green-400 rounded text-xs cursor-pointer">Conectar (QR)</button>}
                    {n.estado === "open" && <button onClick={() => acao(n, "/logout", "POST", "Desconectar este WhatsApp? Será preciso ler o QR code de novo.")} className="px-3 py-1.5 bg-yellow-600/20 text-yellow-400 rounded text-xs cursor-pointer">Desconectar</button>}
                    <button onClick={() => acao(n, "/webhook/ativar", "POST")} className="px-3 py-1.5 bg-blue-600/20 text-blue-400 rounded text-xs cursor-pointer" title="Registra de novo o recebimento de mensagens deste número">Reativar recebimento</button>
                    <button onClick={() => renomear(n)} className="px-3 py-1.5 bg-gray-700/50 text-gray-300 rounded text-xs cursor-pointer">Renomear</button>
                    <button onClick={() => acao(n, "", "DELETE", `Remover o número "${n.nome}"? As conversas ficam no histórico, mas não dá mais para responder por ele.`)} className="px-3 py-1.5 bg-red-600/20 text-red-400 rounded text-xs cursor-pointer">Remover</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {dados && (dados.pode_adicionar ? (
        <form onSubmit={adicionar} className="mt-4 flex gap-2 flex-wrap">
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} required placeholder="Nome do novo número (ex.: Financeiro)"
            className="flex-1 min-w-0 bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm" />
          <button type="submit" disabled={ocupado || !nome.trim()} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm disabled:opacity-50 cursor-pointer">
            {ocupado ? "Criando..." : "Adicionar número"}
          </button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-yellow-400">Você usou todos os números do plano. Faça upgrade ou compre o adicional "+1 número de WhatsApp" na tela Assinatura.</p>
      ))}

      {qr && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6 w-full max-w-sm text-center">
            <h3 className="text-lg font-bold mb-1">Conectar “{qr.nome}”</h3>
            <p className="text-sm text-gray-400 mb-3">No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho.</p>
            <img src={qr.base64} alt="QR Code WhatsApp" className="mx-auto w-64 h-64 rounded-lg bg-white p-2" />
            <button onClick={() => { fecharQr(); carregar(); }} className="mt-4 px-4 py-2 bg-gray-700 text-gray-200 rounded-lg text-sm cursor-pointer">Fechar</button>
          </div>
        </div>
      )}
    </div>
  );
}
