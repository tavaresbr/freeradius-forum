import React, { useState, useEffect, useRef } from "react";

const ROTULO = { imagem: "Imagem", audio: "Áudio", video: "Vídeo", documento: "Documento" };

// Baixa a midia com o token (a tag <img>/<audio> nao manda Authorization) e mostra como blob.
// Imagem carrega sozinha; audio, video e documento so ao clicar (nao baixa arquivo grande a cada polling).
export default function MidiaMensagem({ mensagem }) {
  const { id, tipo, midia_nome: nome } = mensagem;
  const [url, setUrl] = useState(null);
  const [estado, setEstado] = useState(tipo === "imagem" ? "carregando" : "parado"); // parado | carregando | ok | erro
  const urlRef = useRef(null);

  const carregar = async () => {
    setEstado("carregando");
    try {
      const res = await fetch(`/api/atendimento/midia/${id}`, { headers: { Authorization: `Bearer ${localStorage.getItem("admin_token")}` } });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      setUrl(urlRef.current);
      setEstado("ok");
    } catch {
      setEstado("erro");
    }
  };

  useEffect(() => {
    if (tipo === "imagem") carregar();
    return () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const baixar = () => {
    const a = document.createElement("a");
    a.href = url;
    a.download = nome || "arquivo";
    a.click();
  };

  if (estado === "erro") {
    return (
      <div className="text-xs">
        <span className="opacity-80">Não foi possível carregar o arquivo. </span>
        <button onClick={carregar} className="underline cursor-pointer">Tentar de novo</button>
      </div>
    );
  }
  if (estado === "carregando") return <p className="text-xs opacity-80">Carregando…</p>;

  if (estado === "parado") {
    return (
      <button onClick={carregar} className="flex items-center gap-2 text-left px-3 py-2 rounded-lg bg-black/10 hover:bg-black/20 cursor-pointer max-w-full">
        <span>{{ audio: "🎤", video: "🎥", documento: "📄" }[tipo] || "📎"}</span>
        <span className="min-w-0">
          <span className="block text-sm truncate">{nome || ROTULO[tipo] || "Arquivo"}</span>
          <span className="block text-xs opacity-70">{tipo === "documento" ? "Toque para carregar" : `Carregar ${ROTULO[tipo]?.toLowerCase() || "arquivo"}`}</span>
        </span>
      </button>
    );
  }

  if (tipo === "imagem") {
    return <img src={url} alt={nome || "Imagem"} onClick={() => window.open(url, "_blank", "noopener")} className="max-w-full max-h-72 rounded-lg cursor-zoom-in" />;
  }
  if (tipo === "audio") return <audio src={url} controls autoPlay className="max-w-full h-10" />;
  if (tipo === "video") return <video src={url} controls autoPlay className="max-w-full max-h-72 rounded-lg" />;
  return (
    <button onClick={baixar} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/10 hover:bg-black/20 cursor-pointer max-w-full">
      <span>📄</span>
      <span className="text-sm truncate">{nome || "Documento"}</span>
      <span className="text-xs underline shrink-0">Baixar</span>
    </button>
  );
}
