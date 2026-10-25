import React, { useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";

/*
 * Tutorial passo a passo da integração com TP-Link Omada
 * (External Web Portal + External RADIUS — modelo validado em campo em 17/08/2026).
 * Prints reais do controller em /public/tutorial-omada/.
 */

// Dominio do proprio servidor (o tutorial vale para qualquer instalacao)
const HOST = typeof window !== "undefined" ? window.location.host : "seu-servidor";

function Print({ src, alt }) {
  return (
    <a href={src} target="_blank" rel="noreferrer" title="Clique para ampliar">
      <img
        src={src}
        alt={alt}
        className="rounded-lg border border-gray-200 shadow-sm my-3 w-full max-w-4xl hover:shadow-md transition-shadow cursor-zoom-in"
      />
    </a>
  );
}

function Passo({ numero, titulo, children }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
      <div className="flex items-center gap-3 mb-4">
        <span className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
          {numero}
        </span>
        <h3 className="text-lg font-semibold text-gray-800">{titulo}</h3>
      </div>
      <div className="text-sm text-gray-600 space-y-2">{children}</div>
    </div>
  );
}

function Aviso({ tipo = "info", children }) {
  const estilos = {
    info: "bg-blue-50 border-blue-200 text-blue-800",
    atencao: "bg-yellow-50 border-yellow-300 text-yellow-800",
    ok: "bg-green-50 border-green-200 text-green-800",
  };
  const icones = { info: "ℹ️", atencao: "⚠️", ok: "✅" };
  return (
    <div className={`border rounded-lg px-4 py-3 my-3 text-sm ${estilos[tipo]}`}>
      <span className="mr-2">{icones[tipo]}</span>
      {children}
    </div>
  );
}

function Campo({ nome, valor }) {
  return (
    <li className="flex flex-wrap gap-2 items-baseline">
      <span className="font-medium text-gray-700">{nome}:</span>
      <code className="bg-gray-100 rounded px-2 py-0.5 text-xs text-gray-800">{valor}</code>
    </li>
  );
}

const SECOES = [
  { id: "visao-geral", titulo: "Como funciona" },
  { id: "sistema", titulo: "Parte 1 — No sistema" },
  { id: "omada", titulo: "Parte 2 — No controller Omada" },
  { id: "teste", titulo: "Parte 3 — Testar" },
  { id: "problemas", titulo: "Problemas comuns" },
];

export default function TutorialOmada() {
  const [secaoAtiva, setSecaoAtiva] = useState("visao-geral");

  const irPara = (id) => {
    setSecaoAtiva(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <AdminLayout>
      <div className="max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Tutorial — Integração TP-Link Omada</h1>
          <p className="text-sm text-gray-500 mt-1">
            Passo a passo completo para conectar um controller Omada (OC200/OC300/software) ao sistema de hotspot,
            usando portal externo + RADIUS. Modelo homologado em produção.
          </p>
        </div>

        {/* Navegação por seções */}
        <div className="flex flex-wrap gap-2 mb-6 sticky top-0 bg-gray-50 py-2 z-10">
          {SECOES.map((s) => (
            <button
              key={s.id}
              onClick={() => irPara(s.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                secaoAtiva === s.id
                  ? "bg-blue-600 text-white"
                  : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-100"
              }`}
            >
              {s.titulo}
            </button>
          ))}
        </div>

        {/* ============ VISÃO GERAL ============ */}
        <section id="visao-geral" className="mb-10">
          <h2 className="text-xl font-bold text-gray-800 mb-3">Como funciona a integração</h2>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-sm text-gray-600 space-y-3">
            <p>
              O Omada é integrado no modo <strong>External Web Portal + External RADIUS</strong>: o controller
              redireciona o cliente do Wi-Fi para o portal deste sistema e valida usuário/senha diretamente no
              nosso servidor RADIUS. Todo o controle de tempo, velocidade, sessões e compliance (Marco Civil)
              fica centralizado aqui — igual ao MikroTik.
            </p>
            <ol className="list-decimal ml-5 space-y-1">
              <li>O cliente conecta no Wi-Fi e o Omada o redireciona para <code className="bg-gray-100 rounded px-1">{`https://${HOST}/hotspot/redirect/<ID>`}</code>;</li>
              <li>O portal (lead, LGPD, planos ou login) abre no celular do cliente;</li>
              <li>Após o cadastro/pagamento, o sistema cria as credenciais no RADIUS e o navegador conclui a autenticação no controller automaticamente;</li>
              <li>O controller valida no RADIUS (porta 1812), inicia o accounting (porta 1813) e libera a navegação;</li>
              <li>O corte por tempo (Session-Timeout), o limite de velocidade e a franquia total são aplicados pelo RADIUS.</li>
            </ol>
            <Aviso tipo="info">
              Requisitos: controller próprio (OC200, OC300 ou software v5.3.1+) ou Omada Cloud Standard.
              O plano <strong>Cloud Essentials (grátis) não suporta</strong> portal externo. Os APs precisam
              alcançar o servidor nas portas UDP 1812/1813 (internet).
            </Aviso>
          </div>
        </section>

        {/* ============ PARTE 1 — SISTEMA ============ */}
        <section id="sistema" className="mb-10">
          <h2 className="text-xl font-bold text-gray-800 mb-3">Parte 1 — Configuração no sistema</h2>

          <Passo numero="1" titulo="Confira o portal e o plano">
            <p>
              Em <strong>Portais</strong>, verifique qual portal será usado (ex.: “Cadastro de LEAD”). Em{" "}
              <strong>Planos</strong>, garanta que existe o plano correspondente — para portal de lead, um plano
              com o nome <code className="bg-gray-100 rounded px-1">Lead</code> na empresa, com a duração (minutos)
              e velocidade (Mbps) desejadas. É esse plano que define o tempo grátis e o limite de banda.
            </p>
          </Passo>

          <Passo numero="2" titulo="Cadastre o equipamento Omada">
            <p>
              Em <strong>Equipamentos → Cadastro de equipamento → Novo</strong>, escolha o tipo{" "}
              <strong>TP-Link Omada</strong> e preencha:
            </p>
            <ul className="space-y-1 mt-2">
              <Campo nome="Nome" valor="Ex.: Omada-Cliente-X" />
              <Campo nome="IP" valor="IP público do local onde estão os APs/controller" />
              <Campo nome="Senha (Secret RADIUS)" valor="Crie uma senha forte — será usada no controller" />
              <Campo nome="Controller URL" valor="DEIXE VAZIO (modo External RADIUS, recomendado)" />
              <Campo nome="Portal" valor="Selecione o portal do passo 1" />
            </ul>
            <Aviso tipo="ok">
              Ao salvar, o sistema cria o cliente RADIUS (NAS) e reinicia o FreeRADIUS automaticamente.
              Anote o <strong>ID do equipamento</strong> exibido na lista — ele monta a URL do portal externo:{" "}
              <code className="bg-green-100 rounded px-1">{`https://${HOST}/hotspot/redirect/<ID>`}</code>
            </Aviso>
            <Aviso tipo="atencao">
              Se não souber o IP público do local, cadastre com o IP aproximado e corrija depois: na primeira
              tentativa real, o IP de origem aparece nos logs do RADIUS do servidor.
            </Aviso>
          </Passo>
        </section>

        {/* ============ PARTE 2 — OMADA ============ */}
        <section id="omada" className="mb-10">
          <h2 className="text-xl font-bold text-gray-800 mb-3">Parte 2 — Configuração no controller Omada</h2>
          <p className="text-sm text-gray-500 mb-4">
            Acesse o controller (Omada Cloud ou IP local) e selecione o <strong>site</strong> do cliente.
            Todos os menus abaixo ficam em <strong>Settings / Network Config</strong>.
          </p>

          <Passo numero="1" titulo="Criar o RADIUS Profile">
            <p>
              Vá em <strong>Network Config → Profile → RADIUS Profile → Create New RADIUS Profile</strong>:
            </p>
            <ul className="space-y-1 mt-2">
              <Campo nome="Name" valor="Radius Hotspot Apex (ou outro nome)" />
              <Campo nome="Authentication Server IP" valor="92.113.34.197" />
              <Campo nome="Authentication Port" valor="1812" />
              <Campo nome="Authentication Password" valor="o Secret RADIUS cadastrado no equipamento" />
              <Campo nome="RADIUS Accounting" valor="Enable ✓" />
              <Campo nome="Interim Update" valor="Enable ✓ (600 segundos)" />
              <Campo nome="Accounting Server IP" valor="92.113.34.197" />
              <Campo nome="Accounting Port" valor="1813" />
              <Campo nome="Accounting Password" valor="o mesmo Secret" />
            </ul>
            <Print src="/tutorial-omada/02-radius-profile-auth.jpg" alt="RADIUS Profile - servidor de autenticação" />
            <Print src="/tutorial-omada/03-radius-profile-accounting.jpg" alt="RADIUS Profile - accounting" />
            <p>Depois de salvar, o profile aparece na lista:</p>
            <Print src="/tutorial-omada/01-radius-profile-lista.jpg" alt="Lista de RADIUS Profiles" />
            <Aviso tipo="atencao">
              O <strong>Interim Update habilitado é obrigatório</strong> — é ele que alimenta o contador de
              consumo do sistema durante a sessão.
            </Aviso>
          </Passo>

          <Passo numero="2" titulo="Criar (ou usar) o SSID do hotspot">
            <p>
              Em <strong>Network Config → WLAN → Create New Wireless Network</strong>: dê o nome da rede
              (ex.: <code className="bg-gray-100 rounded px-1">WiFi-Gratis</code>), marque{" "}
              <strong>Guest Network</strong> e Security <strong>None</strong> (rede aberta — a autenticação é
              feita pelo portal). Aplique.
            </p>
            <Print src="/tutorial-omada/09-ssid-lista.jpg" alt="Lista de SSIDs com portal vinculado" />
          </Passo>

          <Passo numero="3" titulo="Criar o Portal">
            <p>
              Em <strong>Network Config → Authentication → Portal → Create New Portal</strong>, aba{" "}
              <strong>Basic</strong>:
            </p>
            <ul className="space-y-1 mt-2">
              <Campo nome="Portal Name" valor="Hotspot Apex Lead (ou outro nome)" />
              <Campo nome="SSID & Network" valor="selecione o SSID do passo 2" />
              <Campo nome="HTTPS Redirection" valor="Enable ✓" />
              <Campo nome="Landing Page" valor="Original URL" />
            </ul>
            <Print src="/tutorial-omada/05-portal-basic.jpg" alt="Portal - aba Basic" />
            <p className="mt-3">
              Na aba <strong>Authentication</strong>:
            </p>
            <ul className="space-y-1 mt-2">
              <Campo nome="Authentication Type" valor="RADIUS Server" />
              <Campo nome="Authentication Timeout" valor="8 Hours" />
              <Campo nome="RADIUS Profile" valor="o profile criado no passo 1" />
              <Campo nome="Disconnect Requests" valor="Enable ✓ (porta 3799)" />
              <Campo nome="Authentication Mode" valor="PAP" />
              <Campo nome="Portal Customization" valor="External Web Portal" />
              <Campo nome="URL" valor={`https://${HOST}/hotspot/redirect/<ID_DO_EQUIPAMENTO>`} />
            </ul>
            <Print src="/tutorial-omada/06-portal-auth-radius.jpg" alt="Portal - Authentication (RADIUS)" />
            <Print src="/tutorial-omada/07-portal-auth-external.jpg" alt="Portal - PAP e External Web Portal" />
            <Aviso tipo="atencao">
              Use <strong>https://</strong> na URL e o <strong>ID correto do equipamento</strong> cadastrado no
              sistema (Parte 1, passo 2). Modo de autenticação deve ser <strong>PAP</strong>.
            </Aviso>
            <p>O portal criado aparece na lista, vinculado ao SSID:</p>
            <Print src="/tutorial-omada/04-portal-lista.jpg" alt="Lista de portais" />
          </Passo>

          <Passo numero="4" titulo="Liberar o servidor no Pre-Authentication Access">
            <p>
              Ainda em <strong>Authentication → Portal</strong>, abra a aba <strong>Access Control</strong>,
              habilite <strong>Pre-Authentication Access</strong> e adicione duas entradas:
            </p>
            <ul className="space-y-1 mt-2">
              <Campo nome="IP Range" valor="92.113.34.197 / 32" />
              <Campo nome="URL" valor={HOST} />
            </ul>
            <Print src="/tutorial-omada/08-access-control.jpg" alt="Pre-Authentication Access" />
            <Aviso tipo="atencao">
              Sem essas entradas o cliente <strong>não consegue abrir o portal</strong> antes de autenticar
              (walled garden). Se o portal for de <strong>venda com PIX</strong>, adicione também os domínios do
              Mercado Pago: <code className="bg-yellow-100 rounded px-1">mercadopago.com.br</code>,{" "}
              <code className="bg-yellow-100 rounded px-1">mercadolibre.com</code> e{" "}
              <code className="bg-yellow-100 rounded px-1">mlstatic.com</code>.
            </Aviso>
          </Passo>
        </section>

        {/* ============ PARTE 3 — TESTE ============ */}
        <section id="teste" className="mb-10">
          <h2 className="text-xl font-bold text-gray-800 mb-3">Parte 3 — Testar a integração</h2>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-sm text-gray-600 space-y-3">
            <ol className="list-decimal ml-5 space-y-2">
              <li>Conecte um celular no SSID do hotspot (com um AP <strong>online</strong> no alcance);</li>
              <li>O portal de cadastro deve abrir automaticamente (captive portal);</li>
              <li>Preencha o cadastro e envie — a internet deve liberar em poucos segundos, sem aviso de segurança;</li>
              <li>
                Confira no painel: o lead em <strong>CRM → Leads</strong>, a sessão em{" "}
                <strong>Radius → Log Radius</strong> e o registro de conexão em <strong>Marco Civil</strong>;
              </li>
              <li>Aguarde o tempo do plano esgotar: a conexão deve cair sozinha (Session-Timeout) e, ao reconectar, o portal reabre para novo cadastro.</li>
            </ol>
            <Aviso tipo="ok">
              Comportamentos validados em campo: liberação instantânea após o cadastro, reconexão automática
              enquanto há saldo, corte exato ao fim da franquia (mesmo somando várias sessões) e limite de
              velocidade do plano aplicado pelo controller (atributos WISPr).
            </Aviso>
          </div>
        </section>

        {/* ============ PROBLEMAS ============ */}
        <section id="problemas" className="mb-10">
          <h2 className="text-xl font-bold text-gray-800 mb-3">Problemas comuns</h2>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Sintoma</th>
                  <th className="px-4 py-3 font-medium">Causa provável / solução</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-600">
                <tr>
                  <td className="px-4 py-3">Portal não abre no celular</td>
                  <td className="px-4 py-3">
                    Pre-Authentication Access sem o IP/domínio do servidor (Parte 2, passo 4); AP offline; ou URL
                    do External Web Portal com ID errado.
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Cadastro conclui mas a internet não libera</td>
                  <td className="px-4 py-3">
                    Secret RADIUS diferente entre o equipamento (sistema) e o RADIUS Profile (Omada); portas UDP
                    1812/1813 bloqueadas no caminho; ou modo de autenticação diferente de PAP.
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Aviso "problemas de segurança" no celular</td>
                  <td className="px-4 py-3">
                    O sistema já autentica pela porta HTTP do portal do controller (8088) justamente para evitar o
                    certificado autoassinado. Se aparecer, confirme que o sistema está atualizado (ago/2026+).
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Tempo não renova no novo cadastro</td>
                  <td className="px-4 py-3">
                    Corrigido na atualização de ago/2026 (campo liberado_em). Confirme que o sistema está
                    atualizado e que o plano correto está vinculado ao equipamento.
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Velocidade acima do plano</td>
                  <td className="px-4 py-3">
                    O limite depende dos atributos WISPr (atualização ago/2026). Verifique a velocidade
                    configurada no plano (em Mbps) e refaça a autenticação do cliente.
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Equipamento "Offline" na lista do sistema</td>
                  <td className="px-4 py-3">
                    Normal no modo External RADIUS quando não há Controller URL — quem autentica é o RADIUS
                    local. O status relevante é o teste real com um celular.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <Aviso tipo="info">
            Modo alternativo (via API do controller): preencha Controller URL, Omada ID e o operador Hotspot no
            cadastro do equipamento. Não recomendado — sem accounting não há registro Marco Civil das sessões.
          </Aviso>
        </section>
      </div>
    </AdminLayout>
  );
}
