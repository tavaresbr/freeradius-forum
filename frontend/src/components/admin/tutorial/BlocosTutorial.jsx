import React, { useState } from "react";

// Blocos visuais compartilhados pelas paginas de tutorial novas
// (mesmo estilo de TutorialUnifi/TutorialIntelbras, com suporte ao tema escuro).

export function Print({ src, alt }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <a href={src} target="_blank" rel="noreferrer" title="Clique para ampliar">
      <img
        src={src}
        alt={alt}
        onError={() => setOk(false)}
        className="rounded-lg border border-gray-200 dark:border-slate-700 shadow-sm my-3 w-full max-w-4xl hover:shadow-md transition-shadow cursor-zoom-in"
      />
    </a>
  );
}

export function Passo({ numero, titulo, children }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 p-4 sm:p-6 mb-6">
      <div className="flex items-center gap-3 mb-4">
        <span className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
          {numero}
        </span>
        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 min-w-0 break-words">{titulo}</h3>
      </div>
      <div className="text-sm text-gray-600 dark:text-gray-300 space-y-2">{children}</div>
    </div>
  );
}

export function Aviso({ tipo = "info", children }) {
  const estilos = {
    info: "bg-blue-50 dark:bg-blue-900/30 border-blue-200 text-blue-800 dark:text-blue-200",
    atencao: "bg-yellow-50 dark:bg-yellow-900/30 border-yellow-300 text-yellow-800 dark:text-yellow-200",
    ok: "bg-green-50 dark:bg-green-900/30 border-green-200 text-green-800 dark:text-green-200",
  };
  const icones = { info: "ℹ️", atencao: "⚠️", ok: "✅" };
  return (
    <div className={`border rounded-lg px-4 py-3 my-3 text-sm ${estilos[tipo]}`}>
      <span className="mr-2">{icones[tipo]}</span>
      {children}
    </div>
  );
}

export function Campo({ nome, valor }) {
  return (
    <li className="flex flex-wrap gap-2 items-baseline">
      <span className="font-medium text-gray-700 dark:text-gray-200">{nome}:</span>
      <code className="bg-gray-100 dark:bg-slate-700 rounded px-2 py-0.5 text-xs text-gray-800 dark:text-gray-100 break-words">{valor}</code>
    </li>
  );
}

export function BotaoAcao({ onClick, children, cor = "azul" }) {
  const cores = {
    azul: "bg-blue-600 hover:bg-blue-500",
    verde: "bg-green-600 hover:bg-green-500",
    cinza: "bg-gray-600 hover:bg-gray-500",
  };
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-semibold shadow-sm transition-colors ${cores[cor]}`}>
      {children}
    </button>
  );
}

export function NavSecoes({ secoes, ativa, onIr }) {
  return (
    <nav className="flex flex-wrap gap-2 mb-8 sticky top-0 z-10 bg-gray-50 dark:bg-slate-900 py-3 -mx-2 px-2 rounded-lg">
      {secoes.map((s) => (
        <button
          key={s.id}
          onClick={() => onIr(s.id)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            ativa === s.id
              ? "bg-blue-600 text-white"
              : "bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-600"
          }`}
        >
          {s.titulo}
        </button>
      ))}
    </nav>
  );
}
