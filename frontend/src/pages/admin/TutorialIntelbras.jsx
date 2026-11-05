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
          Validado no <b>AP 1350 AC-S</b> (Zeus OS 4.4.x). O portal cativo externo <b>só funciona com o modo de operação
          em Roteador</b>: em Bridge/Ponto de Acesso o AP não aplica o portal. Os nomes dos menus podem variar em outros modelos.
        </Aviso>

        <Passo numero={1} titulo="No sistema: cadastrar o equipamento">
          <p>Equipamentos → Adicionar equipamento → <b>Intelbras</b>.</p>
          <ul className="list-disc ml-5 space-y-1">
            <li><b>IP</b>: o IP do AP que enviará os pacotes RADIUS (o IP que o servidor enxerga).</li>
            <li><b>Secret RADIUS</b>: invente uma senha forte; você vai repeti-la no AP.</li>
          </ul>
          <p>Ao salvar, o sistema cadastra o AP como cliente RADIUS e mostra o <b>ID</b> do equipamento na coluna ID da lista. Use esse número no lugar de <code className="bg-gray-100 dark:bg-slate-700 rounded px-1">&lt;id&gt;</code> na URL do portal, sem os sinais &lt; &gt; e sem usar o IP.</p>
        </Passo>

        <Passo numero={2} titulo="No AP: modo Roteador e servidor RADIUS">
          <ul className="list-disc ml-5 space-y-1">
            <li><b>Rede → Modo de operação → Roteador</b> (NAT ligado), <b>Salvar</b> e <b>Aplicar alterações</b>. A LAN do AP não pode ter a mesma faixa da rede onde ele está ligado.</li>
            <li><b>Wireless → Radius</b>. Servidor: o IP do servidor do painel como o AP o enxerga (na VPN, normalmente <code className="bg-gray-100 dark:bg-slate-700 rounded px-1">10.8.0.1</code>); hoje o endereço do painel é <code className="bg-gray-100 dark:bg-slate-700 rounded px-1">{host}</code></li>
            <li>Porta de autenticação <b>1812</b> e de accounting <b>1813</b></li>
            <li>Secret: o mesmo informado no passo 1</li>
          </ul>
        </Passo>

        <Passo numero={3} titulo="No AP: portal cativo externo">
          <ul className="list-disc ml-5 space-y-1">
            <li><b>Serviços → Captive portal</b>: marque <b>Habilitado</b> no SSID de visitantes (segurança aberta).</li>
            <li>
              URL do portal:{" "}
              <code className="bg-gray-100 dark:bg-slate-700 rounded px-1">https://{host}/hotspot/redirect/&lt;id&gt;</code>
            </li>
            <li>Tipo de autenticação: <b>Radius</b> (e não "Externo"), usando o servidor do passo 2.</li>
            <li>Walled Garden: <b>ADICIONAR</b> <code className="bg-gray-100 dark:bg-slate-700 rounded px-1">{host}</code>, só o domínio, sem <code>http://</code>.</li>
            <li><b>Salvar</b> e, no topo direito, <b>Aplicar alterações</b>.</li>
          </ul>
        </Passo>

        <Passo numero={4} titulo="Testar">
          <ul className="list-disc ml-5 space-y-1">
            <li>Conecte um celular ao SSID de visitantes: o portal deve abrir.</li>
            <li>Conclua o cadastro/LGPD: o sistema devolve o cliente ao AP com o usuário e a senha, o AP valida no RADIUS e libera a internet.</li>
            <li>Confira o acesso em Sessões e a primeira conexão na trilha do equipamento.</li>
          </ul>
        </Passo>

        <Passo numero={5} titulo="Problemas comuns">
          <ul className="list-disc ml-5 space-y-1">
            <li><b>Portal não abre:</b> confira a URL do portal e o walled garden.</li>
            <li><b>Autenticação recusada:</b> secret diferente nos dois lados ou IP do AP diferente do cadastrado.</li>
            <li><b>Sessão não aparece:</b> accounting (1813) bloqueado entre o AP e o servidor.</li>
            <li><b>O portal não abre:</b> confira se o modo é Roteador e se clicou em Aplicar alterações.</li>
            <li><b>Cadastra, mas não libera a internet:</b> o AP não recebe o login. Veja no servidor se o acesso do AP aparece em <code>radpostauth</code> e reconecte ao Wi-Fi para gerar um pedido novo.</li>
          </ul>
        </Passo>
      </div>
    </AdminLayout>
  );
}
