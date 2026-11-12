import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AdminLayout from "../../components/admin/AdminLayout";
import GatewayWizard from "../../components/admin/GatewayWizard";
import AdicionarPeerFlow from "../../components/admin/AdicionarPeerFlow";
import { useAuth } from "../../contexts/AuthContext";
import { Passo, Aviso, Campo, BotaoAcao, NavSecoes, Print } from "../../components/admin/tutorial/BlocosTutorial";

/*
 * "Comece por aqui": guia de boas-vindas para o cliente novo.
 * Ensina o caminho Peer VPN -> Equipamento -> Hotspot -> Plano/Portal -> Teste
 * e apresenta os menus do painel. Prints opcionais em /public/tutorial-inicio/
 * (a imagem some sozinha se o arquivo nao existir).
 */

const SECOES = [
  { id: "visao-geral", titulo: "Visão geral" },
  { id: "peer", titulo: "1. VPN (Peer)" },
  { id: "equipamento", titulo: "2. Equipamento" },
  { id: "hotspot", titulo: "3. Hotspot" },
  { id: "planos-portal", titulo: "4. Planos e Portal" },
  { id: "teste", titulo: "5. Testar" },
  { id: "menu", titulo: "Conheça o menu" },
  { id: "botoes", titulo: "Botões dos equipamentos" },
  { id: "problemas", titulo: "Problemas comuns" },
];

const MENUS = [
  ["Dashboard", "Resumo do dia: vendas, conectados agora, equipamentos online e sessões por equipamento."],
  ["WhatsApp", "Caixa de entrada de conversas com clientes, contatos, régua de cobrança, campanhas, modelos e relatórios."],
  ["Clientes", "Clientes/Leads, Cadastro LGPD, Importar clientes, Sessões Ativas e Log de sessões."],
  ["Vendas", "Planos de internet, Pagamentos, Vouchers (cartões com código) e Cupons de desconto."],
  ["Marketing", "Campanhas (imagens/vídeos antes do portal) e Promoções por WhatsApp."],
  ["Rede", "Equipamentos, Portais, VPN WireGuard e Usuários Radius."],
  ["Configurações", "Dados da empresa, Minha assinatura, Integrações (pagamento, WhatsApp), Marco Civil, Auditoria e Usuários."],
  ["Documentação", "Esta página e os tutoriais de Omada, UniFi, Grandstream e Intelbras."],
];

const BOTOES = [
  ["Trilha", "Mostra o checklist de ativação do equipamento (7 etapas) e o que falta."],
  ["Hotspot", "Assistente que configura o hotspot no MikroTik (interface, rede, Wi-Fi, RADIUS e páginas de login)."],
  ["Diagnosticar", "Só lê o roteador e aponta o que está errado no hotspot. Não altera nada sem você confirmar."],
  ["Wi-Fi", "Troca o nome da rede (SSID). Os aparelhos conectados caem e precisam escolher a rede nova."],
  ["Login / Status", "Reenviam as páginas login.html e status.html ao roteador. O assistente Hotspot já faz isso; use só para regravar."],
  ["Testar", "Testa a comunicação com o equipamento e atualiza Online/Offline."],
  ["Info", "Mostra informações do roteador (modelo, versão, uso)."],
  ["Editar / Remover", "Altera os dados do cadastro ou remove o equipamento."],
];

const ETAPAS_TRILHA = [
  ["Equipamento cadastrado", "O roteador existe no sistema."],
  ["Conectividade", "O sistema consegue falar com o roteador (VPN, IP e credenciais corretos)."],
  ["RADIUS (NAS)", "O roteador está autorizado no servidor de autenticação."],
  ["Hotspot configurado", "O assistente Hotspot rodou sem erro."],
  ["Portal vinculado", "O equipamento tem um portal de entrada escolhido."],
  ["Plano disponível", "Existe ao menos um plano ativo para o cliente usar."],
  ["Primeira conexão real", "Um celular conectou e fez login de verdade."],
];

function Item({ ok, texto, detalhe }) {
  return (
    <li className="flex items-start gap-3">
      <span className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${ok ? "bg-green-600 text-white" : "bg-gray-200 dark:bg-slate-600 text-gray-500 dark:text-gray-300"}`}>
        {ok ? "✓" : ""}
      </span>
      <span className="min-w-0">
        <span className={ok ? "text-gray-800 dark:text-gray-100" : "text-gray-600 dark:text-gray-300"}>{texto}</span>
        {detalhe && <span className="block text-xs text-gray-400">{detalhe}</span>}
      </span>
    </li>
  );
}

export default function ComecePorAqui() {
  const navigate = useNavigate();
  const { empresaSlug } = useParams();
  const { hasPermission } = useAuth();
  const token = localStorage.getItem("admin_token");
  const basePath = `/admin/${empresaSlug}`;
  const podePeer = hasPermission("vpn", "criar");
  const podeEquipamento = hasPermission("mikrotiks", "criar");

  const [secaoAtiva, setSecaoAtiva] = useState("visao-geral");
  const [showPeer, setShowPeer] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [portais, setPortais] = useState([]);
  // Progresso (cada bloco falha sozinho: sem permissao/erro o item simplesmente nao aparece)
  const [peers, setPeers] = useState(null);
  const [trilhas, setTrilhas] = useState(null);

  const irPara = (id) => {
    setSecaoAtiva(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const carregarProgresso = () => {
    const h = { headers: { Authorization: `Bearer ${token}` } };
    fetch("/api/wireguard/status", h).then((r) => (r.ok ? r.json() : null)).then((d) => d && setPeers(d.clients || [])).catch(() => {});
    fetch("/api/mikrotiks/trilha", h).then((r) => (r.ok ? r.json() : null)).then((d) => d && setTrilhas(d.data || {})).catch(() => {});
  };

  useEffect(() => { carregarProgresso(); /* eslint-disable-next-line */ }, []);

  const abrirWizard = () => {
    setShowWizard(true);
    fetch("/api/portais", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setPortais(Array.isArray(d) ? d : []))
      .catch(() => {});
  };

  const listaTrilhas = trilhas ? Object.values(trilhas) : null;
  const temPlano = listaTrilhas ? listaTrilhas.some((t) => (t.etapas || []).some((e) => e.chave === "plano" && e.estado === "ok")) : null;
  const temConexao = listaTrilhas ? listaTrilhas.some((t) => (t.etapas || []).some((e) => e.chave === "conexao" && e.estado === "ok")) : null;
  const ativos = listaTrilhas ? listaTrilhas.filter((t) => t.total > 0 && t.concluidas >= t.total).length : null;

  const mostrarChecklist = peers !== null || listaTrilhas !== null;

  return (
    <AdminLayout>
      <div className="max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">👋 Comece por aqui</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Passo a passo para colocar seu primeiro equipamento no ar e conhecer os menus do sistema.
          </p>
        </div>

        {mostrarChecklist && (
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 p-4 sm:p-6 mb-6">
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-3">Seu progresso</h2>
            <ul className="space-y-2 text-sm">
              {peers !== null && <Item ok={peers.length > 0} texto="VPN criada (peer)" detalhe={`${peers.length} peer(s) cadastrado(s)`} />}
              {listaTrilhas !== null && <Item ok={listaTrilhas.length > 0} texto="Equipamento cadastrado" detalhe={`${listaTrilhas.length} equipamento(s)`} />}
              {listaTrilhas !== null && <Item ok={!!temPlano} texto="Plano ativo para os clientes" />}
              {listaTrilhas !== null && <Item ok={ativos > 0} texto="Equipamento totalmente ativo" detalhe={`${ativos} de ${listaTrilhas.length} com a trilha completa`} />}
              {listaTrilhas !== null && <Item ok={!!temConexao} texto="Primeira conexão de um cliente" />}
            </ul>
          </div>
        )}

        <NavSecoes secoes={SECOES} ativa={secaoAtiva} onIr={irPara} />

        {/* ====== VISÃO GERAL ====== */}
        <section id="visao-geral" className="mb-12">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">🌐 Como tudo funciona</h2>
          <Passo numero="⚡" titulo="O caminho do cliente final até a internet">
            <p>Seu roteador fica no local do cliente (muitas vezes atrás de NAT). O sistema conversa com ele por uma <strong>VPN</strong>. Quando alguém conecta no Wi-Fi, é levado ao <strong>portal</strong>, se cadastra ou paga, e o roteador libera a internet.</p>
            <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-4 my-3 font-mono text-xs leading-relaxed overflow-x-auto">
              <p>📡 Roteador MikroTik (no local)</p>
              <p className="ml-4">↓ túnel VPN WireGuard</p>
              <p>🖥️ Este sistema (painel + RADIUS)</p>
              <p className="ml-4">↑ ↓</p>
              <p>📱 Cliente conecta no Wi-Fi → abre o portal → cadastra / paga</p>
              <p className="ml-4">↓</p>
              <p>🔐 Sistema libera o acesso no RADIUS → internet liberada pelo tempo do plano</p>
            </div>
            <p>Para colocar um equipamento no ar são 5 passos: <strong>VPN</strong> → <strong>Equipamento</strong> → <strong>Hotspot</strong> → <strong>Plano e Portal</strong> → <strong>Teste</strong>.</p>
            <Print src="/tutorial-inicio/01-visao-geral.png" alt="Visão geral" />
          </Passo>
        </section>

        {/* ====== PASSO 1 ====== */}
        <section id="peer" className="mb-12">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">1️⃣ Criar a VPN do roteador (Adicionar Peer)</h2>
          <Passo numero="1" titulo="Gerar o script e colar no roteador">
            <p>O <strong>peer</strong> é a "identidade" do seu roteador na VPN. Ao criá-lo, o sistema gera um <strong>script</strong> que configura internet, DNS, firewall, hora, VPN, API e Wi-Fi do MikroTik de uma vez.</p>
            <ol className="list-decimal ml-5 space-y-1">
              <li>Clique em <strong>+ Adicionar Peer</strong> (aqui, no Dashboard ou em Rede → VPN WireGuard).</li>
              <li>Confirme o nome do roteador (o sistema sugere um, ex.: <code>MinhaEmpresa-01</code>). Esse nome também vira o nome do Wi-Fi.</li>
              <li>Clique em <strong>Salvar e Gerar Script</strong> e depois em <strong>Copiar script</strong>.</li>
              <li>No Winbox, abra <strong>New Terminal</strong> do roteador, cole o script e aperte Enter.</li>
            </ol>
            <Aviso tipo="atencao">O script serve para MikroTik <strong>resetado com "No Default Configuration"</strong>, com a <strong>ether1</strong> ligada na internet.</Aviso>
            <Aviso tipo="atencao">Defina a senha do usuário <code>admin</code> (<code>/user set admin password=...</code>) se o script avisar. Você vai usar <strong>exatamente a mesma senha</strong> ao cadastrar o equipamento. Pode colar o script de novo sem problema.</Aviso>
            <Aviso tipo="info">Na lista de peers, <strong>Online</strong> significa que o roteador falou com o servidor nos últimos 3 minutos. <strong>Offline</strong> é normal até você colar o script e o roteador ter internet.</Aviso>
            {podePeer && <BotaoAcao cor="verde" onClick={() => setShowPeer(true)}>+ Adicionar Peer</BotaoAcao>}
            <Print src="/tutorial-inicio/02-peer.png" alt="Adicionar peer" />
          </Passo>
        </section>

        {/* ====== PASSO 2 ====== */}
        <section id="equipamento" className="mb-12">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">2️⃣ Cadastrar o equipamento</h2>
          <Passo numero="2" titulo="Assistente em 3 etapas: Tipo, Conexão e Portal">
            <ol className="list-decimal ml-5 space-y-1">
              <li>Clique em <strong>+ Adicionar Equipamento</strong>.</li>
              <li><strong>Tipo:</strong> escolha MikroTik (ou Omada, UniFi, Grandstream, Intelbras).</li>
              <li><strong>Conexão (MikroTik):</strong> clique no peer que aparece como opção — o nome e o IP da VPN são preenchidos sozinhos.</li>
              <li>Confira o usuário e a senha da API: precisam ser <strong>iguais aos do roteador</strong>. A porta padrão é 8728.</li>
              <li><strong>Portal:</strong> escolha o portal de entrada (pode ajustar depois). Clique em <strong>Salvar Equipamento</strong>.</li>
            </ol>
            <ul className="space-y-1 mt-2">
              <Campo nome="Usuário API" valor="admin (ou o usuário definido no script)" />
              <Campo nome="Porta API" valor="8728" />
            </ul>
            <Aviso tipo="info">Para Omada, UniFi, Grandstream e Intelbras o processo no controlador é diferente. Veja os tutoriais no menu <strong>Documentação</strong>:{" "}
              <Link className="underline" to={`${basePath}/tutorial-omada`}>Omada</Link>,{" "}
              <Link className="underline" to={`${basePath}/tutorial-unifi`}>UniFi</Link>,{" "}
              <Link className="underline" to={`${basePath}/tutorial-grandstream`}>Grandstream</Link> e{" "}
              <Link className="underline" to={`${basePath}/tutorial-intelbras`}>Intelbras</Link>.</Aviso>
            {podeEquipamento && <BotaoAcao onClick={abrirWizard}>+ Adicionar Equipamento</BotaoAcao>}
            <Print src="/tutorial-inicio/03-equipamento.png" alt="Adicionar equipamento" />
          </Passo>
        </section>

        {/* ====== PASSO 3 ====== */}
        <section id="hotspot" className="mb-12">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">3️⃣ Configurar o Hotspot (MikroTik)</h2>
          <Passo numero="3" titulo="Botão Hotspot na lista de Equipamentos">
            <ol className="list-decimal ml-5 space-y-1">
              <li>Vá em <strong>Rede → Equipamentos</strong> e clique em <strong>Hotspot</strong> na linha do equipamento.</li>
              <li>Escolha a <strong>interface</strong> onde os clientes se conectam e a faixa de rede (pequena, média ou grande).</li>
              <li>Preencha o <strong>Nome do Wi-Fi (SSID)</strong>, se quiser definir agora.</li>
              <li>Envie e acompanhe o log. Ao final aparece sucesso, avisos ou erros.</li>
              <li>Se houver aviso, clique em <strong>Diagnosticar</strong>: ele mostra o que ajustar.</li>
            </ol>
            <Aviso tipo="atencao">Não reaplique o script de instalação rápida depois de rodar o assistente Hotspot: ele apaga a configuração do hotspot.</Aviso>
            <Aviso tipo="atencao">Nunca escolha a interface da VPN (<code>wg-hotspot</code>) como interface do hotspot: isso derruba a conexão do painel com o roteador.</Aviso>
            <Link className="inline-block text-blue-600 dark:text-blue-400 underline" to={`${basePath}/mikrotiks`}>Ir para Equipamentos →</Link>
          </Passo>
        </section>

        {/* ====== PASSO 4 ====== */}
        <section id="planos-portal" className="mb-12">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">4️⃣ Planos e Portal</h2>
          <Passo numero="4" titulo="O que o cliente vê e o que pode comprar">
            <ul className="list-disc ml-5 space-y-1">
              <li><strong>Vendas → Planos:</strong> crie os planos (tempo, velocidade e valor). Planos gratuitos liberam acesso sem pagamento.</li>
              <li><strong>Rede → Portais:</strong> escolha e personalize o portal (logo, cores, textos, LGPD, PIX e cartão).</li>
              <li>Cada equipamento tem um portal vinculado. Você troca isso em <strong>Editar</strong> no equipamento.</li>
              <li>Para receber pagamentos, configure em <strong>Configurações → Integrações</strong> (Mercado Pago, Asaas ou EFI).</li>
            </ul>
            <div className="flex flex-wrap gap-4 pt-1">
              <Link className="text-blue-600 dark:text-blue-400 underline" to={`${basePath}/planos`}>Ir para Planos →</Link>
              <Link className="text-blue-600 dark:text-blue-400 underline" to={`${basePath}/portais`}>Ir para Portais →</Link>
              <Link className="text-blue-600 dark:text-blue-400 underline" to={`${basePath}/integracoes`}>Ir para Integrações →</Link>
            </div>
          </Passo>
        </section>

        {/* ====== PASSO 5 ====== */}
        <section id="teste" className="mb-12">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">5️⃣ Testar com um celular</h2>
          <Passo numero="5" titulo="Conecte no Wi-Fi e faça o login no portal">
            <p>Conecte um celular na rede Wi-Fi do equipamento. O portal deve abrir sozinho. Complete o cadastro (ou pagamento) e confirme que a internet liberou. Depois acompanhe em <strong>Clientes → Sessões Ativas</strong>.</p>
            <p className="font-medium text-gray-700 dark:text-gray-200 pt-2">A Trilha de ativação de cada equipamento tem 7 etapas:</p>
            <ol className="list-decimal ml-5 space-y-1">
              {ETAPAS_TRILHA.map(([t, d]) => (
                <li key={t}><strong>{t}:</strong> {d}</li>
              ))}
            </ol>
            <Aviso tipo="ok">Quando as 7 etapas ficam verdes, o botão da Trilha vira <strong>✓ Ativo</strong>.</Aviso>
          </Passo>
        </section>

        {/* ====== MENU ====== */}
        <section id="menu" className="mb-12">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">🧭 Conheça o menu</h2>
          <Passo numero="📋" titulo="O que tem em cada grupo">
            <ul className="space-y-2">
              {MENUS.map(([nome, desc]) => (
                <li key={nome}><strong className="text-gray-800 dark:text-gray-100">{nome}:</strong> {desc}</li>
              ))}
            </ul>
            <Aviso tipo="info">Você só vê os itens que o seu perfil permite. O perfil <strong>Usuário Padrão</strong> tem acesso operacional (clientes, pagamentos, sessões); o <strong>Administrador</strong> vê tudo.</Aviso>
          </Passo>
        </section>

        {/* ====== BOTÕES ====== */}
        <section id="botoes" className="mb-12">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">🔘 Botões da lista de Equipamentos</h2>
          <Passo numero="🛠️" titulo="Para que serve cada um">
            <ul className="space-y-2">
              {BOTOES.map(([nome, desc]) => (
                <li key={nome}><strong className="text-gray-800 dark:text-gray-100">{nome}:</strong> {desc}</li>
              ))}
            </ul>
            <p className="pt-2">No topo da tela há também <strong>Aplicar padrões em todos</strong> (ajustes recomendados em todos os MikroTik) e <strong>Alertas offline</strong> (aviso por WhatsApp quando um equipamento cair).</p>
          </Passo>
        </section>

        {/* ====== PROBLEMAS ====== */}
        <section id="problemas" className="mb-12">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">🩺 Problemas comuns</h2>
          <Passo numero="?" titulo="O que fazer quando algo não funciona">
            <ul className="space-y-3">
              <li><strong className="text-gray-800 dark:text-gray-100">Peer fica Offline:</strong> confira se o roteador tem internet, se colou o script inteiro e se a ether1 é a porta da internet. Pode colar o script de novo.</li>
              <li><strong className="text-gray-800 dark:text-gray-100">Equipamento Offline / "Falha" ao testar:</strong> a VPN precisa estar Online e o usuário/senha da API iguais aos do roteador.</li>
              <li><strong className="text-gray-800 dark:text-gray-100">Portal não abre no celular:</strong> clique em <strong>Diagnosticar</strong> no equipamento e aplique as correções sugeridas.</li>
              <li><strong className="text-gray-800 dark:text-gray-100">Conectou no Wi-Fi mas ficou sem internet:</strong> o cliente precisa concluir o cadastro/pagamento no portal. Veja em Sessões Ativas e Log de sessões.</li>
              <li><strong className="text-gray-800 dark:text-gray-100">Trocou o nome do peer e o roteador não mudou:</strong> o novo nome só vale ao gerar um novo script; para mudar só o Wi-Fi use o botão <strong>Wi-Fi</strong>.</li>
            </ul>
          </Passo>
        </section>
      </div>

      <AdicionarPeerFlow
        open={showPeer}
        onClose={() => { setShowPeer(false); carregarProgresso(); }}
        proximoPasso={podeEquipamento ? { label: "Já colei, cadastrar equipamento", onClick: abrirWizard } : null}
      />
      <GatewayWizard
        open={showWizard}
        onClose={() => setShowWizard(false)}
        onSaved={() => { setShowWizard(false); navigate(`${basePath}/mikrotiks`); }}
        portais={portais}
        token={token}
        editando={null}
      />
    </AdminLayout>
  );
}
