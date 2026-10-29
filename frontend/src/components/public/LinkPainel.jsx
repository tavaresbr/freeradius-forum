import { Link } from "react-router-dom";

// Login e registro so existem no host do painel (o backend responde 404 em outros hosts).
// No site institucional (ex.: apextelecom.com.br) o link vai para painel.<dominio>.
function hostDoPainel() {
  const h = window.location.hostname;
  if (h === "localhost" || h === "127.0.0.1" || h.startsWith("painel.") || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return null;
  return `painel.${h.replace(/^www\./, "")}`;
}

export default function LinkPainel({ to, children, ...props }) {
  const host = hostDoPainel();
  if (!host) return <Link to={to} {...props}>{children}</Link>;
  return <a href={`${window.location.protocol}//${host}${to}`} {...props}>{children}</a>;
}
