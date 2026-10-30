// Cartao de numero do painel Super Admin. Com `aoClicar` vira um botao.
export default function CartaoMetrica({ rotulo, valor, destaque, dica, aoClicar }) {
  const corpo = (
    <>
      <p className="text-gray-500 text-sm">{rotulo}</p>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 break-words ${destaque || "text-white"}`}>{valor}</p>
    </>
  );
  const base = "bg-[#1a1d27] border border-gray-800 rounded-xl p-5 min-w-0";
  if (!aoClicar) {
    return <div className={base} title={dica || undefined}>{corpo}</div>;
  }
  return (
    <button
      type="button"
      onClick={aoClicar}
      title={dica || undefined}
      className={`${base} text-left w-full cursor-pointer transition hover:border-blue-500/60 hover:bg-[#1f2330] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
    >
      {corpo}
    </button>
  );
}
