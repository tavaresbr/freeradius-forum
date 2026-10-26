import React, { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AdminLayout from "../../components/admin/AdminLayout";

const inputCls = "w-full bg-[#0d1117] border border-gray-700 text-white rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500";

// Upload com progresso (fetch nao informa progresso de envio, XHR sim)
function enviarArquivo(url, token, arquivo, aoProgredir) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) aoProgredir(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let corpo = {};
      try { corpo = JSON.parse(xhr.responseText || "{}"); } catch { /* corpo nao-JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(corpo);
      else reject(new Error(corpo.error || `Erro ao enviar arquivo (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Falha de conexão ao enviar o arquivo"));
    const fd = new FormData();
    fd.append("arquivo", arquivo);
    xhr.send(fd);
  });
}

export default function CampanhaEditor() {
  const { empresaSlug, id } = useParams();
  const [campanha, setCampanha] = useState(null);
  const [loading, setLoading] = useState(true);
  const [envios, setEnvios] = useState([]); // [{ chave, nome, pct, erro, ok }]
  const [msg, setMsg] = useState(null); // { tipo: 'erro' | 'ok', texto }
  const [edicoes, setEdicoes] = useState({}); // itemId -> { titulo, duracao_segundos, link_destino } (so itens alterados)
  const [salvandoItem, setSalvandoItem] = useState(null);
  const [editandoDados, setEditandoDados] = useState(false);
  const [dados, setDados] = useState({ nome: "", descricao: "" });
  const [arrastando, setArrastando] = useState(null); // indice do item sendo arrastado
  const fileInputRef = useRef(null);
  const token = localStorage.getItem("admin_token");
  const headersJson = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const avisar = (tipo, texto) => setMsg({ tipo, texto });

  const carregar = async ({ silencioso = false } = {}) => {
    if (!silencioso) setLoading(true);
    try {
      const res = await fetch(`/api/campanhas/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao carregar campanha");
      setCampanha(data.data);
    } catch (err) {
      avisar("erro", err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, [id]);

  const handleToggleAtivo = async () => {
    if (!campanha) return;
    try {
      const res = await fetch(`/api/campanhas/${id}`, {
        method: "PUT",
        headers: headersJson,
        body: JSON.stringify({ ativo: !campanha.ativo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Erro ao atualizar campanha");
      carregar({ silencioso: true });
    } catch (err) {
      avisar("erro", err.message);
    }
  };

  const abrirEdicaoDados = () => {
    setDados({ nome: campanha.nome || "", descricao: campanha.descricao || "" });
    setEditandoDados(true);
  };

  const salvarDados = async (e) => {
    e.preventDefault();
    if (!dados.nome.trim()) return avisar("erro", "Informe o nome da campanha.");
    try {
      const res = await fetch(`/api/campanhas/${id}`, {
        method: "PUT",
        headers: headersJson,
        body: JSON.stringify({ nome: dados.nome, descricao: dados.descricao }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Erro ao salvar dados da campanha");
      setEditandoDados(false);
      avisar("ok", "Dados da campanha salvos.");
      carregar({ silencioso: true });
    } catch (err) {
      avisar("erro", err.message);
    }
  };

  // Upload de varios arquivos, um por vez, cada um com sua barra de progresso
  const handleUpload = async (e) => {
    const arquivos = Array.from(e.target.files || []);
    e.target.value = ""; // permite escolher o mesmo arquivo de novo
    if (!arquivos.length) return;

    const base = Date.now();
    const lista = arquivos.map((f, i) => ({ chave: `${base}-${i}`, nome: f.name, pct: 0, erro: null, ok: false }));
    setEnvios((atual) => [...atual.filter((x) => !x.ok), ...lista]);
    setMsg(null);

    const atualizar = (chave, mudanca) =>
      setEnvios((atual) => atual.map((x) => (x.chave === chave ? { ...x, ...mudanca } : x)));

    for (let i = 0; i < arquivos.length; i++) {
      const { chave } = lista[i];
      try {
        await enviarArquivo(`/api/campanhas/${id}/itens`, token, arquivos[i], (pct) => atualizar(chave, { pct }));
        atualizar(chave, { pct: 100, ok: true });
      } catch (err) {
        atualizar(chave, { erro: err.message });
      }
    }
    carregar({ silencioso: true });
    // Some com os enviados com sucesso depois de um instante; os com erro ficam para o admin ver
    setTimeout(() => setEnvios((atual) => atual.filter((x) => !x.ok)), 2500);
  };

  const handleDeletarItem = async (itemId) => {
    if (!confirm("Deseja remover este item?")) return;
    try {
      const res = await fetch(`/api/campanhas/${id}/itens/${itemId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Erro ao remover item");
      setEdicoes((e) => { const n = { ...e }; delete n[itemId]; return n; });
      carregar({ silencioso: true });
    } catch (err) {
      avisar("erro", err.message);
    }
  };

  const handleReordenar = async (itens) => {
    // Mostra a nova ordem na hora; se o servidor recusar, recarrega a ordem real
    setCampanha((c) => ({ ...c, itens }));
    const ordens = itens.map((item, idx) => ({ id: item.id, ordem: idx + 1 }));
    try {
      const res = await fetch(`/api/campanhas/${id}/itens/reordenar`, {
        method: "PUT",
        headers: headersJson,
        body: JSON.stringify({ ordens }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Erro ao reordenar itens");
    } catch (err) {
      avisar("erro", err.message);
      carregar({ silencioso: true });
    }
  };

  const moverItem = (de, para) => {
    if (!campanha || de === para || para < 0 || para >= campanha.itens.length) return;
    const itens = [...campanha.itens];
    const [movido] = itens.splice(de, 1);
    itens.splice(para, 0, movido);
    handleReordenar(itens);
  };

  // Valor mostrado no campo: o que o admin esta digitando, senao o salvo
  const valor = (item, campo) => {
    const ed = edicoes[item.id];
    if (ed && campo in ed) return ed[campo];
    const v = item[campo];
    return v === null || v === undefined ? "" : v;
  };
  const editar = (item, campo, v) =>
    setEdicoes((e) => ({ ...e, [item.id]: { ...(e[item.id] || {}), [campo]: v } }));

  const salvarItem = async (item) => {
    const ed = edicoes[item.id];
    if (!ed) return;
    const corpo = {};
    if ("titulo" in ed) corpo.titulo = ed.titulo;
    if ("link_destino" in ed) corpo.link_destino = ed.link_destino;
    if ("duracao_segundos" in ed) corpo.duracao_segundos = ed.duracao_segundos;
    setSalvandoItem(item.id);
    try {
      const res = await fetch(`/api/campanhas/${id}/itens/${item.id}`, {
        method: "PUT",
        headers: headersJson,
        body: JSON.stringify(corpo),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Erro ao salvar item");
      setEdicoes((e) => { const n = { ...e }; delete n[item.id]; return n; });
      setCampanha((c) => ({ ...c, itens: c.itens.map((i) => (i.id === item.id ? data.data : i)) }));
      avisar("ok", "Item salvo.");
    } catch (err) {
      avisar("erro", err.message);
    } finally {
      setSalvandoItem(null);
    }
  };

  // Abre a pre-visualizacao (mesmo player do cliente, sem contar view nem redirecionar)
  const visualizar = () => {
    window.open(`/campanha/0?preview=1&campanha=${id}`, "_blank", "noopener");
  };

  if (loading) {
    return (
      <AdminLayout>
        <p className="text-gray-400">Carregando...</p>
      </AdminLayout>
    );
  }

  if (!campanha) {
    return (
      <AdminLayout>
        <p className="text-red-400">{msg?.texto || "Campanha não encontrada."}</p>
      </AdminLayout>
    );
  }

  const itens = campanha.itens || [];
  const enviando = envios.some((x) => !x.ok && !x.erro);

  return (
    <AdminLayout>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Link
          to={`/admin/${empresaSlug}/campanhas`}
          className="text-gray-400 hover:text-white text-sm border border-gray-700 px-3 py-1 rounded hover:bg-[#252b3b]"
        >
          ← Voltar
        </Link>
        <h1 className="text-3xl font-bold text-white flex-1">{campanha.nome}</h1>
        <span className="text-gray-400 text-sm">{campanha.views ?? 0} views</span>
        <button
          onClick={visualizar}
          disabled={itens.length === 0}
          className="border border-gray-700 text-gray-200 px-3 py-1 rounded text-sm hover:bg-[#252b3b] disabled:opacity-40 disabled:cursor-not-allowed"
          title={itens.length === 0 ? "Adicione itens para visualizar" : "Abrir como o cliente vai ver"}
        >
          ▶ Visualizar
        </button>
        <button
          onClick={handleToggleAtivo}
          className={`text-xs px-3 py-1 rounded-full cursor-pointer ${
            campanha.ativo ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400"
          }`}
          title="Clique para alternar"
        >
          {campanha.ativo ? "Ativo" : "Inativo"}
        </button>
      </div>

      {msg && (
        <div
          role="status"
          className={`mb-4 px-4 py-2 rounded text-sm flex items-center justify-between ${
            msg.tipo === "erro"
              ? "bg-red-900/30 border border-red-800/60 text-red-300"
              : "bg-green-900/30 border border-green-800/60 text-green-300"
          }`}
        >
          <span>{msg.texto}</span>
          <button onClick={() => setMsg(null)} className="ml-4 text-xs opacity-70 hover:opacity-100">fechar</button>
        </div>
      )}

      {/* Dados da campanha (nome / descricao) */}
      <div className="mb-6">
        {editandoDados ? (
          <form onSubmit={salvarDados} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4 space-y-3 max-w-xl">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Nome</label>
              <input
                className={inputCls}
                maxLength={150}
                value={dados.nome}
                onChange={(e) => setDados((d) => ({ ...d, nome: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Descrição</label>
              <textarea
                className={inputCls}
                rows={2}
                maxLength={2000}
                value={dados.descricao}
                onChange={(e) => setDados((d) => ({ ...d, descricao: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="bg-blue-600 text-white px-3 py-1 rounded text-xs">Salvar</button>
              <button type="button" onClick={() => setEditandoDados(false)} className="border border-gray-700 text-gray-300 px-3 py-1 rounded text-xs">
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-start gap-3">
            <p className="text-gray-400 text-sm flex-1">{campanha.descricao || "Sem descrição."}</p>
            <button onClick={abrirEdicaoDados} className="border border-gray-700 text-gray-300 px-3 py-1 rounded text-xs hover:bg-[#252b3b]">
              Editar dados
            </button>
          </div>
        )}
      </div>

      {/* Upload zone */}
      <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-white">Itens da Campanha</h2>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
              className="hidden"
              onChange={handleUpload}
              data-testid="input-arquivos"
            />
            <button
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              disabled={enviando}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-neutral-800 disabled:opacity-50 text-sm"
            >
              {enviando ? "Enviando..." : "+ Adicionar itens"}
            </button>
          </div>
        </div>
        <p className="text-gray-500 text-xs mb-4">
          Imagens: JPG, PNG, WEBP até 10MB. Vídeos: MP4, WEBM até 50MB. Você pode escolher vários arquivos de uma vez.
          Arraste os cartões para mudar a ordem.
        </p>

        {envios.length > 0 && (
          <ul className="mb-4 space-y-2" aria-label="Envios">
            {envios.map((x) => (
              <li key={x.chave} className="text-xs">
                <div className="flex justify-between text-gray-300 mb-1">
                  <span className="truncate pr-2">{x.nome}</span>
                  <span className={x.erro ? "text-red-400" : x.ok ? "text-green-400" : "text-gray-400"}>
                    {x.erro ? "Falhou" : x.ok ? "Enviado" : `${x.pct}%`}
                  </span>
                </div>
                <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${x.erro ? "bg-red-500" : "bg-blue-500"}`}
                    style={{ width: `${x.erro ? 100 : x.pct}%` }}
                  />
                </div>
                {x.erro && <p className="text-red-400 mt-1">{x.erro}</p>}
              </li>
            ))}
          </ul>
        )}

        {itens.length === 0 ? (
          <p className="text-gray-500 text-sm">Nenhum item adicionado. Clique em "+ Adicionar itens" para começar.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {itens.map((item, index) => {
              const alterado = !!edicoes[item.id];
              return (
                <div
                  key={item.id}
                  draggable
                  onDragStart={() => setArrastando(index)}
                  onDragEnd={() => setArrastando(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (arrastando !== null) moverItem(arrastando, index);
                    setArrastando(null);
                  }}
                  data-testid={`item-${item.id}`}
                  className={`bg-[#0d1117] border rounded-lg overflow-hidden ${
                    arrastando === index ? "border-blue-500 opacity-60" : "border-gray-700"
                  }`}
                >
                  {/* Thumbnail */}
                  <div className="relative w-full h-40 bg-gray-900 flex items-center justify-center overflow-hidden cursor-grab">
                    <span className="absolute top-2 left-2 z-10 bg-black/60 text-white text-xs rounded px-2 py-0.5">
                      {index + 1}
                    </span>
                    {item.tipo === "video" ? (
                      <video src={item.arquivo_url} className="w-full h-full object-cover" muted preload="metadata" draggable={false} />
                    ) : (
                      <img src={item.arquivo_url} alt={item.titulo || `Item ${index + 1}`} className="w-full h-full object-cover" draggable={false} />
                    )}
                  </div>

                  {/* Campos editaveis */}
                  <div className="p-3 space-y-2">
                    <div className="text-xs text-gray-400 capitalize">{item.tipo}</div>
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-0.5">Título</label>
                      <input
                        className={inputCls}
                        maxLength={150}
                        value={valor(item, "titulo")}
                        onChange={(e) => editar(item, "titulo", e.target.value)}
                        aria-label={`Título do item ${index + 1}`}
                      />
                    </div>
                    <div className="flex gap-2">
                      <div className="w-24">
                        <label className="block text-[11px] text-gray-500 mb-0.5">Duração (s)</label>
                        <input
                          type="number"
                          min={1}
                          max={60}
                          className={inputCls}
                          value={valor(item, "duracao_segundos")}
                          onChange={(e) => editar(item, "duracao_segundos", e.target.value)}
                          disabled={item.tipo === "video"}
                          title={item.tipo === "video" ? "Vídeos avançam quando terminam" : ""}
                          aria-label={`Duração do item ${index + 1}`}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-[11px] text-gray-500 mb-0.5">Link do botão "Saiba mais"</label>
                        <input
                          className={inputCls}
                          maxLength={500}
                          placeholder="https://..."
                          value={valor(item, "link_destino")}
                          onChange={(e) => editar(item, "link_destino", e.target.value)}
                          aria-label={`Link do item ${index + 1}`}
                        />
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => moverItem(index, index - 1)}
                        disabled={index === 0}
                        className="border border-gray-700 text-gray-300 px-2 py-1 rounded text-xs hover:bg-[#252b3b] disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Mover para cima"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moverItem(index, index + 1)}
                        disabled={index === itens.length - 1}
                        className="border border-gray-700 text-gray-300 px-2 py-1 rounded text-xs hover:bg-[#252b3b] disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Mover para baixo"
                      >
                        ↓
                      </button>
                      <div className="flex-1" />
                      <button
                        onClick={() => salvarItem(item)}
                        disabled={!alterado || salvandoItem === item.id}
                        className="bg-blue-600 text-white px-3 py-1 rounded text-xs disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        {salvandoItem === item.id ? "Salvando..." : "Salvar"}
                      </button>
                      <button
                        onClick={() => handleDeletarItem(item.id)}
                        className="bg-red-500 text-white px-2 py-1 rounded text-xs"
                        title="Remover item"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
