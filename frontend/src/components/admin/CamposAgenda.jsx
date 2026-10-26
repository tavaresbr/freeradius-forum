import React from "react";

const FREQUENCIAS = [
  ["sempre", "Sempre (em toda conexão)"],
  ["sessao", "Uma vez por visita (até fechar o navegador)"],
  ["diaria", "Uma vez por dia (24 h)"],
];

// Limita o ano a 4 digitos (digitar 22026 gerava "22026-01-01", recusado pelo servidor)
const DATA_MIN = "2020-01-01";
const DATA_MAX = "2099-12-31";

const inputCls =
  "w-full bg-[#0d1117] border border-gray-700 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500 text-sm";

// Campos de agendamento e frequencia da campanha. `valor` = { data_inicio, data_fim, frequencia }.
export default function CamposAgenda({ valor, onChange }) {
  const set = (campo) => (e) => onChange({ ...valor, [campo]: e.target.value });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Início (opcional)</label>
          <input type="date" min={DATA_MIN} max={DATA_MAX} aria-label="Data de início" className={inputCls} value={valor.data_inicio || ""} onChange={set("data_inicio")} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Término (opcional)</label>
          <input type="date" min={DATA_MIN} max={DATA_MAX} aria-label="Data de término" className={inputCls} value={valor.data_fim || ""} onChange={set("data_fim")} />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Frequência</label>
        <select aria-label="Frequência" className={inputCls} value={valor.frequencia || "sempre"} onChange={set("frequencia")}>
          {FREQUENCIAS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
        </select>
      </div>
      <p className="text-xs text-gray-500">Fora das datas a campanha não aparece (o cliente vai direto ao portal). Datas incluem o primeiro e o último dia.</p>
    </div>
  );
}

export function resumoAgenda(c) {
  const f = (d) => (d ? d.split("-").reverse().join("/") : null);
  const partes = [];
  if (c.data_inicio || c.data_fim) partes.push(`${f(c.data_inicio) || "…"} a ${f(c.data_fim) || "…"}`);
  if (c.frequencia === "sessao") partes.push("1x por visita");
  if (c.frequencia === "diaria") partes.push("1x por dia");
  return partes.join(" · ");
}
