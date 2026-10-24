import React, { useEffect, useState } from "react";
import { validarCPF } from "../../utils/cpfUtils";
import { mascaraData, dataNascimentoValida, mascaraTelefone } from "../../utils/dataUtils";

/**
 * Data de nascimento + "Buscar meu cadastro" para os portais de cadastro.
 * Só acha cadastros do próprio banco (mesma empresa) quando CPF e data batem.
 * Passo 1 mostra o nome mascarado; "Sim, preencher" busca o nome e o telefone.
 * Props: cpf (com ou sem máscara), dataNascimento (DD/MM/AAAA) e onDataChange (controlado),
 * mac e mikrotikId (para o servidor limitar tentativas e achar a empresa),
 * onPreencher({ nome, telefone }) e ringClass (cor do foco do campo).
 */
export default function BuscaCpf({ cpf, dataNascimento, onDataChange, mac, mikrotikId, onPreencher, ringClass = "focus:ring-blue-500" }) {
  // estado: idle | buscando | achou | nao-achou | erro
  const [estado, setEstado] = useState("idle");
  const [nomeMascarado, setNomeMascarado] = useState("");
  const [aviso, setAviso] = useState("");

  // Mudou CPF ou data: o resultado anterior deixa de valer
  useEffect(() => {
    setEstado("idle");
    setNomeMascarado("");
    setAviso("");
  }, [cpf, dataNascimento]);

  const podeBuscar = validarCPF(cpf || "") && dataNascimentoValida(dataNascimento) && estado !== "buscando";

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

  const falha = (res, data) => {
    setEstado("erro");
    setAviso(res.status === 429 ? (data.error || "Muitas tentativas. Tente novamente mais tarde.") : (data.message || "Não foi possível buscar agora. Preencha os dados manualmente."));
  };

  const buscar = async () => {
    setEstado("buscando");
    setAviso("");
    try {
      const { res, data } = await chamar(false);
      if (!res.ok) return falha(res, data);
      if (data.encontrado) {
        setNomeMascarado(data.nome_mascarado || "");
        setEstado("achou");
      } else {
        setEstado("nao-achou");
      }
    } catch {
      setEstado("erro");
      setAviso("Erro de conexão. Preencha os dados manualmente.");
    }
  };

  const preencher = async () => {
    setEstado("buscando");
    try {
      const { res, data } = await chamar(true);
      if (!res.ok) return falha(res, data);
      if (data.encontrado) {
        onPreencher({ nome: data.nome || "", telefone: mascaraTelefone(data.telefone) });
        setEstado("preenchido");
      } else {
        setEstado("nao-achou");
      }
    } catch {
      setEstado("erro");
      setAviso("Erro de conexão. Preencha os dados manualmente.");
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Data de nascimento</label>
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="numeric"
          name="data_nascimento"
          value={dataNascimento}
          onChange={(e) => onDataChange(mascaraData(e.target.value))}
          placeholder="DD/MM/AAAA"
          autoComplete="bday"
          className={`flex-1 min-w-0 border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 ${ringClass} focus:border-transparent transition-all`}
        />
        <button
          type="button"
          onClick={buscar}
          disabled={!podeBuscar}
          className="px-4 py-3 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {estado === "buscando" ? "Buscando..." : "Buscar meu cadastro"}
        </button>
      </div>
      <p className="text-gray-500 text-xs mt-1">Se você já se cadastrou aqui, informe a mesma data para reconectar e preenchermos seus dados.</p>

      {estado === "achou" && (
        <div className="mt-3 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-900">
          <p>Encontramos um cadastro em nome de <strong>{nomeMascarado}</strong>. É você?</p>
          <div className="flex gap-2 mt-2">
            <button type="button" onClick={preencher} className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">Sim, preencher meus dados</button>
            <button type="button" onClick={() => setEstado("idle")} className="px-3 py-1.5 rounded-md border border-blue-300 text-blue-800 text-sm hover:bg-blue-100">Não</button>
          </div>
        </div>
      )}
      {estado === "preenchido" && <p className="text-green-700 text-xs mt-2">Dados preenchidos. Confira e corrija se precisar.</p>}
      {estado === "nao-achou" && <p className="text-gray-600 text-xs mt-2">Não encontramos um cadastro com esses dados. Preencha manualmente.</p>}
      {estado === "erro" && <p className="text-red-600 text-xs mt-2">{aviso}</p>}
    </div>
  );
}
