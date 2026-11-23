import React, { useEffect, useState } from "react";

/**
 * "Enviar pelo número": aparece só quando a empresa tem 2+ números de WhatsApp. Lista apenas os conectados;
 * começa no número padrão dos envios automáticos. `value` = id do número (0 = principal).
 */
export default function SeletorNumeroEnvio({ headers, value, onChange, className = "" }) {
  const [numeros, setNumeros] = useState([]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetch("/api/whatsapp/numeros", { headers });
        const d = await res.json().catch(() => ({}));
        if (!vivo || !res.ok) return;
        const lista = Array.isArray(d.numeros) ? d.numeros : [];
        setNumeros(lista);
        if (lista.length > 1 && Number.isInteger(d.padrao) && d.padrao > 0 && lista.find((n) => n.id === d.padrao && n.estado === "open")) onChange(d.padrao);
      } catch { /* sem numeros extras: segue no principal */ }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (numeros.length < 2) return null;
  return (
    <div className={className}>
      <label className="block text-xs text-gray-500 mb-1" htmlFor="numero-envio">Enviar pelo número</label>
      <select
        id="numero-envio"
        className="w-full bg-[#0d1117] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {numeros.filter((n) => n.estado === "open" || n.id === value).map((n) => (
          <option key={n.id} value={n.id}>{n.nome}{n.estado === "open" ? "" : " (desconectado)"}</option>
        ))}
      </select>
    </div>
  );
}
