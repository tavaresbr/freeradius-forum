import React from "react";
import AdminLayout from "../../components/admin/AdminLayout";

/*
 * Tutorial da integração com AP Intelbras standalone (AP 360 / 1210 / 1250 / 3000)
 * via portal externo + External RADIUS (mesmo modelo do Grandstream/Omada).
 * Os nomes exatos dos menus variam por modelo/firmware: confira no manual do AP.
 */

function Passo({ numero, titulo, children }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 p-6 mb-6">
      <div className="flex items-center gap-3 mb-4">
        <span className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
          {numero}
        </span>
        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{titulo}</h3>
      </div>
      <div className="text-sm text-gray-600 dark:text-gray-300 space-y-2">{children}</div>
    </div>
  );
}

function Aviso({ children }) {
  return (
    <div className="border rounded-lg px-4 py-3 my-3 text-sm bg-yellow-50 dark:bg-yellow-900/30 border-yellow-300 text-yellow-800 dark:text-yellow-200">
      <span className="mr-2">⚠️</span>
      {children}
    </div>
  );
}

export default function TutorialIntelbras() {
  const host = window.location.hostname;

  return (
    <AdminLayout>
      <div className="max-w-4xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Tutorial — Integração Intelbras</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            APs Intelbras standalone (AP 360, 1210, 1250, 3000) com portal cativo externo e autenticação RADIUS.
          </p>
        </div>

        <Aviso>
          Esta integração ainda não foi validada em um AP Intelbras real. Os nomes dos menus mudam conforme o modelo e o
          firmware; se algum campo não existir no seu AP, consulte o manual do modelo.
        </Aviso>

        <Passo numero={1} titulo="No sistema: cadastrar o equipamento">
          <p>Equipamentos → Adicionar equipamento → <b>Intelbras</b>.</p>
          <ul className="list-disc ml-5 space-y-1">
            <li><b>IP</b>: o IP do AP que enviará os pacotes RADIUS (o IP que o servidor enxerga).</li>
            <li><b>Secret RADIUS</b>: invente uma senha forte; você vai repeti-la no AP.</li>
          </ul>
          <p>Ao salvar, o sistema cadastra o AP como cliente RADIUS e anota o <b>id</b> do equipamento (aparece na lista).</p>
        </Passo>

        <Passo numero={2} titulo="No AP: servidor RADIUS">
          <ul className="list-disc ml-5 space-y-1">
            <li>Servidor: <code className="bg-gray-100 dark:bg-slate-700 rounded px-1">{host}</code></li>
            <li>Porta de autenticação <b>1812</b> e de accounting <b>1813</b></li>
            <li>Secret: o mesmo informado no passo 1</li>
          </ul>
        </Passo>

        <Passo numero={3} titulo="No AP: portal cativo externo">
          <ul className="list-disc ml-5 space-y-1">
            <li>Habilite o portal cativo no SSID de visitantes, modo portal externo/redirecionamento.</li>
            <li>
              URL do portal:{" "}
              <code className="bg-gray-100 dark:bg-slate-700 rounded px-1">https://{host}/hotspot/redirect/&lt;id&gt;</code>
            </li>
            <li>Autenticação: RADIUS (o servidor do passo 2).</li>
            <li>Acesso pré-autenticação / walled garden: libere <code className="bg-gray-100 dark:bg-slate-700 rounded px-1">{host}</code>.</li>
          </ul>
        </Passo>

        <Passo numero={4} titulo="Testar">
          <ul className="list-disc ml-5 space-y-1">
            <li>Conecte um celular ao SSID de visitantes: o portal deve abrir.</li>
            <li>Conclua o cadastro/LGPD; confira o acesso em Sessões e a primeira conexão na trilha do equipamento.</li>
          </ul>
        </Passo>

        <Passo numero={5} titulo="Problemas comuns">
          <ul className="list-disc ml-5 space-y-1">
            <li><b>Portal não abre:</b> confira a URL do portal e o walled garden.</li>
            <li><b>Autenticação recusada:</b> secret diferente nos dois lados ou IP do AP diferente do cadastrado.</li>
            <li><b>Sessão não aparece:</b> accounting (1813) bloqueado entre o AP e o servidor.</li>
          </ul>
        </Passo>
      </div>
    </AdminLayout>
  );
}
