import React, { useState } from "react";
import { redirecionarHotspot } from "../../utils/hotspotRedirect";

/**
 * Aviso de sessao simultanea: o acesso ja esta conectado em outro aparelho.
 * "Desconectar o outro e conectar aqui" chama o servidor (exige CPF + data de nascimento
 * ja informados) e, em caso de sucesso, faz o login final com as credenciais ja recebidas.
 * Props: dados (resposta do login: sessao_ativa, gateway, username, password, gateway_info),
 * cpf, dataNascimento, mac, mikrotikId, onCancelar().
 */
export default function SessaoAtivaAviso({ dados, cpf, dataNascimento, mac, mikrotikId, onCancelar }) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const desde = dados?.sessao_ativa?.desde
    ? new Date(dados.sessao_ativa.desde).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : null;
  const aparelho = dados?.sessao_ativa?.aparelho;

  const confirmar = async () => {
    setEnviando(true);
    setErro("");
    try {
      const res = await fetch("/api/sessao/desconectar-anterior", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpf, data_nascimento: dataNascimento, username: dados.username, mac, mikrotik_id: mikrotikId }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.message || "Não foi possível desconectar o outro aparelho.");
      redirecionarHotspot(dados.gateway, dados.username, dados.password, 800, dados.gateway_info);
    } catch (e) {
      setErro(e.message);
      setEnviando(false);
    }
  };

  return (
    <div className="p-4 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-sm space-y-3" role="alertdialog" aria-live="polite">
      <p className="font-semibold">Você já está conectado em outro aparelho</p>
      <p>
        Este acesso está em uso{aparelho ? ` no aparelho final ${aparelho}` : ""}{desde ? ` desde ${desde}` : ""}.
        Só é possível usar um aparelho por vez. Para conectar aqui, desconecte o outro.
      </p>
      {erro && <p className="text-red-700">{erro}</p>}
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={confirmar}
          disabled={enviando}
          className="px-4 py-2.5 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-50"
        >
          {enviando ? "Desconectando..." : "Desconectar o outro e conectar aqui"}
        </button>
        <button
          type="button"
          onClick={onCancelar}
          disabled={enviando}
          className="px-4 py-2.5 rounded-lg border border-amber-400 text-amber-900 hover:bg-amber-100 disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
