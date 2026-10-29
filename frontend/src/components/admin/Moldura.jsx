import React from "react";
import AdminLayout from "./AdminLayout";

// Pagina completa (com o layout do painel) ou conteudo embutido numa aba do hub WhatsApp.
export default function Moldura({ embutido, children }) {
  return embutido ? <>{children}</> : <AdminLayout>{children}</AdminLayout>;
}
