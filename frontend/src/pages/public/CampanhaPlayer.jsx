// src/pages/public/CampanhaPlayer.jsx
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import axios from "axios";

export default function CampanhaPlayer() {
  const { portalId } = useParams();
  const [searchParams] = useSearchParams();

  const mikrotikId = searchParams.get("mikrotik_id") || portalId;
  const isPreview = searchParams.get("preview") === "1";
  // Pre-visualizacao pelo painel: ?preview=1&campanha=<id> le a campanha direto pela API do admin
  // (funciona mesmo inativa ou ainda nao vinculada a um portal). Sem token valido volta ao erro/redirect.
  const campanhaPreviewId = isPreview ? searchParams.get("campanha") : null;

  const [itens, setItens] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState(0); // 0..1 for current item
  const [loaded, setLoaded] = useState(false);
  const [ended, setEnded] = useState(false);
  const [erroPreview, setErroPreview] = useState(null);
  // { id, frequencia } da campanha em exibicao: define o cookie que evita repeti-la ('sessao' / 'diaria')
  const campanhaRef = useRef(null);

  // Id aleatorio da visita (so na aba): o servidor usa para nao contar a mesma view/clique duas vezes
  const sessaoRef = useRef(null);
  const slidesContados = useRef(new Set());
  const getSessao = () => {
    if (!sessaoRef.current) {
      const novo = () => (
        (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`)
          .replace(/[^A-Za-z0-9_-]/g, "")
      );
      try {
        let s = sessionStorage.getItem("camp_sessao");
        if (!s) { s = novo(); sessionStorage.setItem("camp_sessao", s); }
        sessaoRef.current = s;
      } catch {
        sessaoRef.current = novo();
      }
    }
    return sessaoRef.current;
  };

  const rafRef = useRef(null);
  const startTimeRef = useRef(null);
  const videoRef = useRef(null);

  // Build destination URL preserving all original query params + campanha_vista=1
  const buildRedirectUrl = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("campanha_vista", "1");
    return `/hotspot/redirect/${encodeURIComponent(mikrotikId || "")}?${params.toString()}`;
  }, [searchParams, mikrotikId]);

  const doRedirect = useCallback(() => {
    if (!isPreview) {
      // O servidor (/hotspot/redirect) le o cookie cv_<id> e pula a campanha enquanto ele existir
      const c = campanhaRef.current;
      if (c && (c.frequencia === "sessao" || c.frequencia === "diaria")) {
        try {
          const validade = c.frequencia === "diaria" ? "; max-age=86400" : "";
          document.cookie = `cv_${c.id}=1; path=/; SameSite=Lax${validade}`;
        } catch { /* sem cookies: a campanha aparece de novo, sem prejuizo */ }
      }
      window.location.href = buildRedirectUrl();
    } else {
      setEnded(true);
    }
  }, [isPreview, buildRedirectUrl]);

  // Advance to next item or end
  const advance = useCallback((nextIndex) => {
    setProgress(0);
    startTimeRef.current = null;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setCurrentIndex((prev) => {
      const idx = nextIndex !== undefined ? nextIndex : prev + 1;
      return idx;
    });
  }, []);

  // On mount: fetch campanha
  useEffect(() => {
    const requisicao = campanhaPreviewId
      ? axios.get(`/api/campanhas/${campanhaPreviewId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("admin_token") || ""}` },
        })
      : axios.get(`/api/public/campanha/${portalId}`);
    requisicao
      .then((res) => {
        const data = res.data?.data;
        if (data && Array.isArray(data.itens) && data.itens.length > 0) {
          const sorted = [...data.itens].sort((a, b) => a.ordem - b.ordem);
          campanhaRef.current = { id: data.id, frequencia: data.frequencia };
          setItens(sorted);
          setLoaded(true);

          if (!isPreview) {
            axios
              .post(`/api/public/campanha/${portalId}/view`, { sessao: getSessao() })
              .catch(() => {});
          }
        } else if (isPreview) {
          setErroPreview("Esta campanha não tem itens para visualizar.");
        } else {
          window.location.href = buildRedirectUrl();
        }
      })
      .catch(() => {
        if (isPreview) setErroPreview("Não foi possível carregar a campanha. Entre no painel e tente de novo.");
        else window.location.href = buildRedirectUrl();
      });
  }, [portalId, isPreview, campanhaPreviewId, buildRedirectUrl]);

  // When currentIndex advances past the last item, redirect
  useEffect(() => {
    if (loaded && itens.length > 0 && currentIndex >= itens.length) {
      doRedirect();
    }
  }, [currentIndex, itens.length, loaded, doRedirect]);

  // RAF loop for image items
  const startImageTimer = useCallback(
    (duracaoMs) => {
      startTimeRef.current = performance.now();

      const tick = (now) => {
        const elapsed = now - startTimeRef.current;
        const p = Math.min(elapsed / duracaoMs, 1);
        setProgress(p);

        if (p < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          rafRef.current = null;
          advance();
        }
      };

      rafRef.current = requestAnimationFrame(tick);
    },
    [advance]
  );

  // Conta a exibicao de cada slide (uma vez por slide e visita; o servidor tambem deduplica)
  useEffect(() => {
    if (isPreview || !loaded || currentIndex >= itens.length) return;
    const id = itens[currentIndex].id;
    if (slidesContados.current.has(id)) return;
    slidesContados.current.add(id);
    axios
      .post(`/api/public/campanha/${portalId}/view`, { sessao: getSessao(), item_id: id })
      .catch(() => {});
  }, [currentIndex, loaded, itens, isPreview, portalId]);

  // Clique em "Saiba mais": avisa o servidor sem atrasar a abertura do link (keepalive sobrevive a navegacao)
  const registrarClique = useCallback((itemId) => {
    if (isPreview) return;
    try {
      fetch(`/api/public/campanha/${portalId}/clique`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessao: getSessao(), item_id: itemId }),
        keepalive: true,
      }).catch(() => {});
    } catch { /* metrica nunca bloqueia o link */ }
  }, [isPreview, portalId]);

  // Handle item change
  useEffect(() => {
    if (!loaded || itens.length === 0 || currentIndex >= itens.length) return;

    const item = itens[currentIndex];
    setProgress(0);
    startTimeRef.current = null;

    // Cancel any running RAF
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (item.tipo === "imagem") {
      const duracaoMs = (item.duracao_segundos || 5) * 1000;
      startImageTimer(duracaoMs);
    }
    // For video, progress is driven by onTimeUpdate

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [currentIndex, itens, loaded, startImageTimer]);

  // Click handler: left half = prev, right half = next
  const handleClick = useCallback(
    (e) => {
      // Don't intercept clicks on "Saiba mais" button (stopPropagation handles it)
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const isLeft = x < rect.width / 2;

      if (isLeft) {
        // Go to previous or restart current
        if (currentIndex === 0) {
          // Restart current
          setProgress(0);
          startTimeRef.current = null;
          if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
          }
          const item = itens[0];
          if (item.tipo === "imagem") {
            startImageTimer((item.duracao_segundos || 5) * 1000);
          } else if (videoRef.current) {
            videoRef.current.currentTime = 0;
            videoRef.current.play().catch(() => {});
          }
        } else {
          advance(currentIndex - 1);
        }
      } else {
        // Go to next or end
        if (currentIndex >= itens.length - 1) {
          doRedirect();
        } else {
          advance(currentIndex + 1);
        }
      }
    },
    [currentIndex, itens, advance, doRedirect, startImageTimer]
  );

  // Video event handlers
  const handleVideoTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.duration) return;
    setProgress(video.currentTime / video.duration);
  }, []);

  const handleVideoEnded = useCallback(() => {
    advance();
  }, [advance]);

  const handleVideoError = useCallback(() => {
    advance();
  }, [advance]);

  const handleImageError = useCallback(() => {
    advance();
  }, [advance]);

  if (erroPreview) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <p className="text-white text-center px-6">{erroPreview}</p>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-gray-600 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (ended) {
    // Preview mode end screen
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-center text-white px-6">
          <p className="text-2xl font-bold mb-2">Fim da pré-visualização</p>
          <p className="text-gray-400 text-sm">
            Em modo real, o usuário seria redirecionado ao portal.
          </p>
        </div>
      </div>
    );
  }

  if (currentIndex >= itens.length) {
    return (
      <div className="fixed inset-0 bg-black" />
    );
  }

  const item = itens[currentIndex];

  return (
    <div
      className="fixed inset-0 bg-black select-none"
      onClick={handleClick}
      style={{ touchAction: "manipulation" }}
    >
      {isPreview && (
        <div className="absolute top-5 right-3 z-20 bg-yellow-400 text-black text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded">
          Pré-visualização
        </div>
      )}

      {/* Progress bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex gap-1 px-2 pt-2">
        {itens.map((_, idx) => {
          let fill = 0;
          if (idx < currentIndex) fill = 1;
          else if (idx === currentIndex) fill = progress;
          return (
            <div
              key={idx}
              className="flex-1 h-1 rounded-full bg-white bg-opacity-30 overflow-hidden"
            >
              <div
                className="h-full bg-white rounded-full"
                style={{ width: `${fill * 100}%`, transition: "none" }}
              />
            </div>
          );
        })}
      </div>

      {/* Media */}
      <div className="absolute inset-0 flex items-center justify-center">
        {item.tipo === "imagem" ? (
          <img
            key={item.id}
            src={item.arquivo_url}
            alt={item.titulo || ""}
            onError={handleImageError}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <video
            key={item.id}
            ref={videoRef}
            src={item.arquivo_url}
            autoPlay
            muted
            playsInline
            onTimeUpdate={handleVideoTimeUpdate}
            onEnded={handleVideoEnded}
            onError={handleVideoError}
            className="w-full h-full object-cover"
          />
        )}
      </div>

      {/* Bottom overlay: titulo + link */}
      {(item.titulo || item.link_destino) && (
        <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-4 pb-6 pt-12">
          {item.titulo && (
            <p className="text-white text-base font-semibold mb-2 drop-shadow">
              {item.titulo}
            </p>
          )}
          {item.link_destino && (
            <a
              href={item.link_destino}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => { e.stopPropagation(); registrarClique(item.id); }}
              className="inline-block bg-white text-black text-sm font-semibold px-4 py-2 rounded-full shadow hover:bg-gray-100 active:bg-gray-200"
            >
              Saiba mais
            </a>
          )}
        </div>
      )}
    </div>
  );
}
