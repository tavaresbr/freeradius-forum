// Logo padrao: pico "A" azul com arcos de sinal laranja.
export function IconeApex({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M6 35 L20 13 L34 35" stroke="#60a5fa" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 8.5 A10 10 0 0 1 27 8.5" stroke="#fb923c" strokeWidth="3" strokeLinecap="round" />
      <path d="M16.5 14 A5 5 0 0 1 23.5 14" stroke="#fb923c" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default function LogoApex({ nome = "Apex Telecom", className = "text-xl" }) {
  const [primeira, ...resto] = nome.split(" ");
  return (
    <span className={`inline-flex items-center gap-2 font-bold text-white ${className}`}>
      <IconeApex />
      <span>{primeira}{resto.length > 0 && <span className="text-orange-400"> {resto.join(" ")}</span>}</span>
    </span>
  );
}
