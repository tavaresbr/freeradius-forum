// Envolve so o VALOR sensivel (o modo privacidade borra a classe dado-sensivel).
// Nao use em <tr>/<td> de acoes ou botoes: o elemento perde o clique com o modo ligado.
export default function Sensivel({ children, className = "", as: Tag = "span" }) {
  return <Tag className={`dado-sensivel ${className}`.trim()}>{children}</Tag>;
}
