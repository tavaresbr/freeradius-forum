// Cartao de numero do painel Super Admin.
export default function CartaoMetrica({ rotulo, valor, destaque, dica }) {
  return (
    <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 min-w-0" title={dica || undefined}>
      <p className="text-gray-500 text-sm">{rotulo}</p>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 break-words ${destaque || "text-white"}`}>{valor}</p>
    </div>
  );
}
