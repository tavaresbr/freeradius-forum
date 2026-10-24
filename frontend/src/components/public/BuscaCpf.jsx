import React, { useEffect, useRef, useState } from "react";
import { validarCPF } from "../../utils/cpfUtils";
import { mascaraData, dataNascimentoValida, mascaraTelefone } from "../../utils/dataUtils";

/**
 * Passo 1 dos portais de cadastro: data de nascimento + "Continuar".
 * Só acha cadastros do próprio banco (mesma empresa) quando CPF e data batem.
 * - achou: mostra o nome mascarado e pergunta "É você?"; "Sim" busca nome, telefone e e-mail
 *   (onPreencher) e libera o restante do formulário (onLiberarResto);
 * - não achou / erro: libera o restante em branco para preencher (cadastro novo ou atualização,
 *   as regras de titularidade ficam no servidor); só o bloqueio por excesso de tentativas (429) não libera.
 * Props: cpf (com ou sem máscara), dataNascimento (DD/MM/AAAA) e onDataChange (controlado),
 * mac e mikrotikId (o servidor limita tentativas e acha a empresa), onPreencher({ nome, telefone, email }),
 * onLiberarResto(), onResetar() (CPF ou data mudaram) e ringClass (cor do foco do campo).
 */
export default function BuscaCpf({ cpf, dataNascimento, onDataChange, mac, mikrotikId, onPreencher, onLiberarResto, onResetar, ringClass = "focus:ring-blue-500" }) {
  // estado: idle | buscando | achou | liberado | bloqueado
  const [estado, setEstado] = useState("idle");
  const [nomeMascarado, setNomeMascarado] = useState("");
  const [aviso, setAviso] = useState("");

  // Callbacks do pai sempre atualizados, sem refazer o efeito de reset
  const cb = useRef({});
  cb.current = { onPreencher, onLiberarResto, onResetar };

  // Mudou CPF ou data: o resultado anterior deixa de valer e o restante do formulário volta a se esconder
  useEffect(() => {
    setEstado("idle");
    setNomeMascarado("");
    setAviso("");
    if (cb.current.onResetar) cb.current.onResetar();
  }, [cpf, dataNascimento]);

  const podeContinuar = validarCPF(cpf || "") && dataNascimentoValida(dataNascimento) && estado !== "buscando";

  const chamar = async (confirmar) => {
    const res = await fetch("/api/lgpd/consulta-cpf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cpf, data_nascimento: dataNascimento, mac, mikrotik_id: mikrotikId, confirmar }),
    });
    let data = {};
    try { data = await res.json(); } catch { /* corpo vazio */ }
    return { res, data };
  };

  const liberar = (mensagem) => {
    setAviso(mensagem || "");
    setEstado("liberado");
    if (cb.current.onLiberarResto) cb.current.onLiberarResto();
  };

  const bloquear = (data) => {
    setAviso(data.error || "Muitas tentativas. Tente novamente mais tarde.");
    setEstado("bloqueado");
  };

  const continuar = async () => {
    if (!podeContinuar) return;
    setEstado("buscando");
    setAviso("");
    try {
      const { res, data } = await chamar(false);
      if (res.status === 429) return bloquear(data);
      if (!res.ok) return liberar("Não foi possível buscar seu cadastro agora. Preencha seus dados abaixo.");
      if (data.encontrado) {
        setNomeMascarado(data.nome_mascarado || "");
        setEstado("achou");
      } else {
        liberar("Não encontramos um cadastro com esses dados. Preencha seus dados abaixo.");
      }
    } catch {
      liberar("Erro de conexão ao buscar seu cadastro. Preencha seus dados abaixo.");
    }
  };

  const souEu = async () => {
    setEstado("buscando");
    try {
      const { res, data } = await chamar(true);
      if (res.status === 429) return bloquear(data);
      if (res.ok && data.encontrado) {
        if (cb.current.onPreencher) cb.current.onPreencher({ nome: data.nome || "", telefone: mascaraTelefone(data.telefone), email: data.email || "" });
        liberar("Dados preenchidos. Confira e atualize se precisar.");
      } else {
        liberar("Não foi possível carregar seus dados. Preencha abaixo.");
      }
    } catch {
      liberar("Erro de conexão. Preencha seus dados abaixo.");
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Data de nascimento *</label>
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="numeric"
          name="data_nascimento"
          value={dataNascimento}
          onChange={(e) => onDataChange(mascaraData(e.target.value))}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); continuar(); } }}
          placeholder="DD/MM/AAAA"
          autoComplete="bday"
          className={`flex-1 min-w-0 border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 ${ringClass} focus:border-transparent transition-all`}
        />
        <button
          type="button"
          onClick={continuar}
          disabled={!podeContinuar}
          className="px-5 py-3 rounded-lg text-sm font-semibold border border-gray-300 text-gray-800 bg-gray-50 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {estado === "buscando" ? "Buscando..." : "Continuar"}
        </button>
      </div>
      {estado === "idle" && <p className="text-gray-500 text-xs mt-1">Informe seu CPF e sua data de nascimento para começar.</p>}

      {estado === "achou" && (
        <div className="mt-3 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-900">
          <p>Encontramos um cadastro em nome de <strong>{nomeMascarado}</strong>. É você?</p>
          <div className="flex flex-wrap gap-2 mt-2">
            <button type="button" onClick={souEu} className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">Sim, sou eu</button>
            <button type="button" onClick={() => liberar("")} className="px-3 py-1.5 rounded-md border border-blue-300 text-blue-800 text-sm hover:bg-blue-100">Não, preencher novos dados</button>
          </div>
        </div>
      )}
      {estado === "liberado" && aviso && <p className="text-gray-600 text-xs mt-2">{aviso}</p>}
      {estado === "bloqueado" && <p className="text-red-600 text-xs mt-2">{aviso}</p>}
    </div>
  );
}
