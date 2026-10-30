# Hotspot - Sistema Multi-Tenant de Captive Portal WiFi

## Visao Geral

Sistema completo de gerenciamento de Hotspot WiFi com captive portal, autenticacao RADIUS, integracao MikroTik, pagamentos (Mercado Pago / EFI PIX), conformidade LGPD e Marco Civil da Internet. Arquitetura multi-tenant com isolamento por empresa.

**Servidor de producao:** glpi.forumtelecom.com.br
**Diretorio:** /var/www/hotspot

---

## Stack Tecnologica

### Backend (porta 3001)
- **Runtime:** Node.js
- **Framework:** Express 5.1.0
- **Banco de dados:** MySQL 8.0.42 (mysql2) - SQL puro via db.execute(), sem ORM
- **Autenticacao:** JWT (jsonwebtoken 9.0.2)
- **Criptografia:** bcryptjs / bcrypt
- **MikroTik API:** node-routeros 1.6.8
- **Upload:** multer 2.0.2
- **HTTP Client:** axios
- **WhatsApp:** Evolution API (HTTP, via WHATSAPP_API_URL)

### Frontend
- **Framework:** React 19.1.0
- **Build:** Vite 7.0.4
- **CSS:** Tailwind CSS 3.4.1
- **Roteamento:** React Router 7.7.0
- **Formularios:** formularios controlados nativos (sem lib de forms)
- **Icones:** Lucide React
- **HTTP:** Axios

### Infraestrutura
- **VPN:** WireGuard (wg-easy via Docker)
- **RADIUS:** FreeRADIUS (tabelas no mesmo MySQL)
- **Certificados:** /var/www/hotspot/backend/certificados/ (EFI PIX)

---

## Estrutura de Diretorios

```
/var/www/hotspot/
├── backend/
│   ├── server.js                    # Entry point Express
│   ├── db.js                        # Pool de conexao MySQL
│   ├── .env                         # Variaveis de ambiente
│   ├── package.json
│   ├── certificados/                # Certificados EFI PIX
│   ├── tokens/                      # Armazenamento de tokens
│   ├── migrations/                  # Migracoes incrementais (001-026)
│   ├── jobs/
│   │   └── estrutura.sql            # Schema completo do banco (dump)
│   ├── src/
│   │   ├── controllers/             # Logica de negocio (23+ controllers)
│   │   ├── routes/                  # Rotas da API (25+ arquivos)
│   │   ├── models/                  # Modelos (mysql2 db.execute, sem ORM)
│   │   ├── middleware/
│   │   │   ├── auth.js              # Verificacao JWT
│   │   │   ├── tenant.js            # Resolucao empresa_id
│   │   │   └── authorize.js         # Verificacao de roles
│   │   ├── jobs/                    # Background jobs
│   │   │   ├── syncConnectionLogs.js # Sync radacct -> connection_logs
│   │   │   └── verificaExpiracoes.js # Verificar planos expirados
│   │   └── utils/
│   │       ├── mikrotikClient.js    # Cliente RouterOS API
│   │       └── hotspotSetup.js      # Configuracao hotspot
│   └── routes/                      # Rotas legadas admin
├── frontend/
│   ├── src/
│   │   ├── App.jsx                  # Rotas da aplicacao
│   │   ├── contexts/
│   │   │   └── AuthContext.jsx       # Contexto de autenticacao
│   │   ├── pages/
│   │   │   ├── admin/               # Paginas do painel admin
│   │   │   ├── public/              # Paginas do captive portal
│   │   │   └── super/               # Paginas super admin
│   │   └── components/              # Componentes reutilizaveis
│   ├── dist/                        # Build de producao
│   └── vite.config.js
├── infra/
│   └── wireguard/
│       └── docker-compose.yml       # WireGuard wg-easy container
└── docs/
    └── PLAN.md                      # Plano de integracao WireGuard
```

---

## Variaveis de Ambiente

Arquivo: `/var/www/hotspot/backend/.env`

| Variavel | Descricao | Exemplo |
|----------|-----------|---------|
| PORT | Porta do backend | 3001 |
| DB_HOST | Host do MySQL | 127.0.0.1 |
| DB_USER | Usuario MySQL | hotspotuser |
| DB_PASSWORD | Senha MySQL | senhaforte123 |
| DB_NAME | Nome do banco | hotspot |
| DB_PORT | Porta MySQL (opcional) | 3306 |
| JWT_SECRET | Segredo para tokens JWT | segredo_super_secreto |
| WHATSAPP_API_URL | URL da API WhatsApp | https://glpi.forumtelecom.com.br |

**Nota:** Configuracoes de pagamento (Mercado Pago, EFI) ficam no banco de dados na tabela `empresa_configs`, nao em .env.

---

## Banco de Dados

### Tabelas Principais

#### Multi-Tenant
| Tabela | Descricao |
|--------|-----------|
| `empresas` | Empresas/clientes (id, nome, slug, cnpj, email, telefone, logo_url, ativo) |
| `empresa_configs` | Config por empresa - JSON (mercadopago, efi, whatsapp) |
| `admins` | Usuarios admin (empresa_id, email, password, nome, role) |

#### Rede / Hotspot
| Tabela | Descricao |
|--------|-----------|
| `mikrotiks` | Roteadores MikroTik (empresa_id, nome, ip, usuario, senha, porta, vpn_ip, status) |
| `nas` | Clientes RADIUS NAS (empresa_id, nasname, shortname, secret) |
| `portais` | Portais captive (empresa_id, mikrotik_id, tipo, html_content, template_id, custom_css, logo_url, cores, campos_cadastro, mostrar_planos, mostrar_lgpd, url_redirect) |
| `portal_templates` | Templates reutilizaveis (nome, html_template, css_template, tipo: basico/planos/lgpd/completo) |
| `empresa_vpn_peers` | Peers WireGuard VPN (empresa_id, wg_client_id, nome) |

#### RADIUS (FreeRADIUS)
| Tabela | Descricao |
|--------|-----------|
| `radcheck` | Credenciais usuario (username, Cleartext-Password) |
| `radreply` | Respostas RADIUS (Mikrotik-Rate-Limit, Session-Timeout) |
| `radusergroup` | Mapeamento usuario-grupo |
| `radacct` | Accounting - sessoes, uso de dados, tempos |
| `radpostauth` | Log de autenticacao |
| `radgroupcheck` | Verificacao de grupo |
| `radgroupreply` | Resposta de grupo |
| `radius_users` | Registro de usuarios RADIUS (empresa_id, username, plano_id, nas_id) |

#### Usuarios e Pagamentos
| Tabela | Descricao |
|--------|-----------|
| `planos` | Planos de internet (empresa_id, nome, valor, duracao_minutos, velocidade_down/up, mikrotik_id, address_pool, shared_users) |
| `pagamentos` | Transacoes (empresa_id, plano_id, valor, status, mp_pagamento_id, mac, cpf, IP) |
| `leads` (origem='lgpd') | Consentimento LGPD (cpf, nome, telefone, lgpd_aceite, lgpd_aceite_em, lgpd_termo, mac, ip). `lgpd_logins` NAO existe mais (so `lgpd_logins_backup`) |
| `leads` | Leads marketing (empresa_id, nome, email, telefone, cpf, mac, ip, origem, status, lgpd_aceite) |
| `connection_logs` | Logs Marco Civil (sync de radacct para compliance) |

#### Legadas (migradas para empresa_configs)
| Tabela | Descricao |
|--------|-----------|
| `config_mercadopago` | Config MP legada (public_key, access_token, client_id, client_secret) |
| `efi_config` | Config EFI legada (client_id, client_secret, chave_pix, ambiente, certificado) |

### Migracoes

Executar em ordem:
```bash
cd /var/www/hotspot/backend
node migrations/001_multi_tenant.js    # Cria empresas, empresa_configs, adiciona empresa_id em todas tabelas
node migrations/002_leads.js           # Cria tabela leads
node migrations/003_connection_logs.js # Cria tabela connection_logs
node migrations/004_portal_templates.js # Cria portal_templates, adiciona colunas em portais
node migrations/005_vpn_peers.js       # Cria empresa_vpn_peers
# ... e assim por diante ate a 026 (rodar todas em ordem numerica: for f in migrations/[0-9][0-9][0-9]_*.js)
```

Migrations recentes (006-026, conforme `backend/migrations/`):

| # | Arquivo | Mudanca |
|---|---|---|
| 006 | `006_mikrotik_portal_id` | `mikrotiks.portal_id` (+FK) |
| 007-008 | `007_portal_template_lead_passivo`, `008_inserir_portais_lead_passivo` | template e portal Lead Passivo |
| 009-010 | `009_system_updates`, `010_update_publish` | tabelas do sistema de atualizacao |
| 011 | `011_campanhas` | `campanhas`, `campanha_itens`, `portais.campanha_ativa_id` |
| 012 | `012_whatsapp_notif` | WhatsApp por portal + `whatsapp_logs` |
| 013 | `013_pix_trial` | `pagamentos.trial_liberado_em` + indice |
| 014-015 | `014_schema_snapshots`, `015_update_apply_logs` | snapshots de schema e logs do apply |
| 016 | `016_liberado_em` | `radius_users.liberado_em` + indice por username |
| 017 | `017_connection_logs_unique` | `connection_logs.acctuniqueid` UNIQUE, `connection_logs_sync.last_synced_at` |
| 018 | `018_grupo_completo` | grupo "Acesso Completo" (permissoes) para admins sem grupo |
| 019-020 | `019_gateways`, `020_gateway_credenciais_opcionais` | multi-vendor (tipo, controller_*, api_*), `usuario`/`senha` NULLABLE |
| 021 | `021_lgpd_termo` | `leads.lgpd_termo` |
| 022 | `022_portal_contexts` | tabela `portal_contexts` (contexto do vendor no redirect) |
| 023 | `023_radius_users_unique` | dedup + UNIQUE `uk_radius_users_username` |
| 024 | `024_ap_info` | `ap_mac`/`ssid` em `connection_logs` e `leads`, tabela `access_points`, backfill do radacct |
| 025 | `025_grandstream_gateway` | ENUM `mikrotiks.tipo` + 'grandstream'; colunas `gwn_api_key`, `gwn_api_secret`, `gwn_network_id` |
| 026 | `026_leads_data_nascimento` | `leads.data_nascimento` (DATE) |
| 029 | `029_leads_cadastro_completo` | `leads`: tipo_pessoa, rg, cnpj, razao_social, endereco (cep..uf), `id_externo`, `sistema_origem`, `importado_em`; `origem` vira VARCHAR(30); indices `(empresa_id,cpf)` e `(empresa_id,sistema_origem,id_externo)`; `empresa_configs.config_type` ganha 'sgp' |
| 030 | `030_pagamentos_pagador_cpf` | `pagamentos.pagador_cpf` VARCHAR(20) NULL (CPF de quem pagou; usado por `cpfConfirmado`) |
| 032 | `032_planos_padrao` | `planos.mikrotik_id` NULLABLE + backfill dos planos gratis "LGPD" e "Lead" (60 min, 20M down / 10M up) em todas as empresas; novas empresas ganham via `empresaSetup.criarPlanosPadrao` (nascem sem equipamento; o 1o equipamento cadastrado em `mikrotikRoutes.js` os assume). Nao duplicar o INSERT |
| 031 | `031_assinaturas` | SaaS: `saas_planos`, `assinaturas` (1/empresa), `assinatura_cobrancas`, `plataforma_configs`; seeds: 3 planos exemplo + assinatura de cortesia (ativa, +1 ano) p/ empresas existentes |
| 032 | `032_admin_empresas_backfill` | vincula em `admin_empresas` os admins sem vinculo (criados pela tela Usuarios antes da correcao); idempotente |
| 033 | `033_perfis_usuario` | garante os perfis do sistema (Acesso Completo / Usuário Padrão) e promove a Administrador o primeiro admin de cada empresa sem grupo |
| 037 | `037_empresas_cadastro_completo` | `empresas`: razao_social, nome_fantasia, cep, logradouro, numero, complemento, bairro, cidade, uf |
| 034 | `034_planos_padrao_60min` | atualiza os planos gratis LGPD (5 min) e Lead (1 min) com 2/2 Mbps para 60 min, 100M down / 50M up; so toca quem ainda esta no padrao antigo (nao sobrescreve plano personalizado); idempotente |
| 035 | `035_planos_padrao_20_10` | planos gratis LGPD/Lead de 100/50 para 20M down / 10M up (60 min mantidos); so toca quem ainda esta em 60 min + 100/50 (nao sobrescreve personalizado); idempotente |
| 036 | `036_planos_default_dedup` | empresa `default`: deixa UM plano LGPD e UM Lead (o mais referenciado), reaponta `plano_id` de todas as tabelas + `radusergroup` e apaga os duplicados; o que fica vira 60 min / 20M down / 10M up. So age com duplicados (nao repete); `--dry` so mostra |
| 039 | `039_empresas_cpf` | `empresas.tipo_pessoa` ENUM('PJ','PF') DEFAULT 'PJ' e `empresas.cpf` (so digitos, NULL em PJ) + indice `idx_empresas_cpf`; idempotente. **Rodar no servidor antes de usar o cadastro por CPF** |
| 041 | `041_adicionais_saas` | `saas_adicionais` (catalogo: tipo, incremento, valor, ciclo_dias, plano_minimo_id, ativo), `assinatura_adicionais` (compras da empresa, vence_em proprio) e `assinatura_cobrancas.adicional_id/quantidade/assinatura_adicional_id`; seeds: +1/+5 equipamentos e +1 admin ativos, 6 outros inativos; idempotente. **Rodar no servidor antes de usar os adicionais** |
| 042 | `042_dono_plataforma` | `admins.dono_plataforma` TINYINT(1) DEFAULT 0 + marca `tavaresdobrasil@outlook.com` (se for super_admin) como dono; idempotente. **Rodar no servidor antes de usar o perfil Dono** |
| 043 | `043_recursos_saas` | `saas_planos`: `inclui_whatsapp`/`inclui_campanhas`/`inclui_exportacao` (TINYINT, default 0) e `max_portais` (NULL = ilimitado); backfill: planos PAGOS passam a incluir tudo (nao perde quem usa), plano gratis (valor 0) fica sem recursos; ativa os adicionais de seed de portais/whatsapp/campanhas/exportacao; idempotente. **Rodar no servidor antes de editar planos com recursos** |
| 038 | `038_campanhas_metricas_agenda` | tabela `campanha_metricas` (`campanha_id`, `empresa_id`, `item_id` (0 = total da campanha), `dia`, `views`, `cliques`, UNIQUE por campanha+item+dia) e colunas `campanhas.data_inicio`, `data_fim`, `frequencia` ENUM('sempre','sessao','diaria') (agendamento/frequencia: ver secao Campanhas); idempotente |
| 040 | `040_unicos_admins_nas` | UNIQUE em `admins.email` e `nas.nasname` (`uk_admins_email`, `uk_nas_nasname`); so cria se nao houver duplicatas (senao lista os casos e nao apaga nada); idempotente |
| 039 | `039_promocoes_whatsapp` | `leads.whatsapp_optout`/`whatsapp_optout_em` (quem pediu para sair) e tabelas `promocao_envios` (fila: status rascunho/em_andamento/pausada/concluida/cancelada + contadores) e `promocao_destinatarios` (1 linha por telefone, UNIQUE envio+telefone); idempotente |
| 043 | `043_vouchers` | tabela `vouchers` (codigo UNIQUE por empresa, plano_id, lote, status disponivel/usado/cancelado, valido_ate, usado_mac/usado_em/username) e portal `Acesso por Voucher` (tipo `voucher`, `/voucher`) em todas as empresas; idempotente. **Rodar no servidor antes de usar vouchers** |
| 044 | `044_vouchers_equipamento` | `vouchers.mikrotik_id` (+indice) = equipamento exclusivo do voucher; backfill com o `planos.mikrotik_id` do plano (sem equipamento = NULL = legado, vale em qualquer equipamento da empresa); idempotente. **Rodar no servidor antes de gerar vouchers** |
| 045 | `045_vouchers_impresso` | `vouchers.impresso_em` DATETIME NULL (+indice) = quando o cartao foi impresso (NULL = nunca); sem backfill; idempotente. **Rodar no servidor antes de usar a impressao com selecao** |
| 047 | `047_planos_gratis_trial` | `saas_planos.gratis` (plano nunca vence/bloqueia; valor forcado a 0; `calcularEstado` devolve ativa com `gratis:true`, `criarTrial` cria assinatura ativa sem vencimento) e `saas_planos.trial_dias` (NULL = 7; `diasDeTeste`); idempotente. **Rodar no servidor antes de salvar planos pelo modal** |
| 046 | `046_dominio_proprio` | `empresas.dominio_portal` (UNIQUE), `dominio_status` ('pendente','dns_ok','ativo','erro'), `dominio_erro`, `dominio_ativado_em` e `saas_planos.inclui_dominio` (backfill: planos pagos incluem; ativa o adicional de seed `dominio`); idempotente. **Rodar no servidor antes de usar o dominio proprio** |
| 048 | `048_whatsapp_atendimento` | `whatsapp_conversas` (UNIQUE empresa+jid) e `whatsapp_mensagens` (UNIQUE empresa+wa_id, direcao in/out/nota, status enviando/enviada/entregue/lida/erro); idempotente. **Rodar no servidor antes de usar o menu WhatsApp** |
| 049 | `049_whatsapp_atendimento_extras` | `whatsapp_etiquetas` (UNIQUE empresa+nome, cor #rrggbb), `whatsapp_conversa_etiquetas` (conversa x etiqueta) e `whatsapp_respostas_rapidas` (UNIQUE empresa+atalho); idempotente. **Rodar no servidor antes de usar etiquetas e respostas rapidas** (sem ela a tela segue, so sem esses recursos) |
| 050 | `050_leads_indices_telefone` | `leads.telefone_fim10` (coluna gerada STORED = ultimos 10 digitos do telefone) + indices `(empresa_id, telefone_fim10)`, `(empresa_id, criado_em)`, `(empresa_id, status)`; idempotente; se o MySQL recusar a coluna avisa e segue. O ALTER trava escrita em `leads` por alguns segundos: rodar em horario calmo. **Rodar no servidor** (sem ela tudo funciona, so mais lento: `utils/telefoneBusca.exprTelefoneFim10` cai na expressao REGEXP antiga) |
| 051 | `051_whatsapp_atendimento_dia_a_dia` | `whatsapp_conversas.atendente_id`/`atribuido_em` (+indice `idx_wa_conversa_atendente`) e `whatsapp_mensagens.resposta_a_wa_id`/`resposta_previa` (citacao); idempotente. **Rodar no servidor** (sem ela a tela segue, so sem atendente/citacao: `utils/schemaCache.temColuna` esconde o recurso e assumir/transferir respondem 503 com a instrucao) |
| 052 | `052_whatsapp_automacao` | `whatsapp_conversas.auto_resposta_em`, `whatsapp_mensagens.automatica` e tabela `whatsapp_agendadas` (empresa_id, conversa_id, tipo mensagem/lembrete, texto, enviar_em, status pendente/enviada/cancelada/erro); idempotente. **Rodar no servidor** (sem ela a tela segue; ativar a resposta automatica responde 503 com a instrucao e o job de agendadas ignora a tabela ausente) |
| 053 | `053_whatsapp_aviso_expiracao` | tabela `whatsapp_avisos_expiracao` (UNIQUE empresa_id+username+liberado_em = 1 aviso por ciclo de liberacao); idempotente. **Rodar no servidor antes de ligar o aviso de expiracao** (sem ela o job ignora a tabela ausente) |
| 054 | `054_whatsapp_relatorios` | `whatsapp_conversas.nota_satisfacao`/`satisfacao_em`/`satisfacao_pedida_em` e `whatsapp_mensagens.midia_expirada_em`; idempotente. **Rodar no servidor** (sem ela relatorios/IA/Hoje seguem, so sem notas de satisfacao; o expurgo de midia nao age: `utils/schemaCache.temColuna`) |
| 056 | `056_leads_mikrotik_id` | `leads.mikrotik_id` (INT NULL, sem FK) + indice `(empresa_id, mikrotik_id)` e backfill por `radius_users.nas_id` e `connection_logs`; idempotente. **Rodar no servidor antes de usar o filtro Equipamento** (sem ela a tela segue, so sem o filtro) |
| 055 | `055_audit_logs` | tabela `audit_logs` (empresa_id, admin_id, acao, entidade, entidade_id, detalhes, ip, criado_em); idempotente. **Rodar no servidor** (sem ela a tela Auditoria responde 503 com a instrucao e o registro e' ignorado em silencio) |
| 056 | `056_equipamento_status` | tabela `equipamento_status` (mikrotik_id PK, empresa_id, online, falhas, falha_desde, alertado, alertado_em, verificado_em, erro); idempotente. **Rodar no servidor antes de ligar os alertas de equipamento** (sem ela o job ignora a tabela ausente e a tela mostra so a config) |
| 057 | `057_promocao_envios_tipo` | `promocao_envios.tipo` ENUM('promocao','aviso') DEFAULT 'promocao' (envios antigos viram promocao); idempotente. **Rodar no servidor antes de usar o aviso operacional** (sem ela criar aviso responde 503 com a instrucao e a lista de promocoes segue igual) |
| 058 | `058_whatsapp_chatbot` | `whatsapp_conversas.chatbot_estado` VARCHAR(12) ('menu'/'humano'/NULL) e `chatbot_em` DATETIME; idempotente. **Rodar no servidor antes de ligar o chatbot** (sem ela o chatbot fica inativo e ativar responde 503 com a instrucao) |
| 059 | `059_whatsapp_pos_compra` | tabela `whatsapp_pos_compra` (UNIQUE empresa_id+etapa+referencia_id; etapas `agradecimento` = pagamento, `avaliacao`/`alerta` = mensagem da nota); idempotente. **Rodar no servidor antes de ligar o pos-compra** (sem ela o job ignora a tabela ausente e ativar responde 503 com a instrucao) |
| 060 | `060_cupons` | tabelas `cupons` (UNIQUE empresa_id+codigo; tipo percentual 1-99 ou valor em centavos; plano_id NULL = todos; valido_ate; max_usos; usos; ativo) e `cupom_usos` (UNIQUE pagamento_id), mais `pagamentos.cupom_id`/`valor_original`; idempotente. **Rodar no servidor antes de usar cupons** (sem ela cupom nunca e aceito no portal e a tela Cupons responde 503 com a instrucao) |
| 061 | `061_whatsapp_cobrancas` | tabela `whatsapp_cobrancas` (UNIQUE empresa_id+pagamento_id+etapa; telefone, status enviada/ignorada/erro, enviado_em; indice por telefone); idempotente. **Rodar no servidor antes de ligar a renovacao** (sem ela o job ignora a tabela ausente e ativar responde 503 com a instrucao) |
| 062 | `062_whatsapp_modelos_categoria` | `whatsapp_respostas_rapidas.categoria` VARCHAR(20) DEFAULT 'geral' (geral/boas_vindas/cobranca/promocao/manutencao); idempotente. **Rodar no servidor** (sem ela os modelos seguem funcionando, so sem categorias: `schemaCache.temColuna`) |
| 063 | `063_whatsapp_nao_perturbe` | tabela `whatsapp_nao_perturbe` (UNIQUE empresa_id+telefone_fim10; telefone, motivo, origem manual/sair/importado, criado_em); idempotente. **Rodar no servidor** (sem ela a lista fica vazia e adicionar/importar responde 503 com a instrucao; o opt-out dos leads segue valendo) |
| 064 | `064_manutencoes` | tabelas `manutencoes` (titulo, mensagem, mensagem_fim, equipamento_id NULL = todos, inicio_em/fim_em DATETIME, antecedencias JSON, aviso_fim, avisar_clientes, janela_dias, status agendada/em_andamento/concluida/cancelada) e `manutencao_avisos` (UNIQUE manutencao_id+etapa); idempotente. **Rodar no servidor antes de usar Manutencoes** (sem ela a aba mostra o aviso, criar responde 503 e o job/alerta offline ignoram a tabela ausente) |
| 068 | `068_planos_exibir_site` | `saas_planos.exibir_site` TEXT NULL = lista JSON do que o card do plano mostra no site (`todos_recursos`, `teste`, `whatsapp`, `campanhas`, `exportacao`, `dominio`, `portais`); NULL = padrao (recursos incluidos + teste em plano pago); marcado em Planos SaaS ("Mostrar no card do plano"), lido por `utils/itensSitePlano.js` na landing; idempotente. **Rodar no servidor antes de usar** (sem ela o plano salva e avisa) |
| 069 | `069_planos_periodos` | `saas_planos.desconto_3m/6m/12m` DECIMAL(5,2) NULL (percentual; NULL = periodo nao oferecido) e `assinatura_cobrancas.meses` INT DEFAULT 1; idempotente. Contrato de 3/6/12 meses: total SEMPRE calculado no servidor (`utils/periodoPlano.valorDoPeriodo`, `resolverItem` le `meses`), `ativarPorCobranca` estende `vence_em` por `meses` (ciclo 30 dias = `INTERVAL n MONTH`); seletor na tela Assinatura, na landing e no `/registro` (guarda `localStorage.periodo_assinatura`).  "Aplicar a todos os planos" no editor (`aplicar_todos`) copia os 3 descontos para os planos pagos (grátis fica de fora). **Rodar no servidor antes de preencher os descontos** (sem ela o plano salva com aviso e cobranca de varios meses responde erro, nunca cobra o total sem registrar o periodo) |
| 072 | `072_intelbras_gateway` | ENUM `mikrotiks.tipo` + 'intelbras' (AP standalone via portal externo + External RADIUS, igual ao Grandstream; `ip` = IP do AP, `senha` = secret RADIUS; `gateways/IntelbrasDriver.js`, tutorial em `TutorialIntelbras.jsx`, rota `/admin/:slug/tutorial-intelbras`). Os nomes dos parametros do redirect/login final assumem o mesmo formato do GWN (`login_url`, `client_mac`) e **nao foram validados em AP Intelbras real** (`TODO(hardware)`); idempotente. **Rodar no servidor antes de cadastrar Intelbras** |
| 071 | `071_planos_destaque` | `saas_planos.destaque` TINYINT(1) DEFAULT 0 = plano favorito em destaque na landing ("Mais escolhido"); so um por vez (`salvarDestaque` desmarca os outros); nenhum marcado = padrao antigo (2o de 3+ planos); checkbox "Plano favorito" no editor de Planos SaaS; idempotente. **Rodar no servidor antes de usar** (sem ela o plano salva com aviso) |
| 065 | `065_alertas_tecnicos` | tabela `alertas_tecnicos` (empresa_id, tipo equipamento_offline/equipamento_online/whatsapp_desconectado/manual, equipamento_id, severidade, titulo, detalhes, criado_em, resolvido_em, clientes_avisados_em, clientes_volta_avisados_em); idempotente. **Rodar no servidor antes de usar Alertas tecnicos** (sem ela o feed mostra o aviso, criar responde 503 e o job ignora a tabela ausente) |
| 066 | `066_indicacoes` | tabelas `indicacoes_codigos` (UNIQUE empresa_id+codigo e empresa_id+lead_id) e `indicacoes` (indicador, `indicado_cpf` so digitos, `pagamento_id` UNIQUE, status cadastrada/comprou/recompensada/recusada, `cupom_indicador_id`, motivo) e `pagamentos.indicacao_id`; idempotente. **Rodar no servidor antes de ligar as indicacoes** (sem ela o codigo de indicacao nunca e aceito e a aba mostra o aviso; cupons comuns seguem normais) |
| 067 | `067_pagamentos_gateway` | `pagamentos.gateway` VARCHAR(20) (`'asaas'`; NULL = Mercado Pago) e `pagamentos.mp_pagamento_id` vira VARCHAR(64) (o id da cobranca Asaas e' `pay_xxxx`); idempotente. **Rodar no servidor antes de ligar o Asaas** (sem ela o PIX Asaas falha ao gravar `gateway`) |
| 068 | `068_empresa_configs_asaas` | `empresa_configs.config_type` (ENUM) ganha `'asaas'`, preservando os valores existentes; idempotente. **Rodar no servidor ANTES de salvar a config do Asaas** (sem ela salvar a chave e gerar a URL do webhook falham no banco) |
| 070 | `070_empresa_painel` | tabelas `empresa_notas` (anotacoes internas do dono da plataforma) e `empresa_historico` (acao + detalhe curto + admin, por empresa); idempotente. **Rodar no servidor antes de usar notas/historico do painel da empresa** (sem ela o painel abre e so avisa; as acoes seguem, sem registro no historico) |

---

## Autenticacao e Autorizacao

### JWT
- Token gerado no login com `empresa_id`, `role`, `email`, `empresa_slug`
- Expiracao: 24 horas
- Armazenado no frontend em `localStorage` como `admin_token`
- Enviado no header: `Authorization: Bearer <token>`

### Roles (RBAC)
| Role | Permissoes |
|------|-----------|
| `super_admin` | Acesso total, gerencia todas empresas, pode usar header `x-empresa-id` |
| `owner` | Acesso completo da empresa |
| `manager` | Gerenciamento limitado |
| `operator` | Operacoes basicas |

### Middleware Chain
```
request -> auth.js (verifica JWT) -> tenant.js (resolve empresa_id) -> authorize(roles) -> controller
```

O middleware `tenant.js` extrai `empresa_id` do JWT. Super admin pode sobrescrever via header `x-empresa-id`.

---

## API - Endpoints

### Publicos (sem autenticacao)

```
POST   /api/auth/login                        # Login admin (email + password -> JWT)
POST   /api/admin/login                        # Login alternativo
GET    /api/hotspot-login/:mikrotikId          # Pagina login MikroTik (HTML com variaveis $(mac), $(ip))
GET    /hotspot/redirect/:mikrotikId           # Redirect captive portal
POST   /api/pagamentos/gerar                   # Gerar pagamento Mercado Pago (QR PIX)
POST   /api/pagamentos/notificacao             # Webhook Mercado Pago
GET    /api/pagamentos/status                  # Consultar status pagamento
POST   /api/lgpd/login                         # Login com consentimento LGPD
POST   /api/lgpd/cadastro                      # Cadastro LGPD
POST   /api/auth/temp-access                   # Acesso temporario
GET    /api/planos-publicos                    # Listar planos (publico)
POST   /api/registro                           # Registro nova empresa
```

### Protegidos (requerem JWT)

```
# Planos
GET/POST/PUT/DELETE   /api/planos              # CRUD planos de internet

# MikroTik
GET/POST/PUT/DELETE   /api/mikrotiks           # CRUD roteadores MikroTik

# Portais
GET/POST/PUT/DELETE   /api/portais             # CRUD portais captive
GET/POST              /api/portal-templates     # Templates de portal

# RADIUS
POST                  /api/radius/criar-usuario       # Criar usuario RADIUS
POST                  /api/radius/vincular-plano      # Vincular plano ao usuario
GET                   /api/radius/sessoes             # Sessoes ativas
GET                   /api/radius/usuarios            # Listar usuarios RADIUS
DELETE                /api/radius/usuarios/:username   # Remover usuario

# Pagamentos
GET                   /api/pagamentos                 # Listar pagamentos

# Leads
GET/POST/PUT/DELETE   /api/leads               # CRUD leads
GET                   /api/leads/export         # Exportar CSV

# Dashboard
GET                   /api/dashboard            # Estatisticas admin

# Configuracoes
GET/POST              /api/efi                  # Config EFI PIX
GET/POST              /api/config-mercadopago   # Config Mercado Pago (legada)
GET/POST              /api/empresa-configs      # Config unificada por empresa

# WireGuard VPN
GET                   /api/wireguard/status     # Status VPN
POST                  /api/wireguard/clients    # Criar peer
DELETE                /api/wireguard/clients/:id # Remover peer
GET                   /api/wireguard/clients/:id/config # Download config

# WhatsApp
POST                  /api/whatsapp             # Integracao WhatsApp

# Compliance
GET                   /api/compliance           # Logs Marco Civil
GET                   /api/compliance/export    # Exportar CSV

# Admin Users
GET/POST/PUT/DELETE   /api/admins              # Gerenciar admins

# Limpeza
GET/POST              /api/limpeza             # Jobs de limpeza de dados

# Super Admin
GET/POST/PUT/DELETE   /api/empresas            # CRUD empresas (super_admin only)
```

---

## Frontend - Paginas e Rotas

### Publicas
| Rota | Componente | Descricao |
|------|-----------|-----------|
| `/` | Login | Login admin |
| `/planos-cliente` | PlanosCliente | Selecao de planos (Mercado Pago) |
| `/pagamento/:id` | Pagamento | Pagamento Mercado Pago |
| `/lgpd` | LgpdAuto | Consentimento LGPD automatico |
| `/cadastro` | CadastroLGPD | Formulario cadastro LGPD |
| `/planos-cliente-pix` | PlanosClientePix | Selecao planos (EFI PIX) |
| `/pagamentopix/:id` | PagamentoPix | Pagamento EFI PIX |
| `/registro` | Registro | Registro nova empresa |

### Admin (protegidas, prefixo `/admin/:empresaSlug`)
| Rota | Componente | Descricao |
|------|-----------|-----------|
| `/admin/:slug` | Dashboard | Painel com estatisticas |
| `/admin/:slug/mikrotiks` | Mikrotiks | Gerenciar roteadores |
| `/admin/:slug/vpn` | Wireguard | Gerenciar peers VPN |
| `/admin/:slug/portais` | Portais | Gerenciar portais captive |
| `/admin/:slug/portais/:id/editor` | PortalEditor | Editor visual de portal |
| `/admin/:slug/planos` | Planos | Gerenciar planos |
| `/admin/:slug/configuracoes` | Configuracoes | Config pagamento |
| `/admin/:slug/pagamentos` | Pagamentos | Ver transacoes |
| `/admin/:slug/radius` | UsuariosRadius | Usuarios RADIUS |
| `/admin/:slug/sessoes` | Sessoes | Sessoes ativas |
| `/admin/:slug/sessoeslog` | SessoesLog | Log de sessoes |
| `/admin/:slug/lgpd` | LgpdCadastros | Cadastros LGPD |
| `/admin/:slug/leads` | Leads | Gerenciar leads |
| `/admin/:slug/compliance` | Compliance | Logs Marco Civil |
| `/admin/:slug/usuarios` | Usuarios | Gerenciar admins |

### Super Admin
| Rota | Componente | Descricao |
|------|-----------|-----------|
| `/super` | SuperDashboard | Visao geral do sistema |
| `/super/empresas` | Empresas | Gerenciar empresas |

### Protecao de Rotas
O componente `RotaPrivada` verifica autenticacao via `AuthContext`. Se nao autenticado, redireciona para `/`. O componente `AdminRedirect` redireciona `/admin` para `/admin/:empresa_slug`.

---

## Fluxos de Negocio

### Fluxo do Hotspot (usuario conectando ao WiFi)
```
1. Usuario conecta ao WiFi MikroTik
2. MikroTik redireciona para /api/hotspot-login/:mikrotikId
3. Backend serve HTML com variaveis $(mac), $(ip), $(username) substituidas
4. HTML redireciona para /hotspot/redirect/:mikrotikId
5. Portal exibido conforme configuracao (LGPD / Planos / Leads / Custom)
6. Usuario interage (consentimento LGPD, seleciona plano, preenche lead)
7. Se plano pago: pagamento processado via Mercado Pago ou EFI PIX
8. Conta RADIUS criada/ativada
9. Usuario autenticado via RADIUS no MikroTik
10. Sessao logada em radacct, sync para connection_logs
```

### Fluxo de Pagamento (Mercado Pago)
```
1. POST /api/pagamentos/gerar (plano_id, mac, cpf, ip)
2. API Mercado Pago chamada, QR Code PIX gerado
3. Pagamento salvo com status "aguardando"
4. Retorna QR Code + copia-e-cola para o frontend
5. Webhook recebido: POST /api/pagamentos/notificacao
6. Status atualizado para "aprovado"
7. Usuario autorizado no RADIUS automaticamente
```

### Fluxo de Pagamento (EFI PIX)
```
1. Similar ao Mercado Pago, mas usa certificado .pem
2. Certificados armazenados em /backend/certificados/
3. Config em empresa_configs (tipo 'efi')
```

### Multi-Tenant Isolation
```
- Toda query filtra por empresa_id
- empresa_id extraido do JWT pelo middleware tenant.js
- Super admin pode usar header x-empresa-id para trocar contexto
- Configuracoes de pagamento isoladas por empresa (empresa_configs)
- Leads, usuarios, logs isolados por empresa
```

---

## Sistema RADIUS (Detalhado)

### Arquitetura RADIUS

O sistema usa FreeRADIUS com backend MySQL. As tabelas RADIUS padrao (radcheck, radreply, radusergroup, radacct, radpostauth) coexistem com a tabela customizada `radius_users` que faz a ponte multi-tenant.

```
FreeRADIUS Server
  ├── Authentication: radcheck (credentials + limits)
  ├── Authorization: radreply (speed, timeout)
  ├── Accounting: radacct (session data)
  └── Post-Auth: radpostauth (auth logs)

Tabela Custom:
  └── radius_users (empresa_id isolation, plano_id link)
```

### Controllers RADIUS

**radiusController.js** - `/var/www/hotspot/backend/src/controllers/radiusController.js`

| Funcao | Descricao |
|--------|-----------|
| `criarUsuarioRadius` | Cria usuario RADIUS com isolamento por empresa |
| `vincularPlano` | Vincula plano ao usuario (configura velocidade, timeout, sessoes) |
| `listarUsuarios` | Lista usuarios RADIUS da empresa (join com planos e mikrotiks) |
| `deletarUsuarioRadius` | Remove usuario de TODAS as tabelas RADIUS |
| `listarSessoesAtivas` | Lista sessoes ativas (radacct WHERE acctstoptime IS NULL) |

**radiusLogsController.js** - `/var/www/hotspot/backend/src/controllers/radiusLogsController.js`

| Funcao | Descricao |
|--------|-----------|
| `listarLogs` | Logs de accounting com paginacao e filtros (username, mac, ip, datas) |
| `exportarCSV` | Exporta logs para CSV (compliance Marco Civil) |

### Endpoints RADIUS

```
# Gerenciamento de Usuarios
POST   /api/radius/criar-usuario        # Criar usuario (username + password)
POST   /api/radius/vincular-plano       # Vincular plano ao usuario
GET    /api/radius/usuarios             # Listar usuarios da empresa
DELETE /api/radius/usuarios/:username   # Deletar usuario (limpa todas tabelas)
GET    /api/radius/sessoes              # Sessoes ativas (radacct)

# Logs e Compliance
GET    /api/radius-logs                 # Logs com filtros e paginacao
GET    /api/radius-logs/export          # Exportar CSV
```

### Modelo de Tempo: CUMULATIVO (nao diario)

**CRITICO — Refatorado em 2026-04-24.** O sistema usa **tempo acumulado total** (nao reset diario). Cliente compra 1h de plano → pode usar em multiplas sessoes/dias ate esgotar os 60 minutos totais. Apos esgotar, **bloqueado pelo FreeRADIUS** e precisa refazer cadastro/pagamento no portal configurado no MikroTik.

- FreeRADIUS usa `sqlcounter totalcounter` com `reset = never` (em `/etc/freeradius/3.0/mods-enabled/sqlcounter`).
- `sites-enabled/default` chama `totalcounter` (nao mais `dailycounter`; o bloco daily ainda existe no arquivo como referencia legacy mas nao e invocado).
- Query do counter soma `SUM(acctsessiontime + tempo_vivo_se_ativa)` de TODO o historico do username em `radacct`, sem filtro de data.
- A cada nova liberacao (pagamento, LGPD, lead, admin manual) o codigo grava `radius_users.liberado_em = NOW()` (INSERT ... ON DUPLICATE KEY UPDATE liberado_em = NOW()); o contador do sqlcounter deve somar apenas `radacct` com `acctstarttime >= liberado_em` (ver comentarios em `mikrotikAPIController.js` ~L166 e `lgpdController.js` ~L110). O radacct NAO e' mais apagado: historico preservado na fonte (Marco Civil), alem do sync para `connection_logs`. **Atencao:** a query do sqlcounter vive fora do repo (`/etc/freeradius/3.0/mods-enabled/sqlcounter`); conferir no servidor que ela filtra por `liberado_em` (o texto acima sobre 'sem filtro de data' reflete a versao de 2026-04-24).
- `Simultaneous-Use` fixo em `1` (antes lia `shared_users` do plano) — cliente nao pode compartilhar credencial em multiplos dispositivos.

### Atributos RADIUS Utilizados

**radcheck (Autenticacao/Limites):**
| Atributo | Op | Descricao | Exemplo |
|----------|----|-----------|---------|
| `Cleartext-Password` | `:=` | Senha do usuario | "minhasenha" |
| `Max-All-Session` | `:=` | Tempo TOTAL acumulado em segundos (reset=never) | "3600" (60min do plano inteiro) |
| `Simultaneous-Use` | `:=` | Conexoes simultaneas (fixo = 1) | "1" |

> Atributo custom: `ATTRIBUTE Max-All-Session 3002 integer` em `/etc/freeradius/3.0/dictionary`. `Max-Daily-Session` (3001) existe no dicionario mas nao e mais usado — nenhum controller grava mais esse atributo.

**radreply (Resposta/Autorizacao):**
| Atributo | Op | Descricao | Exemplo |
|----------|----|-----------|---------|
| `Mikrotik-Rate-Limit` | `:=` | Limite de velocidade | "1M/2M" (1M up / 2M down) |
| `Session-Timeout` | `:=` | Timeout da sessao em segundos (tempo restante; o sqlcounter ajusta automaticamente) | "3600" no inicio, decrementa |

### Formato de Velocidade (Rate-Limit)

**Formato:** `{velocidade_up}M/{velocidade_down}M`

| Exemplo | Upload | Download |
|---------|--------|----------|
| `1M/2M` | 1 Mbps | 2 Mbps |
| `5M/10M` | 5 Mbps | 10 Mbps |
| `10M/50M` | 10 Mbps | 50 Mbps |
| `2M/2M` | 2 Mbps (fixo PIX temporario) | 2 Mbps |

**Fonte:** Campos `velocidade_up` e `velocidade_down` da tabela `planos`.

### 4 Formas de Criar Usuario RADIUS

#### 1. Via Admin (radiusController.criarUsuarioRadius)
```
POST /api/radius/criar-usuario { username, password }
-> INSERT radcheck (Cleartext-Password)
-> INSERT radius_users (empresa_id, username)
Depois: POST /api/radius/vincular-plano { username, plano_id }
-> INSERT radcheck (Max-All-Session, Simultaneous-Use=1)
-> INSERT radreply (Mikrotik-Rate-Limit, Session-Timeout)
-> INSERT radusergroup (username, groupname=plano.id)
-> UPDATE radius_users (plano_id, nas_id)
```

#### 2. Via Pagamento Aprovado (mikrotikAPIController.liberarUsuario)
```
Webhook pagamento aprovado -> liberarUsuario()
-> Recebe o CPF do cliente (leads, via cliente_id/cpf) no contexto da liberacao
-> Username = CPF ou MAC (se CPF nao existe)
-> Password = username
-> INSERT radcheck (Cleartext-Password, Max-All-Session, Simultaneous-Use=1)
-> INSERT radreply (Mikrotik-Rate-Limit, Session-Timeout)
-> INSERT radusergroup (plano.id)
-> INSERT radius_users (empresa_id)
-> Envia credenciais via WhatsApp (opcional)
```

#### 3. Via Acesso Temporario PIX (authTempController.gerarAcessoTemporario)
```
POST /api/auth/temp-access
-> Username = pix_e{empresaId}_{timestamp}_{random}
-> Password = username
-> Rate: 2M/2M (fixo)
-> Duracao: 300 segundos (5 min)
-> Simultaneous-Use: 1
-> Limpa usuarios pix_ expirados nao ativos
```

#### 4. Via Login LGPD (lgpdController.lgpdLogin)
```
POST /api/lgpd/login
-> Usa o CPF informado no formulario (grava o consentimento em `leads`, origem='lgpd')
-> Username = CPF ou MAC
-> Busca plano LGPD especifico da empresa
-> Marca `radius_users.liberado_em = NOW()` para renovar a franquia (nao apaga radacct)
-> Cria lead LGPD automaticamente
```

### Delecao de Usuario RADIUS

Ao deletar um usuario, remove de TODAS as tabelas:
```sql
DELETE FROM radcheck WHERE username = ?
DELETE FROM radreply WHERE username = ?
DELETE FROM radusergroup WHERE username = ?
DELETE FROM radpostauth WHERE username = ?
DELETE FROM radius_users WHERE username = ? AND empresa_id = ?
```

### Sessoes Ativas

**Query:**
```sql
SELECT ra.username, ll.cpf, ra.callingstationid AS mac, ra.framedipaddress AS ip,
       ra.nasipaddress AS gateway, ra.acctstarttime, ra.acctsessiontime AS segundos,
       ra.acctinputoctets AS bytes_entrada, ra.acctoutputoctets AS bytes_saida
FROM radacct ra
LEFT JOIN mikrotiks m     ON m.ip = ra.nasipaddress          -- MikroTik: NAS-IP = mikrotiks.ip
LEFT JOIN radius_users ru ON ru.username = ra.username       -- Omada/UniFi: NAS-IP e' o IP LAN do controller
LEFT JOIN (SELECT mac, empresa_id, MAX(cpf) AS cpf FROM leads GROUP BY mac, empresa_id) ll
       ON ll.mac = ra.callingstationid AND ll.empresa_id = COALESCE(m.empresa_id, ru.empresa_id)
WHERE ra.acctstoptime IS NULL
  AND COALESCE(m.empresa_id, ru.empresa_id) = ?
ORDER BY ra.acctstarttime DESC
```
A resposta tambem traz `restante_segundos` (Max-All-Session do radcheck menos o usado desde `liberado_em`, mesma conta do sqlcounter; NULL = sem limite); a tela `Sessoes.jsx` mostra "Tempo restante" com contagem regressiva e recarrega a cada 30 s. Nao testado contra MySQL real. (Fonte: `radiusController.listarSessoesAtivas`; os JOINs usam `COLLATE utf8mb4_unicode_ci`. CPF vem de `leads`, nao de `lgpd_logins`.)

### Logs de Accounting (radacct)

**Campos principais consultados:**
| Campo | Descricao |
|-------|-----------|
| `radacctid` | ID unico (AUTO_INCREMENT) |
| `username` | Nome do usuario |
| `callingstationid` | MAC address do cliente |
| `framedipaddress` | IP atribuido ao cliente |
| `nasipaddress` | IP do NAS/gateway |
| `acctstarttime` | Inicio da sessao |
| `acctstoptime` | Fim da sessao (NULL = ativa) |
| `acctsessiontime` | Duracao em segundos |
| `acctinputoctets` | Bytes recebidos |
| `acctoutputoctets` | Bytes enviados |
| `acctterminatecause` | Motivo da desconexao |

### Tabela NAS

```sql
nas (id, nasname, shortname, type, ports, secret, server, community, description, empresa_id)
```
- `nasname` = IP do NAS (corresponde a `radacct.nasipaddress`)
- Usado para exibir nome amigavel nos logs
- Fallback: usa `mikrotiks.nome` se NAS nao encontrado

### CoA (Change of Authorization) e Disconnect

**Configuracao no MikroTik (via hotspotSetup.js):**
```
/radius/incoming/set accept=yes port=3799
```
- Porta 3799 padrao para CoA
- Permite RADIUS enviar pacotes de desconexao ao MikroTik

**Remocao manual de usuario (removerUsuarioPorMac):**
```
1. /ip/hotspot/user/remove    - Remove cadastro do usuario
2. /ip/hotspot/active/remove  - Desconecta sessao ativa
3. /ip/hotspot/host/remove    - Remove do cache de hosts
4. Se limparRadius=true: limpa radcheck, radreply, radusergroup, radius_users
```

### Job: syncConnectionLogs

**Arquivo:** `/var/www/hotspot/backend/src/jobs/syncConnectionLogs.js`

**Processo:**
1. Busca `last_synced_radacctid` da tabela `connection_logs_sync`
2. Query radacct WHERE `radacctid > lastId` AND `acctstoptime IS NOT NULL`
3. Join com `mikrotiks` (NAS-IP), `radius_users` (empresa_id) e `leads` (CPF por MAC)
4. INSERT em `connection_logs` com dados de compliance
5. Atualiza `connection_logs_sync` com max radacctid processado
6. Processa em lotes de 5000 registros

### Job: verificaExpiracoes

**Arquivo:** `/var/www/hotspot/backend/jobs/verificaExpiracoes.js`

**Processo:**
1. Busca pagamentos onde `expira_em <= NOW()` AND `status = 'approved'`
2. Para cada expirado: `removerUsuarioPorMac(mac, true)` (remove do MikroTik + RADIUS)
3. Atualiza status para 'expirado'
4. Limpa usuarios temporarios `pix_*` que nao estao em sessao ativa

### Relacionamento Completo das Tabelas RADIUS

```
empresas (1) ──── (N) radius_users ──── (1) planos
                        │                      │
                        │ username              │ mikrotik_id
                        │                      │
                        ├── radcheck (N)       mikrotiks
                        │   ├── Cleartext-Password
                        │   ├── Max-All-Session
                        │   └── Simultaneous-Use
                        │
                        ├── radreply (N)
                        │   ├── Mikrotik-Rate-Limit
                        │   └── Session-Timeout
                        │
                        ├── radusergroup (N)
                        │   └── groupname = plano.id
                        │
                        ├── radacct (N)
                        │   └── Sessoes de accounting
                        │
                        └── radpostauth (N)
                            └── Logs de autenticacao

leads ──(MAC)── radacct.callingstationid
                         │
                         └── connection_logs (Marco Civil compliance)

pagamentos ──(MAC)── radacct/radius cleanup (verificaExpiracoes)
```

### Acesso Temporario vs Permanente

| Tipo | Username | Senha | Velocidade | Duracao | Limpeza |
|------|----------|-------|------------|---------|---------|
| **Temporario (PIX)** | `pix_e{id}_{ts}_{rand}` | = username | 2M/2M fixo | 300s (5min) | Auto (verificaExpiracoes) |
| **Permanente (Plano)** | CPF ou MAC | = username | Conforme plano | duracao_minutos | Expiracao pagamento |
| **LGPD** | CPF ou MAC | = username | Conforme plano LGPD | duracao_minutos | Cumulativa (renovada via `radius_users.liberado_em` a cada nova liberacao) |
| **Admin Manual** | Customizado | Customizada | Conforme plano vinculado | duracao_minutos | Manual |

---

## Configuracao FreeRADIUS (Servidor)

### Versao e Diretorio
- **Versao:** FreeRADIUS 3.0
- **Diretorio base:** `/etc/freeradius/3.0/`
- **Servico:** `freeradius` (ou `systemctl restart freeradius`)

### Estrutura de Arquivos FreeRADIUS

```
/etc/freeradius/3.0/
├── radiusd.conf              # Config principal do daemon
├── clients.conf              # Clientes RADIUS (localhost, NAS dinamicos via SQL)
├── dictionary                # Dicionario local (atributos customizados)
├── proxy.conf                # Config de proxy RADIUS
├── templates.conf
├── trigger.conf
├── sites-enabled/
│   ├── default -> ../sites-available/default    # Virtual server principal
│   ├── inner-tunnel -> ../sites-available/inner-tunnel
│   └── coa -> ../sites-available/coa            # CoA/Disconnect server
├── sites-available/
│   ├── default               # CUSTOMIZADO - Auth + Acct + Session + Post-Auth
│   ├── coa                   # CoA listener na porta 3799
│   ├── inner-tunnel           # Tunel interno (EAP)
│   └── ... (outros templates)
├── mods-enabled/
│   ├── sql -> ../mods-available/sql             # Modulo SQL (MySQL)
│   ├── sqlcounter             # CUSTOMIZADO - Contador cumulativo (totalcounter, reset=never)
│   ├── pap, chap, mschap     # Metodos de autenticacao
│   ├── expiration             # Verificacao de expiracao
│   ├── logintime              # Controle de horario
│   └── ... (outros modulos)
├── mods-available/
│   ├── sql                   # CUSTOMIZADO - Conexao MySQL
│   └── ... (todos modulos disponiveis)
└── mods-config/
    └── sql/main/mysql/
        ├── queries.conf       # Queries SQL para auth, acct, session
        ├── schema.sql         # Schema padrao RADIUS
        └── setup.sql          # Script de setup
```

### Virtual Server Default (sites-available/default)

**Arquivo:** `/etc/freeradius/3.0/sites-available/default`

**CUSTOMIZADO** para o sistema hotspot:

```
server default {
    listen { type = auth, ipaddr = *, port = 1812 }
    listen { type = acct, ipaddr = *, port = 1813 }

    authorize {
        preprocess
        chap
        mschap
        suffix
        sql                    # Busca credenciais no MySQL (radcheck/radreply)
        totalcounter           # Soma tempo total usado (Max-All-Session, reset=never)
        expiration             # Verifica expiracao
        logintime              # Verifica horario de login
        pap                    # Autenticacao PAP
    }

    authenticate {
        Auth-Type CHAP  { chap }
        Auth-Type MS-CHAP { mschap }
        Auth-Type PAP   { pap }
    }

    preacct {
        preprocess
        acct_unique
        suffix
        files
    }

    accounting {
        sql                    # Grava em radacct (start/interim/stop)
        exec
        attr_filter.accounting_response
    }

    session {
        sql                    # Verifica Simultaneous-Use via radacct
    }

    post-auth {
        sql                    # Grava em radpostauth
        exec
        remove_reply_message_if_eap
        Post-Auth-Type REJECT {
            attr_filter.access_reject
            sql
            update reply { Reply-Message := "Acesso negado" }
        }
    }
}
```

**Pipeline de autenticacao:**
```
Request -> preprocess -> chap -> mschap -> suffix -> sql (busca radcheck)
-> totalcounter (calcula tempo restante) -> expiration -> logintime -> pap
-> authenticate (PAP/CHAP/MS-CHAP) -> post-auth (log em radpostauth)
-> Access-Accept com radreply (Mikrotik-Rate-Limit, Session-Timeout)
```

### CoA Server (sites-available/coa)

**Arquivo:** `/etc/freeradius/3.0/sites-available/coa`

```
listen { type = coa, ipaddr = *, port = 3799, virtual_server = coa }
server coa {
    recv-coa { suffix; ok }
    send-coa { ok }
}
```

- Escuta na **porta 3799** para receber CoA e Disconnect-Request
- Habilitado via symlink em sites-enabled
- Permite desconectar usuarios remotamente

### Modulo SQL (mods-available/sql)

**Arquivo:** `/etc/freeradius/3.0/mods-available/sql`

```
sql {
    driver = "rlm_sql_mysql"
    dialect = "mysql"
    server = "localhost"
    port = 3306
    login = "hotspotuser"
    password = "senhaforte123"
    radius_db = "hotspot"

    read_clients = yes              # Le NAS da tabela 'nas' (clientes dinamicos)
    client_table = "nas"

    acct_table1 = "radacct"
    acct_table2 = "radacct"
    postauth_table = "radpostauth"
    authcheck_table = "radcheck"
    groupcheck_table = "radgroupcheck"
    authreply_table = "radreply"
    groupreply_table = "radgroupreply"
    usergroup_table = "radusergroup"

    delete_stale_sessions = yes     # Limpa sessoes orfas automaticamente

    pool {
        start = ${thread[pool].start_servers}
        min = ${thread[pool].min_spare_servers}
        max = ${thread[pool].max_servers}
        spare = ${thread[pool].max_spare_servers}
        uses = 0
        retry_delay = 30
        lifetime = 0
        idle_timeout = 60
        max_retries = 5
    }
}
```

**Pontos importantes:**
- `read_clients = yes` - NAS sao lidos da tabela `nas` no MySQL (clientes RADIUS dinamicos)
- `delete_stale_sessions = yes` - Remove sessoes orfas do radacct
- Mesmo usuario/senha do backend Node.js

### SQL Counter - Dailycounter (LEGADO, nao invocado; vigente: totalcounter, ver "Modelo de Tempo: CUMULATIVO")

**Arquivo:** `/etc/freeradius/3.0/mods-enabled/sqlcounter`

```
sqlcounter dailycounter {
    sql_module_instance = sql
    dialect = mysql
    counter_name = Daily-Session-Time
    check_name = Max-Daily-Session
    reply_name = Session-Timeout
    key = User-Name
    reset = daily
    cacheable = no
    query = "SELECT IFNULL(SUM(IF(acctstoptime IS NULL,
        UNIX_TIMESTAMP() - UNIX_TIMESTAMP(acctstarttime),
        acctsessiontime)), 0)
        FROM radacct
        WHERE username='%{tolower:%{%{Stripped-User-Name}:-%{User-Name}}}'
        AND DATE(acctstarttime) = CURDATE()"
}
```

**Como funciona:**
1. Soma todo o tempo usado HOJE pelo usuario (sessoes ativas + finalizadas)
2. Compara com `Max-Daily-Session` (definido em radcheck)
3. Se excedeu: **rejeita autenticacao**
4. Se nao excedeu: define `Session-Timeout` = tempo restante
5. Reset diario (meia-noite) - usuario volta a ter quota completa

**Exemplo:** Se `Max-Daily-Session = 3600` (1h) e usuario ja usou 2400s hoje:
- `Session-Timeout` sera ajustado para 1200s (20min restantes)
- Proximo login apos esgotar: **rejeitado** ate meia-noite

### Dicionario Local (dictionary)

**Arquivo:** `/etc/freeradius/3.0/dictionary`

```
ATTRIBUTE   Max-Daily-Session     3001    integer   # legado, nao usado
ATTRIBUTE   Max-All-Session       3002    integer   # vigente
```

- Atributo customizado `Max-Daily-Session` (ID 3001, tipo integer)
- Usado pelo `dailycounter` para controle de tempo diario
- Armazenado em `radcheck` para cada usuario

### Clients.conf

**Arquivo:** `/etc/freeradius/3.0/clients.conf`

```
client localhost {
    ipaddr = 127.0.0.1
    proto = *
    secret = testing123
    nas_type = other
}
client localhost_ipv6 {
    ipv6addr = ::1
    secret = testing123
}
```

**Nota:** Alem dos clientes estaticos (localhost), o FreeRADIUS le clientes dinamicamente da tabela `nas` no MySQL via `read_clients = yes`. Os MikroTiks sao cadastrados la pelo backend.

### Queries SQL do FreeRADIUS (queries.conf)

**Arquivo:** `/etc/freeradius/3.0/mods-config/sql/main/mysql/queries.conf`

**Autorizacao:**
- `authorize_check_query` - SELECT de radcheck por username
- `authorize_reply_query` - SELECT de radreply por username
- `group_membership_query` - SELECT de radusergroup por username
- `authorize_group_check_query` - SELECT de radgroupcheck por groupname
- `authorize_group_reply_query` - SELECT de radgroupreply por groupname

**Simultaneous-Use:**
- `simul_count_query` - COUNT de sessoes ativas em radacct (WHERE acctstoptime IS NULL)
- `simul_verify_query` - Detalhes das sessoes para verificacao

**Accounting:**
- `start` - INSERT em radacct no inicio da sessao
- `interim-update` - UPDATE radacct com dados parciais (bytes, tempo)
- `stop` - UPDATE radacct com acctstoptime e dados finais
- `accounting-on/off` - Bulk update quando NAS reinicia

**Post-Auth:**
- INSERT em radpostauth (username, password, reply, timestamp)

### Fluxo Completo RADIUS (MikroTik -> FreeRADIUS -> MySQL)

```
1. Cliente conecta ao WiFi MikroTik
2. MikroTik envia Access-Request (porta 1812) com:
   - User-Name, User-Password, Calling-Station-Id (MAC), NAS-IP-Address
3. FreeRADIUS processa em authorize:
   a. sql: SELECT radcheck WHERE username (Cleartext-Password, Max-All-Session, Simultaneous-Use)
   b. totalcounter: Calcula tempo total usado, ajusta Session-Timeout
   c. pap: Compara senha
4. Se autenticado -> Access-Accept com:
   - radreply: Mikrotik-Rate-Limit, Session-Timeout
   - Gravado em radpostauth
5. MikroTik aplica rate limit e inicia sessao
6. MikroTik envia Accounting-Start (porta 1813)
   -> INSERT em radacct
7. MikroTik envia Interim-Update periodicamente
   -> UPDATE radacct (bytes, tempo)
8. Sessao encerra (timeout, logout, admin disconnect)
   -> MikroTik envia Accounting-Stop
   -> UPDATE radacct (acctstoptime, acctterminatecause)
9. syncConnectionLogs: copia radacct -> connection_logs (compliance)
```

### Comandos Uteis FreeRADIUS

```bash
# Testar configuracao
freeradius -XC

# Rodar em modo debug (foreground)
freeradius -X

# Reiniciar servico
systemctl restart freeradius

# Ver status
systemctl status freeradius

# Testar autenticacao local
radtest usuario senha 127.0.0.1 0 testing123

# Ver logs
tail -f /var/log/freeradius/radius.log
```

---

## Integracao MikroTik

### Conexao
- Biblioteca: `node-routeros` (RouterOS API protocol)
- Porta padrao: 8728 (API sem SSL)
- Credenciais armazenadas na tabela `mikrotiks`
- Conexao via IP VPN (WireGuard) quando MikroTik atras de NAT

### Funcionalidades
- Teste de conexao ao salvar MikroTik
- Configuracao automatica do Walled Garden (liberar dominio do servidor)
- Servir pagina de login personalizada (HTML com variaveis MikroTik)
- Gerenciamento de perfis hotspot
- Monitoramento de status e usuarios ativos

### Variaveis MikroTik no HTML
- `$(mac)` - MAC address do cliente
- `$(ip)` - IP do cliente
- `$(username)` - Username
- `$(mikrotik_id)` - ID do MikroTik no sistema

### Campo `mikrotiks.end_hotspot` (IMPORTANTE)

`end_hotspot` e o destino do redirect HTTP que o frontend faz apos pagamento aprovado (`POST {end_hotspot}/login` com user/senha pra autenticar o cliente no captive portal).

**REGRA:** ao auto-configurar o hotspot via wizard (`POST /api/mikrotiks/:id/enviar-hotspot`), o `end_hotspot` deve receber o **DNS Name** configurado no Hotspot Server Profile (`config.dnsName`), nao o IP cru. Salvar o IP cru funciona em HTTP mas quebra em HTTPS porque o navegador rejeita certificado de IP. Salvando o DNS Name (que bate com o certificado SSL configurado no MikroTik) o redirect HTTPS funciona.

Fallback: se `dnsName` estiver vazio, salva o IP do `localAddress` (compat).

Ver `backend/src/routes/mikrotikRoutes.js:267-285`.

---

## WireGuard VPN

### Proposito
Permitir conexao do servidor aos MikroTiks que estao atras de NAT (IP privado). O MikroTik conecta como client VPN e recebe um IP tunelado (ex: 10.8.0.x).

### Infraestrutura
- Container Docker: `ghcr.io/wg-easy/wg-easy`
- Porta VPN: 51820/UDP
- Porta Web Management: 51821
- Config: `/var/www/hotspot/infra/wireguard/docker-compose.yml`

### Endpoints API
```
GET    /api/wireguard/status              # Status do WireGuard
POST   /api/wireguard/clients             # Criar novo peer
DELETE /api/wireguard/clients/:id          # Remover peer
GET    /api/wireguard/clients/:id/config   # Download config do peer
```

---

## Conformidade Legal

### LGPD (Lei 13.709/2018)
- Consentimento registrado na tabela `leads` (`lgpd_logins` nao existe mais; so `lgpd_logins_backup`)
- Campos: cpf, nome, telefone, lgpd_aceite, lgpd_aceite_em, lgpd_termo (snapshot do termo), mac, ip
- Formulario de cadastro com termos de uso
- Leads criados automaticamente a partir de cadastros LGPD

### Marco Civil da Internet (Lei 12.965/2014)
- Logs de conexao mantidos na tabela `connection_logs`
- Sync automatico de `radacct` via job `syncConnectionLogs.js`
- Dados: usuario, MAC, IP, inicio/fim sessao, bytes transferidos, motivo desconexao
- Exportacao CSV via `/api/compliance/export`

---

## Jobs / Tarefas de Background

| Job | Arquivo | Descricao |
|-----|---------|-----------|
| Sync Logs | `src/jobs/syncConnectionLogs.js` | Sincroniza radacct -> connection_logs (Marco Civil) |
| Expiracoes | `src/jobs/verificaExpiracoes.js` | Verifica planos expirados |

**Execucao:** Manual via `node src/jobs/<arquivo>.js` ou integracao com cron.

---

## Comandos Uteis

### Backend
```bash
cd /var/www/hotspot/backend
npm start                              # Inicia servidor (porta 3001)
node migrations/001_multi_tenant.js    # Rodar migracao
node src/jobs/syncConnectionLogs.js    # Sync logs compliance
```

### Frontend
```bash
cd /var/www/hotspot/frontend
npm run dev                            # Dev server (Vite)
npm run build                          # Build producao (-> dist/)
npm run preview                        # Preview build
```

### WireGuard
```bash
cd /var/www/hotspot/infra/wireguard
docker compose up -d                   # Subir container
docker compose down                    # Parar container
docker compose logs -f                 # Ver logs
```

### Banco de Dados
```bash
mysql -u hotspotuser -p hotspot        # Conectar ao banco
# Schema de referencia: /var/www/hotspot/backend/jobs/estrutura.sql
```

---

## Sistema de Templates de Portal

### Tipos de Template
| Tipo | Descricao |
|------|-----------|
| `basico` | Portal simples com botao de conexao |
| `planos` | Portal com exibicao de planos e precos |
| `lgpd` | Portal com consentimento LGPD |
| `completo` | LGPD + cadastro + selecao de planos (multi-step) |

### Personalizacao por Portal

> **Onde fica a config visual do portal:** coluna `portais.configuracoes` (JSON em texto), gravada por `PUT /api/portais/:id` (`portalController.atualizarPortal`) e lida pelo endpoint publico `GET /api/portal-config/:tipo?empresa_id=` (`getPortalConfig`, que tambem devolve `cor_primaria`, `cor_fundo`, `logo_url`, `custom_css`). **Nao existe coluna `portais.config_json`** (`config_json` e' so de `empresa_configs`). Os toggles PIX/Cartao/Trial/`link_portal_id` vivem dentro de `configuracoes`. As paginas publicas sao `LoginHotspot.jsx`, `LgpdAuto.jsx`, `CadastroLeadPassivo.jsx`, etc. (nao existe `RenderPortal.jsx` nem rota `/p/:hash`).
- `template_id` - Template base selecionado
- `html_content` - HTML customizado (sobrescreve template)
- `custom_css` - CSS adicional injetado
- `logo_url` - Logo da empresa
- `cor_primaria` - Cor principal (hex)
- `cor_fundo` - Cor de fundo (hex)
- `campos_cadastro` - JSON com campos do formulario
- `mostrar_planos` - Exibir planos (boolean)
- `mostrar_lgpd` - Exibir LGPD (boolean)
- `url_redirect` - URL externa para redirect

---

## Convencoes do Codigo

### Backend
- Controllers em `/backend/src/controllers/` - cada um exporta funcoes
- Rotas em `/backend/src/routes/` - Express Router
- SQL puro via `db.execute()` (pool mysql2) - nao usa ORM para a maioria das queries
- Nomes de tabelas e colunas em portugues (criado_em, atualizado_em, etc.)
- Respostas JSON: `{ success: true, data: ... }` ou `{ error: "mensagem" }`

### Frontend
- Componentes React funcionais com hooks
- Tailwind CSS para estilizacao
- Formularios controlados nativos (sem lib de forms)
- Axios para chamadas API
- AuthContext para estado de autenticacao global
- Rotas com parametro `:empresaSlug` para multi-tenant

### Banco de Dados
- Tabelas com `empresa_id` para isolamento multi-tenant
- Timestamps: `criado_em`, `atualizado_em` (formato MySQL TIMESTAMP)
- IDs auto-incremento INT
- Charset: utf8mb4

---

## Checkout de Cartao Mercado Pago (Server-Side)

> **Doc tecnico completo:** `docs/CHECKOUT-CARTAO-MP.md` - leia antes de mexer neste fluxo.

Pagamento por cartao de credito do portal de planos roda 100% server-side: backend tokeniza via `POST /v1/card_tokens` e cobra via `POST /v1/payments`. Sem SDK JS, sem Bricks, sem CardForm. PIX continua intacto e nao tem nada a ver com este fluxo.

### Arquivos-chave
- `backend/src/controllers/pagamentoController.js` - `gerarPagamentoCartao`, `lookupBin`, `proxyDeviceSession`, `validarAssinaturaWebhook`, `MP_ERROR_MESSAGES`
- `backend/src/routes/pagamentoRoutes.js` - rotas `/gerar-cartao`, `/mp-device-session/:tipo`, `/notificacao`
- `frontend/src/pages/public/Pagamento.jsx` - branch `metodo === "cartao"` com form completo
- `frontend/public/mp-security.js` - copia local do device fingerprint do MP, **patchada** pra usar o proxy backend

### Por que server-side?
1. **Walled garden do hotspot so libera 1 dominio confiavelmente** - SDK JS do MP carrega varios dominios e quebra no celular do cliente.
2. PCI compliance assumida no servidor (decisao consciente, sem persistir dados de cartao).

### Pipeline `gerarPagamentoCartao`
1. Validacao de input (cartao, cvv, validade, CPF, nome)
2. Buscar plano + `mpConfig` (`empresa_configs.config_json.mercadopago`)
3. Resolver `payer.email` (lead > config > placeholder)
4. **INSERT pagamento** com status `aguardando` ANTES de chamar MP -> pega `pagId` -> `external_reference=pag_${pagId}_emp_${empresaId}`
5. **BIN lookup** via `GET /v1/payment_methods/installments?bin=&amount=&public_key=` (NAO `/search` - aquele nao filtra de fato por BIN). Cache em memoria 24h.
6. **POST `/v1/card_tokens?public_key=...`** com `cardholder.identification.{type:CPF,number}` consistente com o que sera enviado depois
7. **POST `/v1/payments`** com payload reduzido (veja "Regras de payload" abaixo) + headers `Authorization`, `X-Idempotency-Key` (UUID v4 puro), `X-meli-session-id` (device session id)
8. Tratamento: `approved` -> libera RADIUS via `liberarUsuario()` + retorna `{gateway, username, password}`. `rejected` -> mensagem PT-BR mapeada. `in_process`/`pending` -> retorna pra polling no frontend.

### Device fingerprint (CRITICO - sem isso, todas as transacoes em producao caem em `cc_rejected_high_risk`)

Frontend carrega `/mp-security.js` (servido local de `frontend/public/`). O script faz POST pro endpoint `/api/pagamentos/mp-device-session/web_device` que e um **proxy backend** pra `https://api.mercadopago.com/v1/device_sessions/web_device`. Resposta popula `window.MP_DEVICE_SESSION_ID`.

No submit, frontend le essa global e envia como `device_session_id` no body. Backend repassa pro MP de duas formas redundantes:
- Header `X-meli-session-id: armor.xxx`
- Body `metadata.device_session_id: "armor.xxx"`

**O proxy `proxyDeviceSession` filtra `X-Forwarded-For` invalidos** (`::1`, IPs privados) - MP devolve 500 generico se receber XFF com IPv6 loopback ou IP de range privado.

**Refresh do `mp-security.js`** (se MP fizer release nova):
```bash
curl -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' \
     -H 'Referer: https://www.mercadopago.com.br/' \
     'https://www.mercadopago.com/v2/security.js?view=checkout' \
     -o /var/www/hotspot/frontend/public/mp-security.js
sed -i 's|https://api\.mercadopago\.com/v1/device_sessions|/api/pagamentos/mp-device-session|g' \
    /var/www/hotspot/frontend/public/mp-security.js
cd /var/www/hotspot/frontend && npm run build
```

### Regras de payload do `/v1/payments` (gravadas em sangue - NAO MEXER sem ler o doc)

| Regra | Por que |
|---|---|
| **NAO** enviar `additional_info.ip_address` | IP do hotspot e privado 10.x, antifraude marca como suspeito |
| **NAO** enviar `payer.first_name`, `payer.last_name`, `payer.identification` | MP usa o `cardholder` do token como fonte da verdade. Esses campos sao silenciosamente descartados. Divergencia gera high_risk |
| **NAO** enviar `additional_info.payer` | Mesmo motivo do anterior |
| **SIM** enviar `payment_method_id` e `issuer_id` do BIN lookup | Doc lista como obrigatorios. Sem eles MP "adivinha" e tem score pior |
| **SIM** enviar `additional_info.items[]` | Aumenta contexto pro antifraude |
| **SIM** enviar `metadata.device_session_id` + header `X-meli-session-id` | Maior fator unico de aprovacao |
| Email do pagador deve ser **real** | Placeholder/dominio fake (`@asd.com`, `@pagamento.com`) penaliza score |
| `X-Idempotency-Key` = UUID v4 **puro** | Sem prefixo, sem `_`. MP rejeita formatos `payment_xxx` |
| Mesmo CPF/nome em `cardholder` (token) e qualquer dado enviado | Consistencia evita antifraude |
| INSERT pagamento **antes** de chamar MP | Permite usar `pag_X_emp_Y` como external_reference, e webhook consegue casar mesmo se request travar |
| **SIM** enviar `notification_url` no body do `/v1/payments` (PIX **e** cartao) | Em multi-tenant com a mesma conta MP, painel global so aceita 1 URL. Sem este campo, so 1 servidor recebe webhook — outros ficam com PIX eternamente em `aguardando`. **Bug historico:** PIX foi criado sem `notification_url` e ficou anos quebrado em multi-tenant ate 2026-04-09. Cartao ja fazia certo desde sempre. |

### Configuracao por empresa

`empresa_configs.config_json` para `config_type='mercadopago'`:
```json
{
  "access_token": "APP_USR-...",
  "public_key":   "APP_USR-...",
  "email_pagador": "comprador@dominio-real.com",
  "webhook_secret": "abc123..."
}
```

`webhook_secret` e opcional - se cadastrado, ativa validacao HMAC-SHA256 do `x-signature` em `notificacaoWebhook`. Pegar no painel MP em "Webhooks > Configurar notificacoes > Segredo".

### Walled garden

`hotspotSetup.js` ja inclui (linha ~226) os dominios MP necessarios. Mas como a infra atual so libera o **primeiro dominio** confiavelmente, o `mp-security.js` foi servido localmente + proxy backend pra evitar dependencia de `api.mercadopago.com` no celular do cliente. Se um dia o walled garden suportar multiplos dominios, e seguro voltar a carregar o script direto de `https://www.mercadopago.com/v2/security.js`.

### Endpoints principais
```
POST /api/pagamentos/gerar-cartao              # publico, captive portal -> cobranca
POST /api/pagamentos/mp-device-session/:tipo   # publico, proxy device fingerprint (web_device | anonymous_device_session)
POST /api/pagamentos/notificacao               # publico, webhook MP (com validacao opcional)
GET  /api/pagamentos/status                    # publico, polling do frontend
```

### Diagnostico rapido

Quando der `cc_rejected_high_risk` em todas as transacoes:
```bash
# Inspecionar o pagamento direto na API do MP
TOKEN="APP_USR-..."
curl -sS "https://api.mercadopago.com/v1/payments/<mp_id>" \
     -H "Authorization: Bearer $TOKEN" \
     | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps({k:d.get(k) for k in ['status','status_detail','additional_info','metadata']}, indent=2))"
```

- Se `metadata.device_session_id` estiver vazio (`{}`) -> frontend nao enviou. Ver se `mp-security.js` carregou no celular (DevTools), se proxy `/api/pagamentos/mp-device-session/web_device` esta retornando 200 com `id`.
- Se `additional_info.tracking_id` mostrar `security:none` -> antifraude sem sinais. Mesmo problema.
- Se `payer.first_name`, `payer.identification` voltarem `null` -> normal, MP descarta esses campos quando voce usa `token`.

**PIX fica eternamente em `aguardando` mas cartao funciona**:
```sql
SELECT id, mp_pagamento_id, status, metodo_pagamento, criado_em
FROM pagamentos WHERE empresa_id = X ORDER BY id DESC LIMIT 20;
-- Sintoma: cartoes 'approved', PIX todos 'aguardando'
```
Causa: `gerarPagamento` (PIX) sem `notification_url` no body do `/v1/payments`. Multi-tenant com mesma conta MP -> webhook so chega no servidor da URL global do painel. Fix: ver linha do `notification_url` no `pagamentoController.js` (PIX usa o mesmo padrao do cartao desde 2026-04-09).

**Webhook MP retorna 401 misterioso (silencioso)**:
- Se `mp_id=123456` -> e o teste do botao "Simular notificacao" do painel, normal (id fake nao existe no banco). Pra testar, **Reenviar** uma notificacao real do historico.
- Se `mp_id` real e `empresa=X` -> validacao de assinatura `webhook_secret` falhou. Conferir se o secret no painel MP bate com `empresa_configs.config_json.mercadopago.webhook_secret`. Se nao for usar, removerlo: `UPDATE empresa_configs SET config_json = JSON_REMOVE(config_json, '$.webhook_secret')`.
- Logs explicitos no `notificacaoWebhook` (a partir de 2026-04-09): qualquer 401 agora loga o motivo no PM2 ao inves de retornar silencioso.

### Spec e plan
- Spec: `docs/superpowers/specs/2026-04-08-checkout-cartao-mp-rewrite-design.md`
- Plano: `docs/superpowers/plans/2026-04-08-checkout-cartao-mp-rewrite.md`

---

## Notificacao WhatsApp por Portal

> **Doc tecnico completo:** `docs/WHATSAPP-NOTIFICACOES.md`

Sistema de envio automatico de mensagens WhatsApp ao cliente quando o acesso e liberado (pagamento aprovado, LGPD, liberacao manual). Configuravel **por portal**, com template personalizavel via variaveis Mustache `{{var}}`.

### Arquitetura

```
Portal (config)              Service                        Log
───────────────              ───────                        ───
portais.whatsapp_enabled  ┐
portais.whatsapp_template ┼─> whatsappNotify              ─> whatsapp_logs
                           │   .notificarLiberacao()          (ok/erro/skipped)
mikrotikAPIController      │
.liberarUsuario()         ─┘
```

### Schema (migration 012)

| Tabela | Coluna | Proposito |
|---|---|---|
| `portais` | `whatsapp_enabled` TINYINT(1) | Liga/desliga por portal |
| `portais` | `whatsapp_template` TEXT | Template Mustache customizavel |
| `pagamentos` | `portal_id` INT | Rastreia origem do pagamento |
| `pagamentos` | `telefone` VARCHAR(20) | Backup do telefone no INSERT |
| `whatsapp_logs` | (nova tabela) | Log completo de envios |

### Arquivos-chave

- `backend/src/services/whatsappNotify.js` - service principal (template engine, lookup telefone, logger)
- `backend/src/constants/whatsappDefaults.js` - template padrao compartilhado
- `backend/src/controllers/mikrotikAPIController.js` - `liberarUsuario` chama o service
- `backend/src/controllers/portalController.js` - endpoints de preview/teste por portal
- `backend/src/controllers/whatsappController.js` - endpoints de logs (`listarLogs`, `limparLogs`)
- `frontend/src/pages/admin/PortalEditor.jsx` - aba "Notificacao WhatsApp" no editor
- `frontend/src/pages/admin/WhatsApp.jsx` - historico de envios (filtros + paginacao)

### Fluxo de envio

1. `liberarUsuario({cliente_id, portal_id, telefone, cpf, mac, ...})` e chamado apos liberar RADIUS
2. Dispara `notificarLiberacao(ctx)` de forma **assincrona** (nao bloqueia liberacao)
3. O service:
   - Busca `whatsapp_enabled` e `whatsapp_template` do portal (resolve `portal_id` via `mikrotiks.portal_id` se nao informado)
   - Se desligado ou sem template → grava `skipped` no log e retorna
   - Resolve telefone na ordem: `telefone` explicito → `cliente_id` (leads) → `cpf` (leads); sem busca por MAC
   - Normaliza telefone para 13 digitos (`55 + DDD 2 + numero 9`) por **comprimento**, NAO por prefixo `startsWith("55")` (DDD 55 do RS confundia)
   - Renderiza template com variaveis (`nome`, `username`, `password`, `plano`, `duracao`, `velocidade`, `login_url`, `valor`, `empresa`, `expira_em`, `cpf`)
   - Envia via `enviarMensagemDireta` (que aplica `formatarNumeroComNonoDigito` pro DDD ≤ 30 adicionar 9)
   - Grava resultado em `whatsapp_logs` (status `ok`/`erro`/`skipped`)

### Variaveis do template (Mustache)

| Variavel | Fonte | Fallback |
|---|---|---|
| `{{nome}}` | `leads.nome` | "Cliente" |
| `{{username}}` | CPF cliente ou MAC | sempre preenchido |
| `{{password}}` | mesmo do username | sempre preenchido |
| `{{plano}}` | `planos.nome` | vazio |
| `{{duracao}}` | `planos.duracao_minutos` | vazio |
| `{{velocidade}}` | `planos.velocidade_down`/`up` | vazio |
| `{{login_url}}` | URL auto-login MikroTik | vazio |
| `{{cpf}}` | CPF do cliente (nao do cartao!) | vazio |
| `{{valor}}` | `pagamentos.valor` | vazio |
| `{{empresa}}` | `empresas.nome` | vazio |
| `{{expira_em}}` | `pagamentos.expira_em` | vazio |

Variaveis nao-resolvidas viram string vazia (nunca aparece `{{foo}}` no resultado).

**Anti-vazamento (grilagem por WhatsApp):** o telefone sai de `telefone` explicito > `cliente_id` > `cpf`; **nao ha busca por MAC** (vem do cliente: apontaria a credencial para o telefone de um terceiro). Um cadastro so empresta o **nome** se o telefone da mensagem e' o dele (comparacao pelos 10 ultimos digitos) ou se a mensagem herda o telefone dele; senao `{{nome}}` vira "Cliente". Sem isso, digitar o CPF de outra pessoa com o proprio telefone e sem nome fazia o WhatsApp dizer "Ola <nome do titular>" (CPF -> nome). Teste: `backend/tests/unit/whatsappNotify.test.js`.

### Endpoints

```
POST   /api/portais/:id/whatsapp-preview   # renderiza template com vars fake
POST   /api/portais/:id/whatsapp-teste     # envia msg real pra numero informado
GET    /api/whatsapp/logs                  # listar (filtros: status, telefone, portal, datas) + paginacao
DELETE /api/whatsapp/logs?antes_de=...     # limpar logs antigos
```

### Gotchas gravados em sangue

1. **CPF do cliente ≠ CPF do titular do cartao.** Em `gerarPagamentoCartao`, `cardholderCpf` (do form) vai SO pro MP token. `clienteCpf` (do lead via `cliente_id`) e' o que vira username RADIUS, cpf do pagamento, e variavel `{{cpf}}` do template. Misturar faz a Laura receber no WhatsApp dela o CPF do pai como login (caso real que pegou a gente).

2. **Lookup de telefone NAO usa mais `mac+ip`.** Antes era `WHERE mac = ? AND ip = ?` — frageis porque mac e' aleatorio em celulares e ip e' privado do hotspot. Hoje a chave primaria e' `cliente_id` → leads.

3. **Normalizacao de telefone por COMPRIMENTO, nao por prefixo.** A detecao `startsWith("55")` confunde DDD 55 (Santa Maria/RS) com DDI 55. Regra correta:
   - 10 ou 11 digitos → DDD+numero sem DDI, prefixa "55"
   - 12 ou 13 digitos → ja tem DDI 55, retorna como esta
   - Outros → telefone invalido, skip

4. **Idempotencia do webhook MP.** O MP pode entregar o webhook 2-3 vezes. Tambem, no cartao, o direct response do `/gerar-cartao` + o webhook chegariam dobrado. A solucao: `notificacaoWebhook` captura `statusAnterior` ANTES do UPDATE, e so chama `liberarUsuario` se nao estava approved antes. Se estava, pula (`jaProcessado`). PIX polling ja tinha idempotencia via `radcheck` check. Sem isso, WhatsApp chegava dobrado.

5. **Nunca bloquear a liberacao.** Erros do WhatsApp sao capturados e viram log com status `erro`, mas o `liberarUsuario` e' chamado com `.catch(...)` no `notificarLiberacao`. O cliente sempre e' liberado mesmo com falha no WhatsApp.

6. **Template padrao compartilhado.** `backend/src/constants/whatsappDefaults.js` exporta `DEFAULT_WHATSAPP_TEMPLATE`. Usado por:
   - Migration 012 (backfill de portais existentes)
   - `empresaController.criarEmpresa` (auto-criacao dos 5 portais padrao)
   - `portalController.criarPortal` (portal custom manual)
   Nao duplicar - sempre importar do constants.

7. **Cada caminho de liberacao tem que chamar `notificarLiberacao` explicitamente — nao tem hook global.** Inicialmente so o `mikrotikAPIController.liberarUsuario` (pagamento aprovado) chamava o service. Os portais LGPD, Lead e Lead Passivo cadastravam usuario no RADIUS (ou inseriam o lead) mas **nunca disparavam WhatsApp**, mesmo com toggle ligado e template preenchido — nao aparecia nem row em `whatsapp_logs`. Corrigido em 2026-04-09 adicionando o call em `lgpdController.lgpdLogin`, `leadController.leadLogin` e `leadController.capturaPassiva`. **Regra pra novos handlers:** importar `notificarLiberacao` do service, resolver `portal_id` via `SELECT id FROM portais WHERE tipo = '<tipo>' AND empresa_id = ?`, e chamar com `.catch()` pra nao bloquear o fluxo principal.

---

## Metodos de Pagamento por Portal (Toggles PIX/Cartao)

Cada portal tipo `planos` tem dois toggles independentes no editor: **PIX ativo** e **Cartao ativo**. Salvos em `portais.configuracoes` (JSON) como `pagamento_pix_ativo` e `pagamento_cartao_ativo`.

### Logica

- **Default**: ambos ativos (check `!== false`, config vazia = ambos true)
- **Nao permite desligar os dois simultaneamente** (alert no editor)
- Frontend `Pagamento.jsx` **auto-seleciona** quando so um esta ativo (pula a tela de escolha)
- `/api/planos-publicos/:id` retorna as flags no response (JOIN via `mikrotiks.portal_id`)

### Exibicao

| pix_ativo | cartao_ativo | Comportamento no portal |
|---|---|---|
| true | true | Tela de escolha com 2 botoes (default) |
| true | false | Vai direto pro PIX |
| false | true | Vai direto pro cartao |
| false | false | **Bloqueado no editor** (pelo menos um tem que ficar ligado) |

---

## PIX Trial - Acesso Free ao Copiar PIX

> **Doc tecnico completo:** `docs/PIX-TRIAL.md`

Libera internet temporaria (default 5 min) quando o cliente clica em "Copiar codigo Pix" no portal. Sem isso, cliente fica preso no captive portal e nao consegue abrir o app do banco pra pagar.

### Arquitetura (resumo)

```
[botao Copiar PIX] → POST /api/pagamentos/pix-trial
                          ↓
       1. valida pix_trial_enabled do portal
       2. rate limit 24h por CPF (excecao: se ja pagou antes)
       3. gerarAcessoTemporario com username pixfree_eX_pY_...
       4. UPDATE pagamentos.trial_liberado_em = NOW()
       5. retorna credenciais + gateway
                          ↓
       redirecionarHotspot() → cliente tem internet
```

### Schema (migration 013)

| Tabela | Coluna | Proposito |
|---|---|---|
| `pagamentos` | `trial_liberado_em` TIMESTAMP | marca quando o trial foi disparado, usado no rate limit |
| `pagamentos` | (indice novo) | `idx_pagamentos_cpf_trial (cpf, trial_liberado_em)` |

Config do portal (em `portais.configuracoes` JSON):
- `pix_trial_enabled`: boolean - liga/desliga o trial
- `pix_trial_duracao_minutos`: numero - default 5, min 1, max 30

### Defaults centralizados

`backend/src/constants/whatsappDefaults.js` agora exporta `DEFAULT_PORTAL_PLANOS_CONFIG` alem do `DEFAULT_WHATSAPP_TEMPLATE`. Usado em:
- `empresaController.criarEmpresa` — novos portais `planos` ja vem com PIX/Cartao/Trial ligados
- Backfill one-off rodado em 2026-04-09 pros portais `planos` existentes

### Arquivos-chave

- `backend/src/controllers/pagamentoController.js` - `liberarPixTrial` (endpoint) + `gerarPagamento` estendido pra retornar `pagamento_id` interno
- `backend/src/controllers/authTempController.js` - `gerarAcessoTemporario` agora aceita `opts.duracaoSegundos` + `opts.usernamePrefix`
- `backend/src/controllers/planPublicController.js` - retorna `pix_trial_enabled` e `pix_trial_duracao_minutos` no plano
- `backend/src/constants/whatsappDefaults.js` - `DEFAULT_PORTAL_PLANOS_CONFIG`
- `frontend/src/pages/admin/PortalEditor.jsx` - sub-secao "Acesso gratis ao copiar PIX"
- `frontend/src/pages/public/Pagamento.jsx` - info box + handler do trial

### Gatilho e limite (atual)

- **Gatilho:** o trial dispara SOZINHO assim que o PIX e' gerado (`Pagamento.jsx`, `autoTrialTentado`); o botao "Copiar codigo Pix" e' so plano B. O login final e' uma navegacao, entao o front manda `voltarPara` (`redirecionarHotspot(..., { voltarPara })` -> `&dst=` no MikroTik) e guarda o PIX em `sessionStorage` (`hs_pix_<planoId>_<clienteId>`, so DEPOIS de liberar o trial e valido por 30 min; PIX recem-gerado sem trial nao e' salvo, para a tela de escolha PIX/cartao aparecer normalmente): ao voltar para a pagina ela RETOMA o mesmo PIX (nao chama `/gerar` de novo) e nao repete o trial. Outros vendors voltam pelo `redirect_url`; se voltarem sem a retomada gera-se outro PIX (o limite abaixo segura abuso). `dst`/volta nao testados em MikroTik real.
- **1 vez por pagamento:** `liberarPixTrial` responde 409 `{ ja_liberado:true }` se `pagamentos.trial_liberado_em` ja esta preenchido (sem tocar no RADIUS) e 409 se o pagamento ja esta `approved`/`expirado`. Alem disso vale o maximo de 2 trials por CPF em 24h.

### Prova de posse (obrigatoria)

`POST /api/pagamentos/pix-trial` exige `{ pagamento_id, mp_pagamento_id, mac }` do MESMO registro (como o `/status`): o `pagamento_id` e' sequencial, e so ele permitia a qualquer um trocar a senha do CPF de outro pagamento e receber CPF + senha. Divergencia = 404; campo faltando = 400.

### Regras do Rate Limit

1. **1 trial por CPF a cada 24h** (query por `trial_liberado_em > DATE_SUB(NOW(), INTERVAL 24 HOUR)`)
2. **Excecao**: se o ultimo trial deu em pagamento `approved`, cliente pode gerar outro (e' legitimo)
3. **Sem CPF**: bloqueia com 400. Trial exige CPF (tipicamente vem do `CadastroCliente` → `cliente_id` → `leads.cpf`)
4. Query normaliza CPF (remove `.` `-` ` `) pra evitar burla por formatacao diferente

### Gotchas gravados em sangue

1. **Frontend precisa do `pagamento_id` INTERNO** — nao confundir com `mp_pagamento_id`. O `gerarPagamento` foi estendido pra retornar `pagamento_id: insertPix.insertId` junto com `mp_pagamento_id`.
2. **Query de rate limit normaliza CPF inline** — `REPLACE(REPLACE(REPLACE(cpf,'.',''),'-',''),' ','') = ?` pra lidar com ambos os formatos (formatado e limpo) na mesma tabela.
3. **Username trial tem prefixo `pixfree_`** — diferente de `pix_e` (temp legado do `authTempController`). Evita colisao na limpeza de usuarios temp antigos.
4. **Duracao configuravel por portal** — foi necessario extender `gerarAcessoTemporario` com `opts` pra nao quebrar o fluxo legado que usa 300s hardcoded.
5. **Backfill respeita config existente** — spread `{...defaults, ...existing}` nos portais `planos` antigos garantiu que cores/titulos ja customizados nao foram sobrescritos.

---

## Fingerprint Mercado Pago (mp-security.js)

Pagamento.jsx bloqueia o formulario do cartao ate `window.MP_DEVICE_SESSION_ID` ser populado pelo script `/mp-security.js`. Sem esse fingerprint, antifraude do MP rejeita tudo como `cc_rejected_high_risk`.

### Estados (`fingerprintStatus`)

- `loading` → spinner "Preparando ambiente seguro"
- `ready` → mostra formulario do cartao
- `error` → tela de erro com [Tentar novamente] e [Usar PIX] (segundo so se PIX ativo)

### Timeout

- Poll a cada 300ms checando `window.MP_DEVICE_SESSION_ID`
- **15s max**, depois vai pra `error`
- `recarregarFingerprint()` remove script e reinjeta com cache-bust

### Safety net

O `submeterCartao` tambem valida antes de enviar. Mesmo se o form escapar a checagem visual, nao deixa processar sem fingerprint.

---

## Sistema de Atualizacao (Publish & Apply)

> **Doc tecnico completo:** `docs/SISTEMA-DE-ATUALIZACAO.md`

Distribui updates incrementais (codigo + schema) do servidor mestre pros servidores "aluno" com deteccao automatica de mudancas de arquivo (MD5) **e** de schema MySQL (colunas/indices via INFORMATION_SCHEMA). SQL DDL de ALTER/CREATE/DROP e' auto-gerado e colocado no textarea de migrations pro super admin revisar antes de publicar.

### Arquitetura (resumo)

```
[Master]                               [Aluno]
/super/publicar-atualizacao            /super/atualizar
  1. Tirar Snapshot                      1. Check: POST /api/updates/check
  2. Detectar Alteracoes                    (valida email Hotmart)
     - diff file_snapshots (MD5)         2. Apply por update_id:
     - diff schema_snapshots (JSON)         backup → download → arquivos →
     - gera SQL ALTER/CREATE               migrations → npm install → build →
  3. Publicar → updates/                   registro → PM2 restart
     update_files/update_migrations     3. Modal "Ver Logs" mostra timeline
```

### Schema

| Tabela | Migration | Lado | Proposito |
|---|---|---|---|
| `applied_updates` | 009 | ambos | Ultimo update aplicado no aluno |
| `system_backups` | 009 | ambos | Backups pre-update |
| `updates`, `update_files`, `update_migrations` | 010 | master | Pacote publicado |
| `file_snapshots` | 010 | master | MD5 baseline de arquivos |
| `schema_snapshots` | 014 | master | JSON de colunas/indices por tabela |
| `update_apply_logs` | 015 | aluno | Timeline de cada etapa do apply |

### Arquivos-chave

- `backend/src/controllers/updatePublishController.js` - publish side (scan, diff, generate DDL)
- `backend/src/controllers/systemUpdateController.js` - apply side (download, files, migrations, build, logs)
- `backend/src/routes/systemUpdateRoutes.js` - `/check`, `/apply`, `/logs` (super_admin)
- `backend/src/routes/updatePublishRoutes.js` - `/api/update-publish/*` (super_admin)
- `backend/src/routes/updateCheckRoutes.js` - `/api/updates/{check,download/:id}` (no-auth, valida email Hotmart)
- `frontend/src/pages/super/PublicarAtualizacao.jsx` - UI mestre
- `frontend/src/pages/super/AtualizarSistema.jsx` - UI aluno + modal de logs
- `/etc/nginx/sites-enabled/hotspot` - cache headers (index.html no-store, assets 1y immutable)

### Fluxo de deteccao de schema

1. `getDatabaseSchema()` le `INFORMATION_SCHEMA.COLUMNS` e `INFORMATION_SCHEMA.STATISTICS` pra cada tabela
2. Compara com `schema_snapshots` e gera `{tabelas_novas, tabelas_alteradas, tabelas_removidas}`
3. Tabelas novas: `SHOW CREATE TABLE` com rewrite pra `CREATE TABLE IF NOT EXISTS`
4. Tabelas alteradas: diff coluna-a-coluna (type+nullable+default+extra) e indice-a-indice (unique+columns), gera `ALTER TABLE ... ADD/DROP/MODIFY COLUMN`, `CREATE/DROP INDEX`
5. `flattenSchemaChangesToSql()` concatena tudo separado por `---` (formato do textarea)

### Runner de migrations (aluno)

`aplicarMigrations()` cria **conexao dedicada** (`mysql.createConnection`) com `multipleStatements: true`, roda sequencialmente **sem transacao**. Em caso de erro, reporta `Migration i/total falhou: <msg> | SQL: <preview>`.

Por que sem transacao: MySQL auto-commita DDL. `rollback` era ilusorio — nao desfazia metade aplicada.

### Logs do apply

`logApply(update_id, step, status, message)` grava em `update_apply_logs` + `console.log`. Etapas: `inicio`, `backup`, `download`, `arquivos`, `migrations`, `npm_backend`, `npm_frontend`, `build`, `registro`, `concluido`, `falha`.

Endpoint: `GET /api/system-update/logs?update_id=X` (super_admin). Frontend mostra em modal com timeline colorida.

### Gotchas gravados em sangue

1. **Nginx sem Cache-Control causava falso erro apos apply bem-sucedido** — browser ficava preso em JS antigo que interpretava o novo formato de resposta como erro. Fix: `index.html` com `no-store`, assets hasheados com `immutable 1y`.

2. **Transacao em DDL nao funciona em MySQL** — auto-commit implicito torna rollback impossivel. Runner roda fora de transacao e reporta qual statement falhou pro humano decidir correcao.

3. **Pool mysql2 nao aceita multiplos statements** por default (seguranca contra SQL injection). Runner cria conexao dedicada so pra migrations, nao usa o pool global.

4. **Response do apply precisa de `success: true, applied: true`** — frontend checa esses flags. Antes retornava `{message, update_id}` e frontend tratava como erro. Fix: adicionar esses flags explicitamente.

5. **Ordem alfabetica em tabelas novas pode quebrar FKs** — se `tabela_a` tem FK pra `tabela_z`, CREATE em ordem alfabetica falha. Nao ha resolvedor topologico. Super admin reordena SQL manualmente antes de publicar.

6. **Coluna `NOT NULL` sem `DEFAULT` em tabela com dados vai falhar no aluno** — o diff respeita fielmente o que esta no master (onde a tabela pode estar vazia). Sempre revisar SQL e adicionar DEFAULT antes de publicar.

7. **Tabelas RADIUS estao no diff** — se master e aluno tem versoes diferentes de FreeRADIUS, falsos positivos. Se virar problema, adicionar em `SCHEMA_IGNORE_TABLES` no topo do `updatePublishController.js`.

8. **Sem progress em tempo real** — `execSync` bloqueia o event loop. Logs sao persistidos e visiveis DEPOIS no modal "Ver Logs", nao em streaming.

9. **`UPDATE_SERVER_URL` no `.env` do aluno** e obrigatorio. Sem ele, `/check` retorna 500.

10. **Primeiro snapshot antes de qualquer mudanca** — se nao, o primeiro `Detectar Alteracoes` nao detecta mudancas de schema (mostra banner amarelo). Solucao: clicar em "Tirar Snapshot" uma primeira vez logo apos instalar.

---

## Hardening do Instalador (empacotar.sh + install.sh)

> **Doc tecnico completo:** `docs/INSTALADOR-HARDENING.md`

Pipeline `empacotar.sh` -> tarball -> `install.sh` num servidor limpo. O `install.sh` foi endurecido pra: (1) rodar TODAS migrations em loop, (2) detectar SSH port automatico antes do UFW, (3) servir nginx com cache headers corretos pro sistema de updates funcionar. O `estrutura.sql` foi regenerado via `mysqldump --no-data` (30 -> 41 tabelas) com seeds essenciais preservados.

### Arquitetura (resumo)

```
master ─ empacotar.sh ─> hotspot-YYYYMMDDHHMM.tar.gz
                              │
                              v
servidor novo ─ install.sh ─> [SSH detect] -> [deps] -> [estrutura.sql] ->
                              [for migrations/[0-9]*.js] -> [nginx no-store] ->
                              [ufw allow $SSH_PORT primeiro] -> [PM2 start]
```

### Arquivos-chave

- `backend/jobs/estrutura.sql` - schema completo (mysqldump fiel da master) + 7 INSERTs de seed
- `backend/jobs/estrutura.sql.bak` - backup da versao manual antiga (manter por garantia)
- `install.sh:127-145` - deteccao + prompt de SSH port
- `install.sh:406-411` - loop `for migrations/[0-9][0-9][0-9]_*.js`
- `install.sh:611-628 / 698-715` - blocos nginx VPS e Traefik (cache headers)
- `install.sh:840-862` - firewall UFW (libera $SSH_PORT antes do --enable)

### Seeds essenciais (no estrutura.sql)

| Seed | Tabela | Conteudo |
|---|---|---|
| Empresa default | `empresas` | id=1, slug=`default` |
| Super admin | `admins` | `admin@empresa.com / admin123` (bcrypt) — o `install.sh` troca por senha aleatoria (impressa e gravada em `/root/hotspot-credenciais.txt`) |
| 5 portais padrao | `portais` | LGPD, Planos, Lead, Lead-Passivo, Login |
| 2 planos default | `planos` | LGPD (5min), Lead (1min) - mikrotik_id=0 com FK_CHECKS=0 |
| 4 portal_templates | `portal_templates` | Basico, Planos, Completo, Lead-Passivo |
| Sync inicial | `connection_logs_sync` | (1, 0, NOW()) |

### Gotchas gravados em sangue

1. **Sempre liberar SSH port no UFW ANTES do `ufw --force enable`.** Inversao = sessao SSH cai antes da regra ser aplicada. Tem cinto + suspensorio: se porta detectada nao for 22, libera 22 tambem.

2. **`mysqldump --no-data` mata todos os seeds.** Quando regenerar `estrutura.sql`, sempre re-anexar os 7 INSERTs do `.bak` (linhas 547-582). Sem isso, install termina sem super admin e o painel fica inacessivel.

3. **Migrations ja sao em sua maioria idempotentes** (012-015 checam INFORMATION_SCHEMA / `IF NOT EXISTS`), entao nao devem falhar por 'Duplicate column' num install novo. As excecoes reais estao na secao "Migrations: idempotencia (auditoria)" (001 e 007).

4. **Bug pre-existente:** `lgpd_logins` nao existe na master (so `lgpd_logins_backup`), mas `whatsappNotify.js:226` ainda referencia. Nao corrigido neste hardening - feature provavelmente quebrada ha tempos sem ninguem notar.

5. **Nginx `index.html` PRECISA de `Cache-Control: no-store`** ou o sistema de updates quebra (browser preso em JS antigo apos `apply`). Ja documentado em `SISTEMA-DE-ATUALIZACAO.md` gotcha #1, mas estava faltando no install.sh ate agora.

6. **Loop de migrations pega `[0-9][0-9][0-9]_*.js`** - migrations novas tem que comecar com 3 digitos. `15_xxx.js` ou `0015_xxx.js` nao sao pegas.

---

## Redirect entre Portais (Propagacao de portal_id)

> **Doc tecnico completo:** `docs/REDIRECT-ENTRE-PORTAIS.md`

O portal `login` ("Acesso Wi-Fi") tem um link "Clique aqui" que redireciona pra outro portal (tipicamente Planos). Antes de 2026-04-09, o destino carregava configs do portal **errado** (o portal Login, vinculado ao MikroTik via `mikrotiks.portal_id`). Toggle PIX/Cartao, PIX Trial, WhatsApp template — tudo era ignorado em silencio. O fix propaga um `portal_id` explicito do redirect ate o backend.

### Arquitetura (resumo)

```
LoginHotspot (cfg.link_portal_id) ─click─>
  /planos-cliente?...&portal_id=X ─>
    /cadastro-cliente?...&portal_id=X ─>
      /pagamento/N?...&portal_id=X ─>
        Backend: planos-publicos/:id?portal_id=X (JOIN portais.id = X)
                 pagamentos/gerar       (body.portal_id -> INSERT pagamentos.portal_id)
                 pagamentos/gerar-cartao (idem)
        liberarPixTrial / notificarLiberacao herdam de pagamentos.portal_id
```

### Arquivos-chave

- `backend/src/controllers/planPublicController.js` - aceita `?portal_id=` na query
- `backend/src/controllers/pagamentoController.js` - `gerarPagamento` e `gerarPagamentoCartao` aceitam `portal_id` no body
- `frontend/src/pages/admin/PortalEditor.jsx` - select de destino salva `link_portal_id`
- `frontend/src/pages/public/LoginHotspot.jsx` - redirect anexa `portal_id`
- `frontend/src/pages/public/{PlanosCliente,CadastroCliente,Pagamento}.jsx` - capturam e propagam

### Gotchas gravados em sangue

1. **`mikrotiks.portal_id` aponta sempre pro portal de ENTRADA, nunca o de destino.** Codigo que resolve "qual portal usar" lendo dali sempre cai no errado quando ha redirect entre portais. **Regra:** sempre preferir `portal_id` explicito (request body/query) sobre `resolvePortalIdByMikrotik`.

2. **Portais Login configurados ANTES de 2026-04-09 nao tem `link_portal_id` no JSON.** O `onChange` do select agora popula os dois campos, mas configs antigas so tem `link_portal_url`. **Backfill manual obrigatorio:** abrir o portal Login no editor, reselecionar o destino no dropdown, salvar. Sem isso o redirect funciona mas sem `portal_id` na URL e cai no fallback antigo (= bug volta silenciosamente).

3. **`liberarPixTrial` e `notificarLiberacao` herdam o portal correto via `pagamentos.portal_id`** (gravado no INSERT). Nao recebem `portal_id` por parametro proprio. Se alguem mudar pra ler de outro lugar (ex: query), re-introduz o bug. **Manter a leitura via `pagamentos.portal_id`.**

4. **Novos handlers de liberacao TEM que receber e propagar `portal_id`.** Se um controller futuro chamar `liberarUsuario` sem passar `portal_id`, o WhatsApp cai no fallback `resolvePortalByMikrotik` em `whatsappNotify.js:101` — mesmo bug arquitetural. Sempre passar adiante.

5. **Caminho legado preservado.** Se `portal_id` nao vier (caminho direto MikroTik -> portal sem redirect), backend usa `mikrotiks.portal_id` como antes. Compatibilidade total.

---

## Gateways Multi-Vendor (MikroTik / Omada / UniFi / Grandstream)

> **Doc tecnico completo:** `docs/GATEWAYS-MULTI-VENDOR.md`

A tela "Equipamentos" (antiga Mikrotiks, rota `/admin/:slug/mikrotiks` mantida) cadastra
qualquer gateway via wizard de 3 passos (Tipo → Conexao → Portal). Toda configuracao —
incluindo o NAS/FreeRADIUS — e' feita pelo frontend, zero SQL.

### Arquitetura (resumo)

```
GatewayWizard.jsx ─POST/PUT─▶ mikrotikRoutes.js: validarGateway() por tipo
                                 usaRadius()? sim → upsert nas + restart freeradius
                                              nao → remove nas orfao (unifi / omada-API)
Acoes por linha ──▶ getDriver(row): MikrotikDriver | OmadaDriver | UnifiDriver
```

### Schema

| Migration | Mudanca |
|---|---|
| 019 | `mikrotiks` + tipo ENUM, controller_url, controller_site, omadac_id, api_user, api_pass, api_key, verify_tls |
| 020 | `usuario`/`senha` viram NULLABLE (UniFi/Omada-API nao tem credencial RouterOS) |
| 024 | `ap_mac`/`ssid` em `connection_logs` e `leads`, tabela `access_points` |
| 025 | ENUM `tipo` inclui `grandstream`; colunas `gwn_api_key`, `gwn_api_secret`, `gwn_network_id` |

**Grandstream (GWN):** `backend/src/gateways/GrandstreamDriver.js` (+ `controllers/grandstreamController.js`, tutorial em `frontend/src/pages/admin/TutorialGrandstream.jsx`, rota `/admin/:slug/tutorial-grandstream`). Opera como External Web Portal + External RADIUS (igual ao Omada External RADIUS); o "login final" e' um GET no login URL do gateway montado em `gatewayLiberacao.montarGatewayInfo` (`tipo:'grandstream'`). As chaves GWN Cloud sao opcionais (so monitoramento no "Testar"); sem elas `testConnection` retorna sucesso. Desconexao ativa nao e' suportada via External RADIUS.

### Arquivos-chave

- `backend/src/routes/mikrotikRoutes.js` - validarGateway, usaRadius, guard somenteMikrotik
- `backend/src/gateways/` - drivers + factory `getDriver()`
- `frontend/src/components/admin/GatewayWizard.jsx` - wizard
- `backend/src/jobs/syncUnifiSessions.js` - agendado no cron 5min do server.js

### Gotchas gravados em sangue

1. **Omada: `controller_url` NULL = modo External RADIUS** (recomendado; RADIUS/quota/compliance identicos ao MikroTik). Preenchido = modo API (sem accounting!). `senha` = secret RADIUS no modo External.
2. **`testConnection` do Omada External RADIUS retorna sucesso sem testar API** — nao ha o que testar; sem esse short-circuit aparecia Offline pra sempre.
3. **Endpoints RouterOS (scan/enviar-*/info) tem guard `somenteMikrotik`** — chamar num Omada/UniFi da' 400, nao timeout.
4. **Tipo e' travado na edicao** (frontend e backend) — trocar tipo deixaria NAS orfao.
5. **Omada External RADIUS foi VALIDADO EM CAMPO (2026-08-17, OC300)** — fluxo completo ok. Omada modo API e UniFi seguem com `TODO(hardware)`. Aprendizados do campo (detalhes em `docs/EDIT-20260817-001.md`):
   - browserauth via `http://{target}:{serverPort}` (8088) — https:8843 tem cert self-signed que o webview do captive portal bloqueia.
   - Rate limit multi-vendor = gravar `WISPr-Bandwidth-Max-Up/Down` (bps) JUNTO com `Mikrotik-Rate-Limit` no radreply. Todo caminho novo de liberacao deve gravar os tres.
   - `radius_users.liberado_em` TEM que ser preenchido no INSERT (`VALUES (..., NOW())` + `ON DUPLICATE ... liberado_em = NOW()`), nunca so via UPDATE antes do INSERT — senao a franquia do sqlcounter nunca renova a partir do 2o ciclo.
   - Sessoes ativas: NAS-IP do Omada e' o IP LAN do controller; a query da tela resolve empresa por COALESCE(mikrotiks via NAS-IP, radius_users via username).
   - Tutorial com prints pro usuario final: menu Documentacao -> Tutorial Omada (`frontend/src/pages/admin/TutorialOmada.jsx`).
6. **Liberacao multi-vendor (2026-08-11):** o "login final" e' roteado por `gateway_info` na resposta de TODA liberacao (pagamento/LGPD/lead/login/trial). `backend/src/gateways/gatewayLiberacao.js` monta esse objeto: MikroTik = `{tipo:'mikrotik'}` (fluxo legado intacto); Omada External RADIUS = form `browserauth` que o NAVEGADOR posta em `{scheme}://{target}:{targetPort}/portal/radius/browserauth` (doc TP-Link 13025); Omada API/UniFi = backend chama `authorizeApiOnly()` do driver (extPortal/auth / authorize-guest) e o frontend so redireciona. O branch fica em `frontend/src/utils/hotspotRedirect.js`. **Novo endpoint de liberacao TEM que incluir `gateway_info: await montarGatewayInfo(...)` na resposta** — sem isso Omada/UniFi liberam RADIUS mas o cliente fica sem internet.
7. **Contexto do vendor e' persistido no redirect** (`portal_contexts`, migration 022, chave mikrotik_id+mac normalizado, TTL 48h). Os params do Omada/UniFi (apMac, ssidName, radioId, site, target/targetPort, redirectUrl) so existem no `/hotspot/redirect` — sem persistir, o authorize na liberacao (minutos depois) e' impossivel. `salvarContextoPortal` roda so pra tipo != mikrotik.
8. **`portal_id` de endpoint publico NUNCA e' confiavel** — validar com `SELECT id FROM portais WHERE id = ? AND empresa_id = ?` antes de usar (feito em `pagamentoController.validarPortalDaEmpresa`, `planPublicController`, `whatsappNotify`, `leadUtils.resolverTextoLgpd`). Sem isso, cliente aponta pro portal de OUTRA empresa (burla trial, template alheio, termo LGPD errado).
9. **Os 5 portais padrao vem de `backend/src/utils/empresaSetup.js` (`criarPortaisPadrao`)** — usado por `empresaController.criarEmpresa` E `registroController.registrarEmpresa`. Bug historico corrigido em 2026-08-11: o registro publico (`POST /api/registro`) criava empresa SEM portais (LGPD/lead/WhatsApp falhavam em silencio). Nao duplicar o INSERT — sempre importar do helper.

---

## Reconexao por CPF: data de nascimento e re-liberacao

`/api/lgpd/login`, `/api/lead-portal/login` e `/api/clientes/cadastro` so devolvem credenciais RADIUS (ou alteram o cadastro) de um CPF ja existente se a data de nascimento informada bater com a gravada em `leads.data_nascimento`. Logica em `leadUtils.conferirDataNascimento` (`ok` / `ausente` / `divergente` / `bloqueado`):

- `divergente` (ha data gravada e a informada falta ou nao bate): HTTP 403 com `requer_data_nascimento: true`; nada e' alterado nem devolvido.
- `ausente` (cadastro legado sem data): nao da pra provar titularidade. Nunca devolve a senha existente nem troca telefone/e-mail/MAC; LGPD/Lead registram so o novo aceite; `cadastroCliente` segue para planos sem PII do titular. Do mesmo aparelho (MAC) a data e' gravada primeiro (`gravarDataNascimento`), entao o legado se "atualiza" sozinho.
- `bloqueado`: HTTP 429 apos 10 tentativas erradas/hora por CPF (empresa+CPF) ou por dispositivo (IP+MAC), em memoria (`utils/dobTentativas.js`, zera no restart do PM2).
- `leadLogin` usa telefone/e-mail/MAC como username: credencial so e' devolvida se o username pertence ao proprio lead (`usernamePertenceAoLead`).
- Todo novo fluxo de reconexao por CPF TEM que chamar `conferirDataNascimento` antes de devolver credenciais.
- **Re-liberacao (DELETE+INSERT em radcheck/radreply/radusergroup) nao pode sobrescrever acesso ativo de quem nao se provou.** `leadUtils.bloqueiaReliberacao` recusa com HTTP 409 (`requer_data_nascimento: true`) quando o username ja tem saldo ativo e o titular nao foi verificado (cadastro legado sem data, CPF sem lead mas com username ja em uso, telefone/e-mail de outra pessoa). Sem saldo ativo a renovacao segue livre (e' assim que a franquia esgotada se renova); username = MAC do proprio aparelho (portal sem CPF) fica fora da trava. **Excecao: se o acesso ativo e' do plano gratis dos portais (`planos.nome` LGPD ou Lead, via `radius_users.plano_id`; `leadUtils.acessoEhGratis`) a re-liberacao e' permitida** — nao ha o que proteger e trancar o dono (que nunca conectou) so deixaria o acesso parado; acesso pago, criado pelo admin ou sem registro em `radius_users` continua protegido. Todo novo handler que regrave credenciais de um username existente TEM que passar por essa checagem.
- **Pagamento com acesso ainda ativo empilha o tempo restante** (`liberarUsuario({ empilharTempo: true })`): `Max-All-Session` e `Session-Timeout` = duracao do plano novo + tempo restante do acesso atual (`verificarSaldoRadius`); a velocidade passa a ser a do plano novo. So os 3 caminhos com idempotencia por pagamento (`pagamentos.liberado_em`: cartao, webhook PIX, polling PIX) passam `empilharTempo: true` — uma 2a chamada para o mesmo pagamento empilharia o plano de novo. A liberacao manual (sem marcador) NAO empilha. Ao empilhar, `estenderExpiracaoPagamentos` avanca o `expira_em` dos pagamentos `approved` do mesmo cliente (CPF, ou MAC sem CPF) para o total, porque o job `verificaExpiracoes` remove o usuario do RADIUS no vencimento de cada pagamento (o de um pagamento antigo derrubaria o tempo novo); nunca encurta. Qualquer novo caminho de liberacao por pagamento so pode passar `empilharTempo: true` se tiver marcador idempotente equivalente.
- **Pagamento para CPF alheio:** as rotas de pagamento sao publicas e aceitam `cpf`/`cliente_id` do corpo (`cliente_id` e' sequencial), entao nao da pra confiar no cadastro anterior. `leadUtils.bloqueiaPagamentoAlheio` recusa com HTTP 409 (`requer_data_nascimento: true`) **antes de cobrar** (`gerarPagamento` PIX, `gerarPagamentoCartao`) e tambem em `cadastroCliente` (caso legado sem data) quando o CPF ja tem acesso ATIVO no RADIUS e o MAC da requisicao nao e' o de nenhum lead desse CPF. Quem esta em outro aparelho confirma a data de nascimento no cadastro (isso passa o MAC do lead para o aparelho novo) e so entao paga. Sem acesso ativo nao ha o que proteger; sem CPF o username e' o MAC e a trava nao se aplica. O lookup do lead no PIX agora filtra por `empresa_id`. Todo novo caminho que crie pagamento a partir de CPF/`cliente_id` vindo do cliente TEM que passar por essa checagem.
- Limites conhecidos: (1) legado sem data de nascimento, em outro aparelho e com acesso ativo, nao consegue comprar ate o tempo acabar (so reconecta com o usuario/senha ja recebidos); (2) corrida: se o acesso do titular ficar ativo entre a criacao e a confirmacao do pagamento, o tempo dele e' preservado (empilha) mas a senha e' trocada.
- **Grilagem de CPF (cadastro provisorio):** nao ha como provar a titularidade de um CPF sem fonte externa (Receita/birô), entao a data de nascimento so vale como trava rigida para CPF **confirmado por dinheiro** (`leadUtils.cpfConfirmado`: existe pagamento `approved`/`expirado` com o CPF na empresa). Enquanto o CPF nunca pagou, o cadastro e' provisorio: `conferirDataNascimento` devolve `reivindicado` (em vez de `divergente`/403) quando o chamador informa OUTRA data valida — a data e o contato (nome, e-mail, telefone, MAC) passam a ser os de quem se cadastrou agora, para quem digitou o CPF de outra pessoa antes nao trancar o dono de verdade para fora nem receber por WhatsApp a credencial do pagamento dele. Em `cadastroCliente` (`reivindicarAusente`) o cadastro legado sem data tambem e' reivindicado. `reivindicado` **nunca** devolve credenciais existentes (so `ok` devolve) e a re-liberacao continua passando por `bloqueiaReliberacao`; cada reivindicacao conta como tentativa no limite de 10/hora (CPF e dispositivo). Sem data informada nao ha reivindicacao (403 como antes). `cpfConfirmado` com erro de banco devolve `true` (lado seguro). Todo novo fluxo que use `conferirDataNascimento` TEM que tratar `reivindicado` como "nao provou titularidade".
- **Cadastro importado nao e' provisorio:** `cpfConfirmado` tambem devolve `true` para CPF cujo lead foi CRIADO por importacao (`leads.importado_em IS NOT NULL`; SGP/planilha do proprio provedor = fonte confiavel). Assim quem digita o CPF de um cliente importado no portal com outra data recebe `divergente` (403), nao `reivindicado`: nao sobrescreve data nem contato importados, nem planta data num importado sem data (`ausente`). A mescla em lead JA existente (preenche so vazios) NAO grava `importado_em`, entao um cadastro provisorio criado por terceiro nao herda a confianca ao ser importado depois (limite: a data/contato plantados por ele continuam, pois a importacao nunca sobrescreve campos preenchidos). Cliente importado que nao lembra a data nao reconecta pelo portal ate o admin corrigir o cadastro na tela Clientes.
- **Login por usuario/senha do portal (`POST /api/login-portal/auth`, `LoginHotspot.jsx`) e' reconexao tambem:** (1) usuario inexistente e senha errada respondem igual (401 `Usuário ou senha inválidos`), sem enumerar CPF/telefone com acesso; (2) `utils/loginTentativas.js` (memoria do processo) conta tentativas erradas: 10/hora por IP+usuario e 40/hora por usuario (qualquer IP) => 429; a trava por usuario e' alta de proposito para um atacante nao trancar o dono para fora; (3) senha LEGADA (`== username`, ex. CPF/CPF, de antes da senha aleatoria) so autentica no aparelho que ja usou esse acesso (`dispositivoJaUsouAcesso` pelo `mac` do body); em outro aparelho o cliente refaz o cadastro no portal (data de nascimento), que grava senha aleatoria; (4) o usuario precisa pertencer a empresa do gateway (`radius_users.empresa_id` x `mikrotiks.empresa_id`). Limite: o `mac` vem do cliente (spoofavel por quem conhece o MAC do aparelho do titular, que nao e' publico). Todo novo login por usuario/senha TEM que passar por `loginTentativas`.
- **Rotas publicas que NAO podem alterar cadastro existente sem segundo fator:** `capturaPassiva` (lead passivo) nunca altera um lead de CPF ja cadastrado (responde como cadastro novo, sem inserir duplicata nem revelar o CPF); `lgpdCadastro` segue as mesmas regras do `lgpdLogin` (`conferirDataNascimento`: 429/403; so `ok`/`reivindicado` trocam nome/e-mail/telefone/MAC, os demais registram apenas o aceite). Antes, bastava o CPF para sobrescrever o contato e o MAC de qualquer cadastro (inclusive pagante/importado) e burlar `bloqueiaPagamentoAlheio` (que confia no MAC do lead). Todo endpoint publico que chame `atualizarLeadExistente` TEM que passar por `conferirDataNascimento`.
- **Busca por CPF (`POST /api/lgpd/consulta-cpf`) e travas:** a busca so acha com CPF + data da MESMA empresa (mesma resposta para CPF inexistente/data errada) e as travas por CPF e por dispositivo (`rateLimiters.cpfLookupLimiters`, 10/h cada) contam apenas buscas que NAO acharam (`res.locals.consultaEncontrada` + `requestWasSuccessful`): palpites de data consomem a cota, mas o titular que acerta nao se tranca ao consultar e confirmar (cada busca usa 2 chamadas). O teto por IP (120/h) conta tudo. Limite conhecido: quem erra 10 palpites no CPF de outra pessoa trava a busca daquele CPF por 1h (memoria do processo); em CPF provisorio a data nao e' segredo (ver cadastro provisorio).
- **CPF invalido barrado no servidor:** `lgpdLogin`, `lgpdCadastro`, `leadLogin`, `capturaPassiva` (CPF opcional) e `cadastroCliente` validam os digitos verificadores (`utils/cpf.validarCPF`) e respondem 400 `CPF inválido` antes de gravar qualquer coisa; antes so o front validava e um POST direto criava lead/username RADIUS com CPF inventado, impossivel de ser reclamado por um dono real. Todo novo endpoint publico que receba CPF TEM que chamar `validarCPF`.
- **Cadastro manual (tela Clientes, `POST/PUT /api/leads`):** `criarLead` NUNCA grava `mac`, `ip`, `origem` nem `lgpd_aceite` vindos do corpo (origem fixa `manual`, aceite 0): o MAC do lead e' a ancora de `bloqueiaPagamentoAlheio` e o aceite LGPD so existe quando o titular aceita no portal. `atualizarLead` recusa (409) trocar o CPF de um cadastro que ja tem dono (MAC/aceite do portal, `importado_em` ou CPF confirmado por pagamento), senao o MAC/aceite seriam transplantados para outro CPF; cadastro manual sem dono pode ter o CPF corrigido. Outros campos continuam editaveis. Cadastro manual e' provisorio (nao e' `importado_em`). Teste: `backend/tests/unit/cadastroManual.test.js`.
- Limites da grilagem: (1) **pagamento com CPF alheio — tratado:** `pagamentos.pagador_cpf` (migration 030) guarda o CPF de QUEM PAGOU (PIX: dado do banco no MP, `point_of_interaction.transaction_data.bank_info.payer` ou `payer.identification`, gravado no webhook, aceita mascara com `*` desde que mostre >= 6 digitos (senao vira DESCONHECIDO); cartao: CPF do titular informado no form, so gravado como registro) e `leadUtils.cpfConfirmado` so conta o pagamento se `metodo_pagamento` NAO for `cartao` (o CPF do cartao e' digitado e o MP nao o verifica contra o emissor, entao cartao nunca confirma CPF — quem so pagou com cartao continua com cadastro provisorio) e, alem disso, se `pagador_cpf` for NULL (desconhecido, conta como antes) ou compativel com o CPF do cadastro (`utils/pagadorCpf.js`). Limites: o formato dos campos do MP no PIX nao foi validado contra um MP real (ausente => o webhook grava o marcador `DESCONHECIDO` e o pagamento NAO confirma; so pagamentos antigos com NULL seguem contando — se o MP nao devolver o CPF do pagador, nenhum CPF novo e' confirmado por PIX e o log avisa `PIX aprovado sem CPF do pagador`); cliente que so pagou com cartao (inclusive pagamentos antigos) volta a ser cadastro provisorio ate pagar um PIX; pai pagando pelo filho nao confirma o CPF do filho; pagamentos antigos (NULL) continuam contando; sem a migration 030 `cpfConfirmado` cai no catch e devolve `true`; (2) **acesso gratis exposto — tratado:** em CPF sem pagamento a data NAO prova nada (quem reivindica a grava e volta com ela), entao `leadUtils.podeReceberCredenciais` so devolve as credenciais de um acesso EXISTENTE (LGPD `lgpdLogin`, Lead `leadLogin`, auto-login do `cadastroCliente`) se o CPF e' confirmado por pagamento (a data basta, trava rigida) **ou** o aparelho (MAC) ja conectou com aquele username (`dispositivoJaUsouAcesso`: sessao no `radacct` com `callingstationid` = MAC). Os demais caem na re-liberacao (senha nova, franquia nova — nunca a senha antiga), que e' permitida por ser acesso gratis; e a resposta da re-liberacao traz `tratarSessaoAtiva` (aviso para desconectar a sessao em outro aparelho, senao o `Simultaneous-Use=1` recusaria o login novo). `POST /api/sessao/desconectar-anterior` aplica a mesma regra (`podeReceberCredenciais` ou `acessoEhGratis`) para nao derrubar acesso que nao seja o gratis; (3) a troca de dono apaga o contato anterior desse cadastro provisorio (o aceite LGPD do novo cadastrante o substitui; `[reivindicacao-cpf]` fica no log sem CPF).

---

## Compliance: Relatorios Marco Civil e LGPD

> **Doc tecnico completo:** `docs/COMPLIANCE-LGPD.md`

Dois relatorios legais **separados de proposito** (finalidades/prazos diferentes), mas com
tela e CSV identicos e cobrindo todos os gateways. Marco Civil: `connection_logs` (nada
apaga automaticamente; guarda >= 1 ano). LGPD: consentimentos em `leads` com snapshot do
termo aceito.

### Schema

| Migration | Mudanca |
|---|---|
| 021 | `leads.lgpd_termo` TEXT — snapshot do texto do termo no momento do aceite |

### Arquivos-chave

- `backend/src/controllers/complianceController.js` - Marco Civil (JOIN mikrotiks → coluna Equipamento)
- `backend/src/controllers/lgpdController.js` - relatorio LGPD ampliado + `exportarLgpdCSV`
- `backend/src/utils/leadUtils.js` - `resolverTextoLgpd` (server-side, nunca do client)
- `frontend/src/pages/admin/Configuracoes.jsx` - limpeza com dupla confirmacao (digitar LIMPAR)

### Gotchas gravados em sangue

1. **Empresa orfa quebra aceites e o CASCADE apaga consentimentos.** Em 2026-08-11 a empresa 13 (deletada) deixou mikrotik/portais/planos orfaos, aceites falhando com FK e o historico de `leads` perdido pela cascata. Fix local: realinhamento 13→1 (**NAO vai no pacote de atualizacao**). Deteccao: `SELECT DISTINCT empresa_id FROM mikrotiks WHERE empresa_id NOT IN (SELECT id FROM empresas)`.
2. **`connection_logs.nas_ip` e' VARCHAR(15)** — jobs devem gravar `mikrotiks.ip` (nunca controller_url), senao o JOIN do relatorio quebra.
3. **Relatorio LGPD inclui qualquer origem com aceite** (`origem='lgpd' OR lgpd_aceite=1`), nao so o portal LGPD.
4. **Todo fluxo novo de aceite TEM que gravar `lgpd_termo`** via `resolverTextoLgpd` — aceite sem termo nao e' prova LGPD.
5. **`lgpd_logins` nao existe mais** — consentimento vive em `leads`; so ha `lgpd_logins_backup`.
6. **Filtros da tela Cadastros LGPD (`LgpdCadastros.jsx`)**: origem, status do aceite, periodo (De/Ate sobre `COALESCE(lgpd_aceite_em, criado_em)`, ate 366 dias), ponto de acesso e SSID, aplicados NO SERVIDOR por `lgpdController.montarFiltrosLgpd` (placeholders, `empresa_id` sempre do tenant, valor invalido = 400 `Filtro inválido`) em `GET /api/lgpd` e tambem em `GET /api/lgpd/export` (o CSV sai com os mesmos filtros da tela; sem filtro continua completo, max 50000). `GET /api/lgpd/filtros` devolve origens/SSIDs/APs da empresa para os selects. A busca por texto continua no navegador. Teste: `backend/tests/unit/lgpdFiltros.test.js`. Os selects Ponto de acesso/SSID so aparecem se houver valores. **AP/SSID do cadastro:** Omada/UniFi gravam no aceite pelo contexto do portal (`portal_contexts`); MikroTik nao tem contexto, entao `syncConnectionLogs.completarApDosLeads` completa so os NULL a partir da sessao mais recente do MAC em `connection_logs` (MikroTik: `ssid` = nome do hotspot server, `ap_mac` fica vazio; janela de 1 dia a cada sync; rodar `node src/jobs/syncConnectionLogs.js` na mao faz o backfill de todo o historico). Teste: `backend/tests/unit/syncApLeads.test.js`. **Equipamento (migration 056):** `leads.mikrotik_id` (sem FK; INT NULL) guarda o equipamento do 1o aceite, gravado em melhor esforco por `leadUtils.gravarEquipamentoLead` (valida que o equipamento e' da empresa, so grava se NULL, nunca derruba o portal; chamado em `lgpdLogin`/`lgpdCadastro`/`leadLogin`/`capturaPassiva`/`cadastroCliente`). A migration faz backfill por `radius_users.nas_id` (CPF) e por `connection_logs` (MAC). `GET /api/lgpd` e o CSV ganham a coluna Equipamento e o filtro `?equipamento=<id>`; `/api/lgpd/filtros` devolve `equipamentos`. Sem a migration tudo segue (`schemaCache.temColuna`: sem filtro/coluna). **Rodar no servidor:** `node migrations/056_leads_mikrotik_id.js`. **Exportar contatos tambem aqui:** botao "Exportar contatos" (Google Contatos / Outlook / vCard) ao lado do "Exportar CSV"; `GET /api/lgpd/export-contatos?formato=google|outlook|vcard` aplica os MESMOS filtros da tela (`montarFiltrosLgpd`), so inclui quem tem telefone, ate 50000, e usa o mesmo token de download e o recurso `exportacao` do `/api/leads/export-contatos` (o CSV de consentimento continua sem recurso); reaproveita `utils/exportarContatos.gerarContatos`; auditoria `cliente.exportar`. Teste em `lgpdFiltros.test.js`.

---

## Uploads de Tenant (logos) fora do git

- `frontend/public/uploads/logos/*` esta no `.gitignore` (so o `.gitkeep` e' versionado) e os logos antigos foram removidos do indice (`git rm --cached`). `backend/uploads/` tambem e' ignorado.
- Criacao de diretorios nao depende do git: `empresaRoutes.js` e `portalRoutes.js` fazem `mkdirSync(..., {recursive:true})` de `frontend/dist/uploads/logos` e `frontend/public/uploads/logos` ao carregar; `install.sh` faz `mkdir -p backend/uploads/campanhas`; `uploadCampanha.js` usa `backend/uploads/campanhas`.
- Sistema de update NAO e' afetado: `updatePublishController` varre o disco (nao `git ls-files`) apenas em `SCAN_TARGETS` (backend/src, server.js, package.json, routes, migrations, frontend/src, ...), e `frontend/public/` / uploads nao estao la.
- **Cuidado no deploy:** em servidores que fazem `git pull` deste commit, o git remove do disco os logos que estavam versionados (arquivos de tracked -> untracked sao apagados no checkout). Faca backup de `frontend/public/uploads/logos/` antes do pull e restaure depois. O build do Vite copia `public/` para `dist/`, entao logos so sobrevivem a um `npm run build` se estiverem em `public/uploads/logos`.
- `.gitignore` tambem ignora `*.sql`, entao `backend/jobs/estrutura.sql` (citado acima) nao aparece no repo: `install.sh` depende dele no pacote gerado por `empacotar.sh` (que nao esta neste repo).

---

## Migrations: idempotencia (auditoria)

Rodar uma migration 2x deve ser seguro, mas nem todas sao. Auditoria de `backend/migrations/` (apenas listagem; codigo nao alterado):

**NAO idempotentes**
- `007_portal_template_lead_passivo.js` - `INSERT INTO portal_templates` sem checar existencia: duplica o template "Cadastro de LEAD (Sem Internet)" a cada execucao.
- `001_multi_tenant.js` - passos 12 e 13 re-executam `INSERT ... ON DUPLICATE KEY UPDATE` copiando `config_mercadopago`/`efi_config` legadas para `empresa_configs`: sobrescrevem a config atual da empresa padrao. Alem disso o passo 9 faz `SHOW COLUMNS FROM lgpd_logins`, tabela que nao existe mais: em banco novo/atual a migration 001 falha (rollback) nesse passo.

**Parcialmente idempotentes / com efeito colateral ao repetir**
- `004_portal_templates.js` - ALTERs e templates sao guardados, mas o guard dos templates e' "tabela vazia" (nao por nome).
- `006_mikrotik_portal_id.js` - coluna guardada; FK dentro de try/catch (erro de FK duplicada so e' logado).
- `017_connection_logs_unique.js` - guardas ok, mas refaz backfill e DELETE de duplicatas a cada execucao (seguro, custo).
- `023_radius_users_unique.js` - refaz dedup (DELETE) a cada execucao; seguro, mas destrutivo por natureza.
- `024_ap_info.js` - guardas ok; reexecucao faz `MODIFY` (normaliza collation) e backfill so de linhas com `ap_mac`/`ssid` NULL.
- `008_inserir_portais_lead_passivo.js`, `018_grupo_completo.js` - guardados por SELECT (018 reaplica permissoes totais ao grupo "Acesso Completo" a cada execucao, sobrescrevendo ajustes manuais desse grupo).

**Idempotentes** (CREATE IF NOT EXISTS / checagem em INFORMATION_SCHEMA): 002, 003, 005, 009, 010, 011, 012, 013, 014, 015, 016, 019, 020, 021, 022, 025, 026.

Impacto no `install.sh`: o loop roda todas as migrations em servidor novo; 001 e 007 sao as que causam problema/ruido. Relacionado ao gotcha #3 do instalador acima.

---

## Notas Importantes para IA

1. **Multi-tenant SEMPRE:** Toda query deve filtrar por `empresa_id`. Nunca expor dados de uma empresa para outra.

2. **SQL puro preferido:** O projeto usa `db.execute()` com mysql2 pool, nao Sequelize ORM para a maioria das operacoes. Mantenha esse padrao.

3. **Tabelas legadas:** `config_mercadopago` e `efi_config` foram migradas para `empresa_configs`. Novas features devem usar `empresa_configs`.

4. **RADIUS padrao FreeRADIUS:** As tabelas `radcheck`, `radreply`, `radusergroup`, `radacct` seguem o schema padrao do FreeRADIUS. Nao altere a estrutura dessas tabelas.

5. **Variaveis MikroTik:** O HTML servido em `/api/hotspot-login/:id` usa `$(mac)`, `$(ip)`, etc. que sao substituidas pelo MikroTik, nao pelo backend.

6. **Pagamentos via banco:** Credenciais de gateway ficam em `empresa_configs.config_json`, nao em .env.

7. **VPN necessaria:** Para acessar MikroTiks atras de NAT, o campo `vpn_ip` no registro do MikroTik contem o IP WireGuard.

8. **Compliance obrigatoria:** Logs de conexao devem ser mantidos conforme Marco Civil. O job `syncConnectionLogs.js` e critico.

9. **Frontend SPA:** O build do frontend vai para `/frontend/dist/`. Em producao, servido via Nginx ou similar.

10. **Sem sistema de filas:** Jobs rodam como scripts Node.js avulsos, sem Bull/Redis/RabbitMQ.

11. **RADIUS: tempo cumulativo, NAO diario (2026-04-24).** Se for tocar em qualquer fluxo de liberacao RADIUS, use sempre `Max-All-Session` (nunca `Max-Daily-Session`) e `Simultaneous-Use=1` hardcoded. Toda nova liberacao deve fazer `DELETE FROM radacct WHERE username=?` (sem filtro de data) pra zerar o contador. O FreeRADIUS usa `sqlcounter totalcounter` com `reset=never`. Detalhes em "Modelo de Tempo: CUMULATIVO" acima. NUNCA voltar pro modelo daily sem revisar todos os 5 controllers: `mikrotikAPIController`, `radiusController`, `lgpdController`, `leadController`, `loginPortalController`.

12. **`shared_users` do plano e' LIDO mas nao USADO (2026-04-24).** Campo continua em `SELECT` em varios lugares por compatibilidade, mas o valor e ignorado — `Simultaneous-Use` e sempre `1`. Se voltar a usar, revisar os 5 controllers acima.

---

## Portais de cadastro em 2 passos (CPF + nascimento primeiro)

`CadastroLGPD.jsx` (`/cadastro`), `CadastroLead.jsx` (`/lead`) e `CadastroCliente.jsx` (`/cadastro-cliente`, portal Planos; nome/e-mail/telefone sempre obrigatorios, data de nascimento obrigatoria) mostram so CPF + data de nascimento (`components/public/BuscaCpf.jsx`, botao "Continuar"); o restante do formulario (nome, e-mail, telefone, MAC/IP, aceite, botao final) so aparece depois da busca (`POST /api/lgpd/consulta-cpf`): achou + "Sim, sou eu" = formulario preenchido (nome, telefone e e-mail via `confirmar:true`); nao achou/erro = formulario em branco; 429 = nao libera. Mudar CPF ou data esconde o restante e limpa os dados trazidos de outro cadastro. Lead sem CPF (`exibir_cpf=false`) mostra tudo direto. As regras de titularidade (`conferirDataNascimento`, reivindicacao, re-liberacao) continuam todas no servidor (`lgpdLogin`/`leadLogin`).

---

## Sessao simultanea: desconectar o outro aparelho

`Simultaneous-Use=1` faz o FreeRADIUS recusar o login de quem ja esta conectado em outro aparelho (o MikroTik nao explica o motivo). Nos portais LGPD, Lead e Planos (`CadastroLGPD.jsx`, `CadastroLead.jsx`, `CadastroCliente.jsx` — neste, no auto-login do `cadastroCliente` com plano ativo), na reconexao com saldo, `utils/sessaoAtiva.tratarSessaoAtiva` olha o `radacct` aberto do username (ignora sessoes sem update ha >15 min, restrito a empresa): **mesmo MAC** = sessao velha, desconecta sozinho **somente se o titular foi verificado** (`tratarSessaoAtiva({ autorizado: true })`, so nos ramos de reconexao com saldo, onde a data de nascimento ja foi conferida) — o MAC vem do corpo da requisicao e e' visivel no ar, entao quem sabe CPF + MAC do titular nao pode derrubar a sessao dele por re-liberacao/cadastro; sem `autorizado` o resultado e' o aviso `requer_desconexao` e a derrubada passa por `desconectar-anterior` (CPF + data); **outro MAC** = a resposta traz `requer_desconexao:true` + `sessao_ativa` (so os 2 ultimos bytes do MAC) e o portal mostra `SessaoAtivaAviso.jsx` ("Desconectar o outro e conectar aqui" / "Cancelar"). A confirmacao chama `POST /api/sessao/desconectar-anterior` (publico, `cpfLookupLimiters`): exige CPF + data de nascimento com `conferirDataNascimento === 'ok'` (nunca `reivindicado`/`ausente`), empresa vinda do `mikrotik_id` e username do proprio titular (CPF ou telefone/e-mail/MAC do lead). `desconectarSessao`: Disconnect-Request via `radclient` (`coa.desconectarSessaoCoA`, porta 3799) -> fallback API do MikroTik (so `/ip/hotspot/active` do usuario) -> espera o Accounting-Stop (4 s) e, se nao chegar, fecha a linha (`Admin-Reset`). **Nunca apaga radcheck/radreply/radius_users** (o saldo continua). Sem metodo que funcione (ex.: Omada External RADIUS, Grandstream) = `ok:false` e a linha NAO e fechada. **PIX/cartao (`Pagamento.jsx`):** as respostas `approved` de `gerarPagamentoCartao` e do polling `verificarStatusPagamento` trazem `tratarSessaoAtiva({..., manterMesmoAparelho:true})` (a sessao do MESMO aparelho, ex. trial com upgrade por CoA, NAO e derrubada; so outro aparelho pede decisao) e o portal mostra o aviso no lugar do redirect (polling para). A data de nascimento vem de `sessionStorage` `hs_dn_<cliente_id>` (gravada por `CadastroCliente.jsx`); sem ela o aviso pede a data. Como o acesso pago nao e' gratis e o aparelho novo nunca o usou, `desconectar-anterior` aceita tambem `sessaoAtiva.pagamentoRecenteDoAparelho` (pagamento `approved` do mesmo CPF+MAC liberado ha <30 min). **`LoginHotspot.jsx` (usuario + senha):** `loginPortalController.login` tambem traz `tratarSessaoAtiva` e a tela mostra o aviso em `modoSenha`; como la nao ha CPF/data, `desconectar-anterior` ganha o modo `{ username, password, mac, mikrotik_id }` (`desconectarPorSenha`) com a MESMA prova do login (senha do radcheck, `loginTentativas`, senha legada so em aparelho que ja usou o acesso, acesso da mesma empresa do equipamento; 401 generico). **pix-trial (acesso gratis ao copiar PIX):** `liberarPixTrial` checa `tratarSessaoAtiva({..., manterMesmoAparelho:true})` ANTES de `gerarAcessoTemporario` (que apaga e regrava o radcheck do CPF); com o acesso aberto em outro aparelho responde `{ ok:false, requer_desconexao:true, sessao_ativa, username }` SEM gravar nada (nem `trial_liberado_em`), o `Pagamento.jsx` mostra o aviso (`aoDesconectar` refaz o pedido do trial depois de `desconectar-anterior`; sem CPF+data confirmados ou prova valida o endpoint responde 403). Testes: `backend/tests/unit/pixTrial.test.js`. Testes: `backend/tests/unit/sessaoAtiva.test.js`. Nao testado contra um MikroTik real (so mocks).

---

## Cadastro completo de clientes e importacao (SGP / planilha)

Tela `Clientes` (`frontend/src/pages/admin/Leads.jsx`, rota `/admin/:slug/leads`) edita o cadastro completo em `leads`. Importacao em `/admin/:slug/importar-clientes` (`ImportarClientes.jsx`), API `/api/clientes-import` (permissao do modulo `leads`).

- **Cadastro manual (tela Clientes) exige Nome, CPF (PF) ou CNPJ (PJ), E-mail, Data de nascimento e Telefone** (`utils/cadastroObrigatorio.js`, validado no front e em `leadController.criarLead/atualizarLead`; edicao que so troca `status`/`observacoes` nao exige). A importacao em massa e os portais NAO passam por essa regra.
- **Acoes em massa (tela Clientes):** checkbox por linha + "selecionar todos" (so a lista carregada; limpa ao mudar filtro/busca) e barra com Alterar status, Nao quer promocoes / Voltar a receber e Excluir selecionados. API `PUT /api/leads/massa` `{ids, status?|whatsapp_optout?}` (permissao `editar`) e `DELETE /api/leads/massa` `{ids}` (permissao `excluir`), ate 1000 ids inteiros por chamada, sempre `WHERE empresa_id = ? AND id IN (...)` (`leadController.atualizarLeadsEmMassa/deletarLeadsEmMassa`, rotas antes de `/:id`). Teste: `backend/tests/unit/leadsMassa.test.js`.
- Logica: `backend/src/utils/importCadastros.js` (mapeamento, normalizacao, `processarImportacao`, parse CSV/XLSX) e `backend/src/utils/sgpClient.js` (config por empresa em `empresa_configs` tipo `sgp`; `testar`, `amostra` mascarada, `buscarTodos`).
- **Integracao SGP fica em Configuracoes > Integracoes > SGP** (`Integracoes.jsx`, `IntegracaoSgp.jsx`; rotas `/admin/:slug/integracoes[/sgp]`), API `/api/integracoes/sgp/{,testar,amostra,importar}` (modulo `configuracoes`; controller `integracaoController.js`). Fluxo da tela: salvar -> testar conexao (HTTP + campos recebidos + mapeamento) -> ver amostra mascarada -> simular -> importar. A aba SGP de *Importar clientes* so aponta para la.
- **CPF/CNPJ existente: so preenche campos vazios** (`COALESCE(NULLIF(col,''), ?)`); nunca toca `lgpd_aceite`/`lgpd_termo`/`status`/CPF. Importados entram com `origem='importacao'`, `lgpd_aceite=0`.
- Importar `data_nascimento` torna o lead localizavel por CPF+data em `/api/lgpd/consulta-cpf`.
- **SGP:** o endpoint padrao (`/api/ura/clientes/`) e o formato da resposta NAO foram validados contra um SGP real (so contra um SGP simulado em `sgpIntegracao.test.js`); o cliente aceita a lista em `clientes|results|data|items` e achata objetos aninhados. Ajustar o campo "Endpoint" na tela se a versao do SGP for diferente. A URL e validada contra destinos internos (SSRF) no controller; erros do SGP viram mensagens seguras (`SgpError`), sem app/token.
- Testes: `backend/tests/unit/importCadastros.test.js`, `backend/tests/unit/sgpIntegracao.test.js`.
- **Exportar contatos** (aba "Exportar contatos" de *Importar clientes*): `GET /api/leads/export-contatos?formato=google|outlook|vcard[&status=]` (token de download `para=leads` + recurso `exportacao`, como o `/api/leads/export`; so da empresa do tenant, ate 50000, so quem tem telefone valido e sem repetir numero; telefone sempre `+55DDDNUMERO`). `utils/exportarContatos.gerarContatos`: Google Contatos (CSV `First Name,Last Name,E-mail 1 - Type/Value,Phone 1 - Type/Value`), Outlook (CSV `First Name,Last Name,E-mail Address,Mobile Phone`) e vCard 3.0 (`.vcf`, iCloud/Android/iPhone); nome/e-mail passam pela protecao anti-formula, o telefone nao (senao viraria `'+55...`). O front baixa por `fetch` + blob (erro de plano/sessao aparece na propria tela). Registrado na auditoria como `cliente.exportar`. Teste: `backend/tests/unit/exportarContatos.test.js` (inclui ida e volta com o importador `googleContatos`).

---

## Site institucional Apex Telecom (pagina inicial)

- `/` agora e a landing page `frontend/src/pages/public/ApexHome.jsx` (planos de EXEMPLO na constante `PLANOS`, WhatsApp/contatos placeholders); o login admin passou para `/login`. Todo redirect de "nao autenticado" aponta para `/login`.
- (Legado) Pedido de contratacao: `POST /api/site/pedido` (`siteController.criarPedido`, limiter `sitePedidoLimiter` 10/h por IP, honeypot `website`). Grava em `leads` com `origem='site'`, endereco (migration 029), `lgpd_termo` via `resolverTextoLgpd` e plano em `observacoes`.
- `empresa_id` vem de `SITE_EMPRESA_ID` no `.env` (default 1), NUNCA do body. CPF ja existente so recebe nova linha em `observacoes` (nao sobrescreve cadastro de hotspot).
- Teste: `backend/tests/unit/siteController.test.js`.


---

## SaaS: assinatura por empresa

Planos do SaaS (`saas_planos`) sao os de USO DO SISTEMA — nao confundir com `planos` (hotspot). Toda empresa tem 1 linha em `assinaturas` (`trial` 7 dias na criacao via `/api/registro` ou `criarEmpresa`; `ativa` apos pagar; `vencida`; `cancelada`).

- **Bloqueio:** `middleware/assinatura.js` (`exigeAssinatura`, depois de `tenant`) responde **402** `{code:'ASSINATURA_VENCIDA'}` so no painel admin, quando vencida ALEM da carencia (`carencia_dias`, default 3). `super_admin` nunca e' bloqueado. Rotas publicas do captive portal, login, `/api/assinatura/*` e o webhook de hotspot ficam fora; o Wi-Fi dos clientes finais continua (quem decide e' o FreeRADIUS). Novas rotas admin em `server.js` TEM que incluir `exigeAssinatura`. Erro de infra/tabela ausente nao derruba o painel.
- **Estado:** `utils/assinatura.js` (`calcularEstado` puro, `obterStatus` com cache de 60s, `criarTrial`, `checarLimite`). Frontend: `AdminLayout` busca `/api/assinatura/status`, mostra banner e redireciona para `/admin/:slug/assinatura` quando bloqueada.
- **Limites por plano** (`max_equipamentos`, `max_admins`, NULL = ilimitado): checados em `POST /api/mikrotiks` e `adminController.criarAdmin` (403).
- **Cobranca (PIX Mercado Pago da PLATAFORMA):** credenciais em `plataforma_configs` (tela `/admin/:slug/planos-saas`, super admin). `POST /api/assinatura/cobranca` cria `assinatura_cobrancas` + pagamento MP com `external_reference=ass_{id}_emp_{empresa}` e `notification_url=/api/assinatura/webhook`. O webhook NAO confia no corpo: busca o pagamento no MP, confere referencia e valor, e so a transicao `aguardando->aprovada` estende `vence_em` (idempotente). O polling do front (`GET /cobranca/:id`) tambem confirma no MP se o webhook se perder. Nao reutilizar `/api/pagamentos/notificacao`. **Cartao:** `POST /api/assinatura/cartao` (`pagarCartao`, limiter 10/h) usa o mesmo pipeline server-side do hotspot (`pagamentoController.helpersMp`: BIN lookup, card_token, `/v1/payments` com `device_session_id`/`X-meli-session-id`; regras do `docs/CHECKOUT-CARTAO-MP.md`). A tela Assinatura carrega `/mp-security.js` e bloqueia o formulario ate `MP_DEVICE_SESSION_ID`. Dados do cartao nunca vao ao banco/log; a ativacao sempre passa por `sincronizarCobranca` (confere valor e referencia no MP).
- **Adicionais mensais avulsos (migration 041):** a empresa fica no plano e compra extras por cima (tela Assinatura, secao "Adicionais"). Catalogo em `saas_adicionais` (CRUD do super admin em `/admin/:slug/planos-saas`, `/api/assinatura/admin/adicionais`); empresa lista em `GET /api/assinatura/adicionais` (`disponivel`/`motivo` por empresa) e paga pelo MESMO PIX/cartao do plano: `POST /api/assinatura/cobranca` e `/cartao` aceitam `{plano_id}` ou `{adicional_id, quantidade 1-20}` ou `{renovar_adicional_id}` (`resolverItem`; valor = catalogo x quantidade, calculado no servidor). Ciclo PROPRIO de 30 dias por compra (`assinatura_adicionais.vence_em`, sem rateio; renovar estende a mesma linha a partir do maior entre agora e o vencimento); `ativarPorCobranca` continua idempotente na transicao `aguardando->aprovada`. **Limite efetivo** = limite do plano + adicionais vigentes (`utils/assinatura.obterStatus`: `max_equipamentos`/`max_admins` ja somados, `plano_max_*`, `extras`, `adicionais`; plano ilimitado continua ilimitado); `checarLimite` passa a respeitar sem mudanca; adicional vencido so deixa de somar (nao apaga equipamento/admin existente, apenas bloqueia criar mais). **Fase 1: so `equipamentos` e `admins` tem efeito**; os outros tipos (portais, whatsapp, campanhas, exportacao, sem_marca, dominio) ficam cadastrados e INATIVOS (o CRUD recusa ativa-los e a compra responde 409) ate existir bloqueio por recurso. "Disponivel a partir de" = `plano_minimo_id` comparado por `saas_planos.ordem`. A tela mostra o aviso de upgrade (`frontend/src/utils/upgradeAviso.js`: "Por R$ X a mais voce leva o plano Y" / "o plano Y custa R$ X a menos que a sua soma"); regra de preco: avulso sempre mais caro que subir de plano. Sem a migration o painel segue normal (`tabelaInexistente` tratada). Testes: `backend/tests/unit/adicionais.test.js`, `upgradeAviso.test.js`. Nao testado contra MySQL nem MP reais. Fora desta fase: pacotes de disparo de WhatsApp (consumo) e servicos pontuais.
- **Fase 2 dos adicionais: bloqueio por recurso (migration 043):** WhatsApp, Campanhas, Exportacao da base e Portais agora tem efeito. Regra: **plano inclui OU adicional vigente libera** (`utils/assinatura.obterStatus` devolve `recursos {whatsapp,campanhas,exportacao}`, `plano_recursos`, `max_portais` efetivo = plano + adicionais `portais`; `temRecurso(empresaId, nome)`). `middleware/recurso.js` (`exigeRecurso('whatsapp'|'campanhas'|'exportacao')`, depois de `tenant`): 403 `{code:'RECURSO_NAO_CONTRATADO'}`; super_admin passa; tabela/coluna ausente libera (compat); erro de banco 503. Aplicado em `/api/whatsapp`, `/api/promocoes-whatsapp`, `/api/campanhas` e `whatsapp-preview|teste` do portal (`server.js`/`portalRoutes.js`) e em `/api/leads/export` (so a exportacao de clientes; Marco Civil/LGPD e importacao continuam livres). **O captive portal nunca quebra:** `notificarLiberacao` sem recurso grava `skipped`/`sem_recurso` e libera normalmente; `campanhaAtivaInfo` sem recurso devolve null (portal abre direto, sem pre-portal); `jobs/enviaPromocoes` PAUSA a promocao de empresa sem WhatsApp. `criarPortal` checa `checarLimiteSeguro(..., 'portais')` (os 5 portais padrao contam). Adicionais liga/desliga (whatsapp/campanhas/exportacao) tem quantidade fixa 1, nao podem ser comprados se o recurso ja esta incluido (renovar so se o plano nao inclui). `sem_marca` e `dominio` seguem INATIVOS (nao existe marca "Powered by" nem infra de dominio proprio). Front: `AdminLayout` troca a tela por `RecursoBloqueado` nas rotas `/whatsapp`, `/promocoes-whatsapp`, `/campanhas*` quando `status.recursos[x] === false`; `Leads.jsx` avisa antes de exportar; `PlanosSaas.jsx` ganha checkboxes de recursos e "Max. portais"; `Assinatura.jsx` lista recursos por plano. Testes: `backend/tests/unit/recursos.test.js`. Nao testado contra MySQL real.
- **Fase 3: dominio proprio no portal (migration 046):** 4o recurso liga/desliga (`recursos.dominio`; plano `inclui_dominio` OU adicional `dominio`). A empresa cadastra em `/admin/:slug/dominio` (`DominioProprio.jsx`, API `/api/dominio`, `exigeRecurso('dominio')`, `dominioLimiter`): salvar (`pendente`) -> verificar DNS (`dns_ok`: CNAME para `SYSTEM_DOMAIN` ou A com o mesmo IP) -> ativar (`utils/dominioPortal`: `certbot certonly --webroot` + vhost 443 renderizado de `infra/nginx/dominio-portal.conf.tpl` em `/etc/nginx/conf.d/hotspot-dominio-<host>.conf`, `nginx -t` ANTES do reload e rollback do arquivo se falhar). **O backend roda como root e executa `certbot`/`nginx` via `execFile` (sem shell, host validado por `validarDominio`, 1 emissao por vez, timeout 120 s).** Precisa de `SSL_EMAIL` no `backend/.env`, portas 80/443 publicas e modo VPS (`DOMINIO_AUTOMATICO=0` desliga a ativacao; no modo Traefik nao ha como). So vale no PORTAL do cliente final: `portalHostDaEmpresa` (cache 60 s) devolve o dominio da empresa so se `ativo` E o recurso ainda existe (senao cai para `SYSTEM_DOMAIN`, o cert fica no servidor) e e' usado em `/api/hotspot-login` (redirect dentro do `login.html`; o roteador continua BAIXANDO o arquivo da plataforma) e no walled garden (`configurarHotspot(..., portalHost)` libera os DOIS dominios). **Continuam na plataforma:** painel admin, `/api/assinatura/*`, `notification_url` do Mercado Pago (`baseUrlPublica`). `middleware/hostPortal.js` responde 404 a `POST /api/auth/login`, `/api/admin/login` e `/api/registro` quando o Host nao e o da plataforma, e o vhost devolve 404 para `/admin`, `/super`, `/login`, `/registro`. Roteadores ja configurados precisam do "Enviar hotspot" de novo (e Omada/UniFi/Grandstream trocar a URL do portal externo a mao). `sem_marca` e o unico adicional ainda inativo. **Automatico na ativacao (sem editar o nginx a mao):** `garantirDesafioHttp` cria `conf.d/hotspot-acme-<host>.conf` (server :80 com `server_name` exato: serve `/.well-known/acme-challenge/` e redireciona o resto para https; vence o `default_server` do Certbot, cujo `return 404` negava o desafio), `garantirSnippetSeguranca` cria `snippets/hotspot-security.conf` se faltar (servidores instalados antes do hardening) e o vhost 443 devolve 404 na raiz `/` (a landing da plataforma nao aparece no dominio do cliente; o portal abre por `/hotspot/redirect/<id>`); o erro de emissao traduz o ultimo `Detail:` do log do certbot (porta 80, 404, DNS, limite). Dominio ja ativo: clicar "Reemitir HTTPS" regenera o vhost. Teste: `backend/tests/unit/dominioPortal.test.js`. Nao testado contra certbot/nginx/DNS reais (so mocks): validar no servidor com um subdominio de teste.
- **Dono da plataforma (migration 042):** Planos SaaS (planos, adicionais, MP da plataforma), Assinatura das empresas (`/api/assinatura/admin/*`), Empresas, Atualizar/Backups/Logs do sistema so valem para super admin com `admins.dono_plataforma = 1`. Middleware `exigeDonoPlataforma` (depois de `auth`; `utils/donoPlataforma.js`, conferido no BANCO a cada request com cache de 60 s, nunca pelo JWT). **Rede de seguranca:** se nenhum super admin tem a flag (ou a coluna ainda nao existe) todo super admin segue valendo como dono. `GET /api/plataforma/eu` (qualquer logado) alimenta o front (`donoPlataforma` no AuthContext, `RotaDono` em `App.jsx`); `GET/PUT /api/plataforma/donos[/:id]` (so dono) gerem o perfil na tela Planos SaaS ("Donos da plataforma"); nao remove o ultimo dono e so aceita alvo super_admin. Toda nova rota de plataforma TEM que usar o middleware. **`routes/updatePublishRoutes.js` neste repo e' so um stub:** o arquivo real do servidor mestre precisa usar `exigeDonoPlataforma` tambem (o front ja esconde `/super/*`). Teste: `backend/tests/unit/donoPlataforma.test.js`. Nao testado contra MySQL real.
- **Super admin:** `Empresas` mostra status/vencimento e botao "Assinatura" (plano, status, estender dias); `/admin/:slug/planos-saas` = CRUD de planos + config MP.
- **Job** `src/jobs/verificaAssinaturas.js` (cron horario): marca vencidas e avisa por WhatsApp (D-3 e vencimento) usando a instancia da empresa `SITE_EMPRESA_ID`.
- Landing `/` lista os planos de `GET /api/assinatura/planos` e leva a `/registro?plano=<id>`.
- Testes: `backend/tests/unit/assinatura.test.js`. Nao testado contra MySQL nem MP reais.

---

## Perfis de usuario (Administrador / Usuário Padrão)

Perfil = grupo de permissao (`grupos_permissao`, tabela GLOBAL sem `empresa_id`; so o super admin gere grupos customizados em `/api/grupos-permissao`). Donos de empresa escolhem apenas entre os 2 perfis do sistema, definidos em `backend/src/utils/perfis.js`:

- **Administrador** = grupo `Acesso Completo` (migration 018): todos os modulos, inclusive Usuarios e Configuracoes. Role padrao `owner`.
- **Usuário Padrão**: operacional — Dashboard (ver) e Clientes/Leads/Radius/Pagamentos/Sessoes/Logs de sessoes (ver/criar/editar, sem excluir); sem Equipamentos, VPN, Portais, Planos, Compliance, Configuracoes e Usuarios. Role padrao `operator`.
- `checkPermissao` e' deny-by-default: **todo caminho que cria admin TEM que chamar `atribuirPerfil`** (e vincular em `admin_empresas`, que o login exige). Feito em `adminController.criarAdmin`, `registroController.registrarEmpresa` e `empresaController.vincularAdmin` (primeiro admin da empresa). Sem isso o admin loga mas toma 403 em tudo.
- **Primeiro usuario da empresa e' SEMPRE Administrador/owner** (`criarAdmin` forca, mesmo pedindo `padrao`). `perfil` Administrador so e' concedido por owner/super_admin. A empresa nunca fica sem Administrador (nao rebaixa nem remove o ultimo).
- API: `GET /api/admins/perfis` (so os 2 perfis), `perfil` no `POST/PUT /api/admins`, `GET /api/admins` devolve `perfil` por admin. Tela: `Usuarios.jsx` (Nome + Perfil).
- `garantirPerfil` nunca sobrescreve permissao ja ajustada pelo super admin; `atribuirPerfil` so troca entre os 2 grupos do sistema (grupos customizados ficam). Testes: `backend/tests/unit/perfisUsuario.test.js`. Nao testado contra MySQL real.

---

## Cadastro de empresa pelo CNPJ

`GET /api/cnpj/:cnpj` (publico, `cnpjLookupLimiter` 60/h por IP, `routes/cnpjRoutes.js`) valida os digitos (`utils/cnpjClient.validarCNPJ`), consulta a BrasilAPI e devolve razao social, nome fantasia, e-mail, telefone e endereco normalizados; erros viram mensagens seguras (400/404/502/503). So le dado publico, nao grava. Usado pelo componente `CamposEmpresa.jsx` em `/registro` e no modal da tela Empresas (busca ao completar 14 digitos ou no botao "Buscar"; os campos continuam editaveis). `registroController`/`empresaController` gravam os campos novos via `utils/empresaCadastro.sanitizarEmpresa` (CNPJ so digitos, CNPJ/telefone/CEP/UF invalidos => 400). A BrasilAPI so foi testada com mock (`tests/unit/cnpj.test.js`); o servidor precisa de saida HTTPS para `brasilapi.com.br`. **CNPJ unico:** `registrarEmpresa`, `criarEmpresa` e `atualizarEmpresa` recusam com 409 (`Já existe uma empresa cadastrada com este CNPJ`) quando outra empresa tem o mesmo CNPJ (`empresaCadastro.cnpjDuplicado`, compara so os digitos; a propria empresa pode salvar). Nao ha indice UNIQUE no banco (cadastros antigos podem ter duplicatas).

---

## Identidade do site (logo e nome da plataforma)

Global (nao por empresa), editavel so pelo super admin em Configuracoes > "Identidade do site". Guardado em `plataforma_configs` chave `branding` (`{nome, logo_url}`; padrao "Apex Telecom" + logo SVG `LogoApex.jsx`). API: `GET /api/branding` (publica), `PUT /api/branding`, `POST/DELETE /api/branding/logo` (super_admin; JPG/PNG/WEBP 2 MB, SVG bloqueado; arquivos `site-*` em `uploads/logos`). Frontend: hook `useBranding` (cache em modulo) usado por `MarcaApex`, `Login`, `ApexHome`. **Tamanho da logo por local:** `branding.tamanhos = {site, login, painel}` com presets `p|m|g|xg` (alturas 32/44/60/80 px em `hooks/useBranding.js` `ALTURAS`; padrao site=m, login=g, painel=m); `PUT /api/branding` aceita `{nome?, tamanhos?}` e valida os presets; a barra lateral do painel (e o cabecalho mobile) mostra a identidade da PROPRIA empresa e, enquanto ela nao enviar a sua, a logo da plataforma (ver secao Identidade por empresa); no tema escuro a logo enviada fica sem fundo e ganha um halo branco fino (`img.logo-enviada` em `index.css`); `MarcaApex` recebe `local` e so afeta a logo ENVIADA (a logo SVG padrao tem tamanho fixo); escolha na tela Configuracoes. **Favicon e icone do iPhone** (mesmo registro `branding`: `favicon_url`, `apple_icon_url`; sem migration): `POST/DELETE /api/branding/favicon` (PNG/ICO/WEBP, 512 KB) e `/api/branding/apple-icon` (so PNG, 1 MB; iOS nao aceita SVG/WEBP), campo `arquivo`, arquivos `favicon-*`/`apple-*` em `uploads/logos`, assinatura (magic bytes, `campanhaValidacao.assinaturaConfere`) conferida alem do mimetype. A tela converte QUALQUER imagem escolhida (PNG/JPG/WEBP/ICO/SVG) para PNG quadrado no navegador (canvas, `paraPng` em `IdentidadeSite.jsx`): favicon 48x48 com transparencia, iPhone 180x180 com fundo branco e margem de 10% (iOS nao aceita transparencia); o servidor so recebe o PNG ja convertido. O `index.html` e' estatico: `useBranding` ajusta `<link rel="icon">` e `<link rel="apple-touch-icon">` em runtime (sem icone do iPhone usa o favicon se for PNG). O iPhone guarda o icone antigo: refazer "Adicionar a Tela de Inicio". Teste: `backend/tests/unit/branding.test.js`. O teste `registro publico: dono vira owner...` ja falhava na `main` antes desta mudanca.

---

## Padroes do hotspot (todo equipamento MikroTik)

Constantes em `backend/src/constants/hotspotDefaults.js` (`HOTSPOT_PADROES`), aplicadas por `configurarHotspot` (assistente "Enviar hotspot": novos equipamentos e reenvio) e por `aplicarPadroesHotspot` (botao "Aplicar padroes em todos" na tela Equipamentos, `POST /api/mikrotiks/aplicar-padroes`, percorre os MikroTik da empresa; um offline nao impede os outros):
- **user profile `default`: `keepalive-timeout=30m`, `idle-timeout=none`** — o padrao de fabrica (2 min) derrubava o cliente quando o celular apagava a tela (`Lost-Service` no radacct). Ressalva: aparelho que sai do alcance mantem a sessao aberta ate 30 min, contando na franquia, e o `Simultaneous-Use=1` pode recusar outro aparelho nesse intervalo.
- **hotspot profile `hsprof-hotspot`: `radius-interim-update=5m`** — com `received` o roteador so manda atualizacao se o servidor pedir; se o Accounting-Start se perder a sessao nao aparece em Sessoes Ativas. O FreeRADIUS cria a linha do radacct na primeira atualizacao.
- **cliente RADIUS: `timeout=3s`** (era 1s100ms), mais tolerancia ao primeiro pacote pela VPN.
- **cliente RADIUS: `require-message-auth=no`** (RouterOS 7.15+ descarta o Access-Accept do FreeRADIUS sem Message-Authenticator; no v6 o parametro nao existe e o erro e' ignorado).
- **hotspot server: `addresses-per-mac=1`**; DHCP novo com `lease-time=1h` e `authoritative=after-2sec-delay`; `ip-binding` bypassed para o IP do gateway.
- **mac-cookie 1 h:** hotspot profile `login-by=http-chap,http-pap,mac-cookie` e user profile `default` com `add-mac-cookie=yes` + `mac-cookie-timeout=1h` (`HOTSPOT_PADROES.loginBy/macCookieTimeout`; assistente e "Aplicar padroes em todos"). Aparelho que volta em ate 1 h reconecta sozinho, sem passar pelo portal (nao ve campanhas pre-portal nem cadastro nesse intervalo); o RADIUS segue decidindo (franquia, senha trocada, Simultaneous-Use => Reject => login.html/error.html). Nao validado em MikroTik real: confirmar que v6/v7 reautenticam no RADIUS pelo cookie.
- **DNS seguro (opcional, so no assistente "Enviar hotspot"):** seletor "Nao alterar / Ligar / Desligar" (`config.dnsSeguro` true/false; ausente nao mexe em nada, entao reenviar o hotspot nao desfaz sozinho). Ligar: `/ip dns` do roteador encaminha para o OpenDNS FamilyShield (`DNS_SEGURO` em `hotspotDefaults.js`, bloqueia conteudo adulto) com `allow-remote-requests=yes` e o DHCP do hotspot passa a entregar o gateway como DNS (`utils/hotspotSetup.configurarDnsSeguro`). Desligar so reverte (8.8.8.8,1.1.1.1) se o roteador estiver usando os servidores filtrados. NAO entra em "Aplicar padroes em todos". Limite: aparelho com DNS fixo ou DNS sobre HTTPS no navegador contorna o filtro. Nao testado em MikroTik real.
- **Bridge do hotspot (opcional, so no assistente "Enviar hotspot"):** checkbox "Usar uma bridge com varias portas/radios" (`config.criarBridge` + `config.portasBridge`, ate 12 nomes validos; `hotspotSetup.sanitizarBridge` normaliza o corpo). `prepararBridgeHotspot` roda ANTES do passo 0: cria `bridge-hotspot` (`BRIDGE_HOTSPOT.nome`) e adiciona as portas, e IP/pool/DHCP/hotspot server passam a usar a bridge; o SSID vale para todo radio wlan*/wifi* marcado e os radios legados ganham `default-forwarding=no`. Recusa (e nao escreve nada) porta inexistente, que nao seja ether/wlan/wifi, WAN, de OUTRA bridge, com IP ou com DHCP server proprio (entrar na bridge invalidaria o IP e pode derrubar o acesso). Idempotente; se a preparacao falha o envio para (nao segue sem a bridge). Nao remove a bridge nem move porta que ja tem IP. Pacote `wifi` do v7: a porta entra na bridge mas o SSID continua manual (aviso). Nao testado em MikroTik real.
- **Rede do hotspot /24, /23 ou /22 (assistente "Enviar hotspot"):** seletor "Tamanho da rede" (Pequena /24 ~250, Media /23 ~500, Grande /22 ~1000 clientes; campos de IP e pool continuam editaveis). `utils/redeHotspot.js` (`calcularRede`, `validarPool`, `redesSobrepoem`) calcula a rede de verdade (antes o assistente assumia /24 alinhado e errava /23 e /22: `network` do DHCP e a regra de masquerade saiam desalinhados). Prefixo aceito /16 a /29; sem `poolRange` o pool cobre a rede toda menos o gateway. Rede/pool invalidos (pool fora da rede, contendo o gateway, IP invalido) param ANTES de conectar; rede que se sobrepoe a de OUTRA interface do roteador e' recusada (passo 0d). Equipamento ja configurado em /24 nao muda sozinho: reenviar o hotspot com outra faixa nao remove o IP/pool/DHCP antigos (ajuste manual). Nao testado em MikroTik real.
- **on-logout (opcional, so no assistente "Enviar hotspot"):** seletor "Derrubar o aparelho do Wi-Fi ao fim da sessao" (Nao alterar / Ligar / Desligar; `config.onLogout` true/false, ausente nao mexe; NAO entra em "Aplicar padroes em todos"). `hotspotSetup.configurarOnLogout` grava no user profile `default` o script de `hotspotDefaults.scriptOnLogout()` (marcador `# apex-on-logout`): espera 5 s e SO age se o MAC nao tiver sessao ativa em `/ip hotspot active` (re-login legitimo, ex. trial PIX -> pago ou `desconectar-anterior` do mesmo aparelho, nao derruba o cliente); remove so o lease DHCP `dynamic=yes` com o IP+MAC da sessao e a entrada na registration-table (`/interface wireless` e `/interface wifi`, em `:do on-error`). **Nunca sobrescreve um on-logout alheio**: so grava se vazio ou nosso; leitura que falha/expira = aviso sem escrever; desligar so limpa o nosso. Nao depende de `$cause`. Nao validado em MikroTik real (so mocks): testar em 1 equipamento (franquia acaba e o celular reabre o portal; pagar durante o trial PIX nao pode derrubar; sair do alcance 30 min e voltar).
- **BlockRedirect (opcional, so no assistente "Enviar hotspot"):** seletor "Forcar o pop-up do portal" (Nao alterar / Ligar / Desligar; `config.blockRedirect` true/false, ausente nao mexe; NAO entra em "Aplicar padroes em todos"). `hotspotSetup.configurarBlockRedirect` cria regras `deny` no walled garden (comentario `apex-blockredirect`) para os hosts de teste de conexao de `hotspotDefaults.BLOCK_REDIRECT` (captive.apple.com, connectivitycheck.gstatic.com, www.msftconnecttest.com etc.); `deny` = continua redirecionando ao portal. Hoje esses hosts ja redirecionam por padrao (nao estao no walled garden), entao o ganho e proteger o pop-up contra wildcards liberados depois. Idempotente; desligar remove SO regras com o nosso comentario; nunca toca regras alheias; erro de leitura/escrita = aviso. **`trial-uptime-limit` do MikroTik NAO foi adotado** (daria internet gratis fora do RADIUS e furaria o modelo cumulativo e o PIX trial). Nao validado em MikroTik real: ligar em 1 equipamento e conferir o pop-up no Android e no iPhone. Do plano do Wifi Manager resta so o log de conexoes por mangle (nao recomendado).
- **`error.html`** baixado de `GET /api/hotspot-erro/:mikrotikId` (passo 9b do assistente): login recusado/franquia esgotada leva o cliente de volta ao portal. Ideia vinda da analise do script Wifi Manager; itens do plano concluidos.
Perfis de usuario customizados (grupos diferentes de `default`) nao sao alterados. Nao testado contra MikroTik real (so mocks). Teste: `backend/tests/unit/hotspotDefaults.test.js`.

**Conta do roteador no script de instalacao rapida:** `ROUTER_ADMIN_USER` (default `admin`) e `ROUTER_ADMIN_PASSWORD` no `backend/.env`. Com `admin` o script so troca a senha; com outro nome (ex.: `painel`) `utils/roteadorAdmin.linhasUsuarioRoteador` cria a conta se faltar (`group=full`, `address=10.8.0.0/24`, idempotente) e avisa para trocar a senha do `admin` a mao (o `admin` nao e' desativado). Cadastre o equipamento no painel com esse usuario. A senha ainda e' unica para todos os roteadores. Teste: `backend/tests/unit/roteadorAdmin.test.js`.

**Visual (azul claro + branco):** tokens `apex-*` em `frontend/tailwind.config.js` (50..900, principal `apex-500`); landing/login/registro claros, CTA laranja. A sidebar e o cabecalho mobile do `AdminLayout` sao claros, mas a area de conteudo das paginas do painel continua escura (migracao pendente). `MarcaApex`/`LogoApex` aceitam `tema` ("escuro" = texto escuro p/ fundo claro; "claro" = texto branco).

**Wi-Fi no assistente:** se a interface escolhida for Wi-Fi (`wlan*`/`wifi*`) e o campo "Nome do Wi-Fi (SSID)" vier preenchido, `configurarWifiAP` poe o rádio em `ap-bridge` com esse SSID, `security-profile=default` e `disabled=no` (pacote wireless legado; no pacote `wifi` novo vira aviso). Vazio = nao mexe no radio. O script de provisionamento da VPN (`wireguardController`) ja configura o Wi-Fi do roteador no primeiro uso; este passo serve para equipamentos provisionados de outro jeito ou para trocar o nome depois. Nao testado contra MikroTik real (so mocks).

**Tema claro/escuro:** botao `ToggleTema` (SiteHeader e sidebar do painel), hook `hooks/useTema.js`, `localStorage.tema`, `<html data-theme="claro|escuro">` (padrao claro). Site/login/registro/sidebar usam a classe `tema-site` e o tema escuro e' um remapeamento por CSS em `frontend/src/index.css`; o conteudo do painel (classes escuras fixas) fica sob `.painel` e e' remapeado para claro em `[data-theme="claro"] .painel`. Cobertura ampliada (fundos/bordas/textos escuros slate, gray-900, tintas -900/30, hovers, text-gray-100 etc.) e `bg-gray-9*` nao e mais excecao do `text-white`. Pagina nova do painel que use cor fora dessas listas precisa de regra nesse bloco (ou fica ilegivel no claro). Paginas do captive portal nao sao afetadas. **Super Admin:** as paginas `/super/*` (Dashboard, Empresas, Painel da empresa, Atualizar Sistema, Backups) usam a raiz `super-pagina painel` (reaproveita o remapeamento claro do `.painel`) e tem o `ToggleTema` no cabecalho; padrao claro, escuro pelo botao.

**Responsividade (celular):** `AdminLayout` abre a gaveta so em `lg+` (fechada por padrao no celular e fecha ao navegar; sombra so quando aberta); o wrapper de conteudo e o `main` tem `min-w-0` (sem isso qualquer tabela/grid largo estica a pagina). Abaixo de 1024 px o CSS global (`index.css`) faz toda `.painel table` rolar na horizontal (`display:block; overflow-x:auto`), `code` quebra linha e `pre` rola. Cabecalhos de pagina e barras de botoes usam `flex-wrap gap-*`; input em linha com botao precisa de `min-w-0`. **Tabelas do painel viram cartoes abaixo de 768 px de forma automatica:** `hooks/useTabelasMobile.js` (montado no `AdminLayout`, `MutationObserver`) copia o texto de cada `<th>` para o `data-label` dos `<td>` da mesma coluna e o CSS de `index.css` (`@media (max-width: 767px)`) mostra cada `<tr>` como cartao com o rotulo ao lado do valor; entre 768 e 1023 px a tabela rola na horizontal. Tabela nova so precisa de `<thead>` com `<th>`; `data-sem-cartoes` na `<table>` mantem a rolagem horizontal. **Modais:** abaixo de 768 px todo overlay `fixed inset-0 z-50` ganha margem, o dialogo (1o filho) ocupa a largura, limita a altura a `100dvh` e rola por dentro, e `grid-cols-2/3` viram 1 coluna (`.sempre-2-colunas` para opt-out); modal novo deve seguir o padrao `fixed inset-0 ... z-50` com o dialogo como filho direto. Equipamentos (`Mikrotiks.jsx`) e VPN (`Wireguard.jsx`) mostram cartoes abaixo de `md` (tabela so em `md+`; acoes em `renderAcoes`). Verificar com Playwright em 320/360/390/768 px (`scrollWidth <= innerWidth`) ao criar pagina nova do painel.

---

## Campanhas (pre-portal com imagens/videos)

Menu lateral: "Campanhas" fica dentro do submenu **Marketing** (`marketing_group` no `AdminLayout.jsx`; o filho usa a chave de permissao `portais` (mesma da API `/api/campanhas`; `campanhas` NAO e' modulo de permissao e escondia o item de quem nao e super admin); "Promocoes WhatsApp" tambem fica nesse submenu (chave `configuracoes`); a rota `/admin/:slug/campanhas` nao mudou). Slides (imagem/video) mostrados antes do portal: `portais.campanha_ativa_id` -> `/campanha/:portalId` (`CampanhaPlayer.jsx`). Admin em `/admin/:slug/campanhas` (`Campanhas.jsx`, `CampanhaEditor.jsx`), API `/api/campanhas` (modulo `portais`), publico `/api/public/campanha/:portalId` (+ `/view`). Uploads em `backend/uploads/campanhas/<empresa>/<campanha>/`.
- **Campanha utilizavel = `ativo=1` e >= 1 item** (`utils/campanhaAtiva.js`): so assim o redirect do hotspot (`server.js`, `/hotspot/redirect`) manda para `/campanha/...` e so assim o `vincularCampanha` aceita vincular (inativa/sem itens = 400); `registrarView` ignora campanha inutilizavel.
- Validacoes em `utils/campanhaValidacao.js`: duracao inteira 1-60 s, `link_destino` so `http(s)://` (nunca `javascript:`), nome/titulo <= 150, assinatura (magic bytes) do arquivo conferida alem do mimetype. `PUT` da campanha/item so altera os campos enviados e campo vazio LIMPA (sem COALESCE).
- Upload: `validarCampanhaDoUpload` (campanha da empresa) roda ANTES do multer (sem arquivo/pasta orfaos); `receberArquivo` traduz erros do multer (tamanho => 413). Excluir campanha em uso por portal responde 409 com a lista (`?forcar=1` confirma); banco e apagado antes dos arquivos.
- **Editor (`CampanhaEditor.jsx`)**: edita titulo, duracao (1-60 s; video avanca quando termina) e link de cada item (`PUT /api/campanhas/:id/itens/:itemId`, so o que mudou), nome/descricao da campanha, arrastar para reordenar (alem de ↑↓), upload de varios arquivos com progresso (XHR) e erros inline (sem `alert`). "Visualizar" abre `/campanha/0?preview=1&campanha=<id>`: o `CampanhaPlayer` le a campanha pela API do admin (token do `localStorage`; funciona com campanha inativa/nao vinculada), mostra o selo "Pre-visualizacao" e nao conta view nem redireciona. A lista mostra "Em uso em" (`portais_em_uso`) e a exclusao confirma o uso (409 -> `?forcar=1`). Na lista, "Editar" abre o modal com nome, descricao e agendamento/frequencia (`PUT /api/campanhas/:id`) e "Itens" leva ao editor de imagens/videos e resultados.
- **Metricas** (migration 038, `campanha_metricas`): o player manda `{ sessao }` (id aleatorio em `sessionStorage` `camp_sessao`) em `POST /api/public/campanha/:portalId/view` (campanha aberta; sem `item_id`) e com `item_id` quando cada slide aparece, e `POST .../clique` (`{ item_id, sessao }`, fetch `keepalive`) no botao "Saiba mais". So conta campanha utilizavel do portal, item validado contra a campanha, 1 por sessao+item a cada 30 min (`utils/dedupeTtl.js`, em memoria: zera no restart) e `campanhaMetricaLimiter` (300/min por IP). Sem sessao valida cai no IP. Preview do painel nao conta. `item_id = 0` = total da campanha (`campanhas.views` continua somando a view da campanha por compatibilidade); sem FK em `item_id` (historico sobrevive a exclusao do item). Admin: `GET /api/campanhas/:id/metricas?de=&ate=` (AAAA-MM-DD, ate 366 dias, padrao 30) devolve `resumo`, `por_dia`, `por_item` (com % de clique); aba "Resultados" do editor (`CampanhaResultados.jsx`). Os numeros comecam do zero na atualizacao.
- Testes: `backend/tests/unit/campanhaValidacao.test.js`, `campanhasController.test.js`, `campanhasMetricas.test.js`, `dedupeTtl.test.js` (os scripts de `backend/tests/campanhas/` sao de integracao com MySQL real e nao entram no `npm test`).
- **Agendamento e frequencia** (colunas da 038): `campanhas.data_inicio`/`data_fim` (DATE, NULL = sem limite, inclusivas) e `frequencia` ('sempre'|'sessao'|'diaria'). `utils/campanhaAtiva.campanhaAtivaInfo` aplica a janela (`CURDATE()`) e devolve `{id, frequencia}`; fora da janela a campanha nao redireciona, nao e servida pela rota publica e nao conta metrica (vincular ao portal continua permitido, para agendar). Com `sessao`/`diaria` o player grava o cookie `cv_<campanhaId>` (sessao = cookie de sessao, diaria = 24 h) ao terminar e `/hotspot/redirect` (`campanhaJaVista`) pula a campanha enquanto ele existir; `sempre` nao grava. Datas e frequencia validadas em `campanhaValidacao` (`validarData`, `validarJanela` com o que ja estava gravado, `validarFrequencia`); UI em `components/admin/CamposAgenda.jsx` (modal e editor). O cookie e do navegador do cliente (limpar cookies mostra de novo; o captive portal do celular pode usar webview sem cookie persistente). Teste: `backend/tests/unit/campanhasAgenda.test.js`.

**Todos os campos obrigatorios (exceto Complemento):** `/registro` e os modais da tela Empresas (admin e super) exigem CNPJ (PJ) ou CPF (PF), razao social e nome fantasia (so PJ), CEP, endereco, numero, bairro, cidade, UF, nome, e-mail e telefone com DDD; no front via `required` do `CamposEmpresa.jsx` e, de verdade, no backend: `empresaCadastro.sanitizarEmpresa(body, { exigirCompleto: true })` responde 400 `Preencha todos os campos obrigatórios: ...` listando o que falta (usado em `registrarEmpresa`, `criarEmpresa` e `atualizarEmpresa`). Empresa antiga incompleta so salva na edicao depois de completar. Teste: `backend/tests/unit/cnpj.test.js`.

**Conta por CPF (pessoa fisica):** `/registro` e os modais de empresa (super admin / admin) tem o seletor "Empresa (CNPJ) | Pessoa fisica (CPF)" em `CamposEmpresa.jsx` (`tipo_pessoa` PJ|PF; PF mostra CPF com mascara, sem CNPJ/razao social/busca na Receita, endereco opcional; o rotulo do nome vira "Seu nome"). `empresaCadastro.sanitizarEmpresa` valida os digitos (`utils/cpf.validarCPF`, 400 `CPF inválido`), grava `cpf` so com digitos e zera `cnpj`/`razao_social`/`nome_fantasia` em PF; `cpfDuplicado` recusa com 409 (`Já existe uma conta cadastrada com este CPF`) em `registrarEmpresa`, `criarEmpresa` e `atualizarEmpresa` (a propria conta pode salvar). O CPF nao e' conferido na Receita (so digitos). Sem a migration 039 o cadastro falha (colunas ausentes). Testes: `backend/tests/unit/cnpj.test.js`.

---

## Promocoes por WhatsApp (disparo para os leads)

API `/api/promocoes-whatsapp` (permissao do modulo `configuracoes`, so Administrador): `POST /previa` (conta e mostra amostra mascarada, nao grava), `POST /` (cria envio `rascunho` e congela os destinatarios), `POST /:id/iniciar|pausar|retomar|cancelar`, `POST /teste` (manda a mensagem a 1 numero), `GET /` e `GET /:id`. `promocaoLimiter` (30/h por IP) nas operacoes de escrita.
- **Destinatarios** (`utils/promocaoWhatsapp.montarFiltroLeads`): sempre `empresa_id`, telefone preenchido, `whatsapp_optout = 0` e status diferente de `descartado`; filtros opcionais por origem, status, `lgpd_aceite` e busca. Telefone normalizado por comprimento (`normalizarTelefone`) e deduplicado (mesmo numero em 2 cadastros = 1 envio); maximo 5000 por promocao.
- **Mensagem**: modelo com `{{nome}}` (primeiro nome ou "cliente") + rodape fixo "Para nao receber mais mensagens, responda SAIR." (sempre anexado). **Nao ha webhook de resposta**: quem responder SAIR e' marcado manualmente pelo admin (`PUT /api/leads/:id { whatsapp_optout }`, que nao exige cadastro completo).
- **Fila** (`jobs/enviaPromocoes.js`, cron a cada minuto): 1 promocao por empresa por rodada, ate 4 mensagens com intervalo aleatorio de 8-20 s; so com instancia conectada (`whatsappController.instanciaConectada`), senao PAUSA a promocao. Reconfere o opt-out do lead antes de cada envio (quem saiu no meio vira `ignorado`); erro de envio vira `erro` sem travar a fila; pausar/cancelar valem na proxima mensagem; estado fica no banco (restart do PM2 nao perde). Usa `enviarMensagemEstrita` (lanca erro sem apiKey, ao contrario de `enviarMensagemDireta` que retorna sem erro) e grava `whatsapp_logs` com `contexto_tipo='promocao'`, `referencia_id` = id da promocao.
- Riscos: WhatsApp pode banir numero que dispara em massa (comecar com listas pequenas); promocao sem consentimento especifico de marketing e' risco da empresa (o filtro `lgpd_aceite` existe para isso). Nao testado contra Evolution/MySQL reais (so mocks). Testes: `backend/tests/unit/promocaoWhatsapp.test.js`, `cadastroManual.test.js` (opt-out). Tela: `frontend/src/pages/admin/PromocoesWhatsapp.jsx` (rota `/admin/:slug/promocoes-whatsapp`, menu Marketing > Promocoes WhatsApp, chave de permissao `configuracoes`): nova promocao (nome, mensagem, filtros), previa com total e exemplo, envio de teste, confirmar e enviar; detalhe com progresso (atualiza a cada 5 s), pausar/retomar/cancelar e ultimos erros. A previa e' invalidada a cada mudanca de mensagem/filtro. Em `Leads.jsx` o botao "Nao quer promocoes" / "Voltar a receber promocoes" liga/desliga o opt-out (selo "sem promocoes" no nome).

**Endereco pelo CEP:** `GET /api/cep/:cep` (publico, `cepLookupLimiter` 120/h por IP, `routes/cepRoutes.js`) valida 8 digitos (`utils/cepClient`), consulta a BrasilAPI (`/api/cep/v2`) e devolve `{cep, logradouro, bairro, cidade, uf}`; erros viram mensagens seguras (400/404/502/503). `CamposEmpresa.jsx` chama ao completar o CEP (PJ e PF) e preenche endereco, bairro, cidade e UF (so substitui o que a consulta trouxer; numero e complemento ficam). So foi testado com mock (`tests/unit/cep.test.js`); o servidor precisa de saida HTTPS para `brasilapi.com.br` (a mesma do CNPJ).


---

## Seguranca: entradas publicas (varredura 2026-10)

- `utils/entradaSegura.js`: `normalizarMac/Ip/Id/Slug/Host`, `urlHttpSegura`, `hostPermitidoGateway`. `/hotspot/redirect` e `/api/hotspot-login` so aceitam `mikrotikId` numerico e refletem `mac`/`ip` apenas em formato valido (antes: XSS refletido na origem do painel). Destino do login Omada (`browserauth`) e Grandstream (`login_url`) so vale se for o gateway cadastrado ou IP da rede local (senao a senha RADIUS iria para host do atacante); `redirect_url` so http(s). Front: `utils/urlSegura.js` antes de todo `location.href` com dado externo. `link_portal_url` e validado ao salvar o portal; o preview de portal sai com CSP `sandbox`. **Limite:** o HTML customizado servido em `/hotspot/redirect` ainda roda na origem do painel.
- `db.js` usa `stringifyObjects: true` e as rotas publicas de cadastro/login (`/api/lgpd`, `/api/lead-portal`, `/api/clientes/cadastro`, `/api/login-portal`, `/api/sessao`) passam por `middleware/somentePrimitivos` (corpo so com valores planos): um JSON `{"username":1}` no lugar de uma string virava `username = 1` em `db.query` e apagava credenciais RADIUS de todas as empresas. **Nunca remova `stringifyObjects`** e valide `typeof` de todo campo de rota publica usado em SQL. `PUT /api/wireguard/settings` (edita o docker-compose global) e so super_admin e valida porta/IPv4.

- **Segredos nunca voltam em texto puro** (`utils/segredos.js`: `mascararObjeto`, `preservarSegredos`): `GET /api/empresa-config/:tipo`, `/api/config-mercadopago`, `/api/efi`, `GET /api/mikrotiks` (senha/secret RADIUS, `api_pass`, chaves GWN) e `GET /api/whatsapp/config` devolvem o valor mascarado (`abcd...`) + `<campo>_definido`; ao salvar, valor vazio ou ainda mascarado = manter o gravado. `empresa-config` so aceita os campos conhecidos de cada tipo. A chave global `EVOLUTION_API_KEY` nao e gravada nem devolvida a empresa nenhuma; URL/chave/instancia da Evolution so o super_admin define (empresa usa sempre `empresa_<id>` no servidor global; URL propria so vale junto de chave propria). **Se a chave global ja foi exposta, rotacione `EVOLUTION_API_KEY` na Evolution e no `.env`.** `GET /api/radius/usuarios` nao devolve mais a senha. Token de download (`/api/auth/download-token?para=leads|portais`) exige permissao + assinatura do modulo, so abre a rota do proprio modulo e nao vale como sessao; `GET /api/lgpd` exige a permissao `leads`.
- **Isolamento e permissoes (varredura 2026-10):** `tenant.js` confere no banco (cache 60 s, `utils/sessaoAdmin.js`) que o admin ainda esta vinculado (`admin_empresas`) a empresa do token e que ela esta `ativo=1` (senao 401; erro de banco = 503). `assinatura.js` falha fechado (503) em erro de banco (so tabela inexistente segue). Login por `/api/auth/login` e `/api/admin/login` (agora o mesmo handler): resposta unica `Credenciais inválidas`, limite de 10 falhas/15 min por e-mail+IP (`loginPorContaLimiter`) alem do teto por IP. Ao logar/trocar para OUTRA empresa o papel e o do vinculo (`admin_empresas.role`, `roleNaEmpresa`), nao a role global. `/api/pagamentos/{aprovados,todos,liberar/:id}` exigem `checkPermissao('pagamentos')`. `nas`: todo UPDATE/DELETE e escopado por `empresa_id` (e trocar o IP de um gateway para o de um NAS existente e recusado); `portal_id` do gateway e `mikrotik_id` do plano precisam ser da empresa (400). **Rodar a migration 040** (`node migrations/040_unicos_admins_nas.js`) e corrigir duplicatas se ela avisar.
- **Pagamentos/webhooks (varredura 2026-10):** o UPDATE de aprovacao do PIX (`notificacaoWebhook`) so age em pagamento que NAO esta `approved`/`expirado` (antes, qualquer webhook repetido ou forjado com um `data.id` aprovado renovava `expira_em` e reativava pagamento vencido = acesso gratis indefinido); a aprovacao tambem exige `external_reference` (`pag_<id>_emp_<empresa>`) e valor iguais ao registro interno. `webhook_secret` continua opcional (sem ele so ha o aviso no log): **cadastre o `webhook_secret` de cada empresa** em Configuracoes. `notification_url` usa `utils/baseUrl.baseUrlPublica` (`SYSTEM_DOMAIN` ou Host sanitizado), nunca `X-Forwarded-Host` (vem do cliente). `gerarPagamento` (PIX) valida os digitos do CPF do corpo (400); o limite de 2 trials/24h do pix-trial conta por CPF **ou** MAC; `POST /api/pagamentos/gerar-cartao` tem limite proprio de falhas (10/15 min por IP e 5/15 min por MAC+CPF, `cartaoHotspotLimiters`). Logs de pagamento nao imprimem mais CPF/MAC/IP.
- **Dependencias (varredura 2026-10):** `npm audit fix` no backend (proxy-addr critico, jws, multer, mysql2, body-parser, path-to-regexp, ws, form-data, qs e outros) e no frontend (vite, postcss-selector-parser). `package.json` do backend fixa `axios ^1.20` e `overrides: { axios: "$axios" }` para que o `node-unifi` tambem use o axios atual. Restam 2 avisos moderados no `exceljs` (uuid antigo; so atinge `uuid.v3/v5/v6` com buffer, que o codigo nao usa) — corrigir exige trocar a major do exceljs. No servidor rode `npm ci` (backend e frontend) apos o pull; `mysql2` 3.24 ja nao expande objeto JSON em `= ?`, mas mantenha `stringifyObjects: true` no `db.js`.
- **Instalador (varredura 2026-10):** `install.sh` gera senha ALEATORIA para o super admin (o seed `admin123` e publico; se a troca falhar o script avisa), grava o `.env` com `chmod 600`, mantem o `package-lock.json` do frontend (`npm ci`), publica o Evolution so em `127.0.0.1:8080` (o Docker contorna o UFW) e libera RADIUS/CoA (1812/1813/3799 udp) so para a VPN (`10.8.0.0/24`; `RADIUS_ALLOW_FROM=<cidr>|any` muda; gateway com IP publico precisa de `ufw allow from <IP> to any port 1812,1813,3799 proto udp`). O nginx inclui `/etc/nginx/snippets/hotspot-security.conf` (`server_tokens off`, `X-Content-Type-Options`, `X-Frame-Options`, `Permissions-Policy`; incluido tambem nas locations com `add_header`, que descartam os herdados) e sobrescreve `X-Forwarded-Host` com o `$host` real. HSTS/CSP ficam de fora de proposito (HSTS pode quebrar o fluxo http do captive portal; a CSP do painel precisa de teste no navegador). Servidores JA instalados: aplicar a mao (trocar a senha `admin123` em Usuarios, `chmod 600 backend/.env`, bind do Evolution, regras do UFW, snippet do nginx).

---

## Vouchers (portal "Acesso por Voucher")

Portal tipo `voucher` (`/voucher`, `pages/public/Voucher.jsx`): o cliente digita um codigo e ganha o acesso do **plano** ligado ao voucher. Criado por `empresaSetup.criarPortaisPadrao` (6o portal) e, nas empresas existentes, pela migration 043.
- **Exclusivo por equipamento (migration 044):** o voucher e gerado PARA um equipamento (campo obrigatorio no modal; validado contra a empresa) e o resgate recusa (mesma mensagem 403 generica) quando o `mikrotik_id` da requisicao difere do do voucher, inclusive na reconexao; `NULL` = legado, vale em qualquer equipamento da empresa. Lista/CSV/filtro/QR usam o equipamento do VOUCHER (nao mais o do plano). Limite: a trava e no portal; o usuario/senha `voucher_<codigo>` ja emitido continua existindo no RADIUS da empresa (o FreeRADIUS nao restringe por NAS).
- **Admin:** menu "Vouchers" (`/admin/:slug/vouchers`, `Vouchers.jsx`, chave de permissao `portais`), API `/api/vouchers` (`voucherController`): listar/filtrar, gerar lote (1-500 codigos de 8 chars sem 0/O/1/I/L) ou codigo personalizado (4-32 `A-Z0-9`), lote nomeado, validade, cancelar (so `disponivel`), excluir (nao `usado`), `GET /export` CSV. Tudo escopado por `empresa_id`; `plano_id` precisa ser da empresa.
- **Resgate (publico)** `POST /api/voucher-portal/resgatar` ({codigo, mikrotik_id, mac, ip}): `cadastroPortalLimiter` + `somentePrimitivos` + `voucherFalhasLimiters` (20 falhas/15 min por IP, 8 por MAC). Inexistente/cancelado/expirado/ja usado respondem a MESMA mensagem 403 (sem enumerar). 1 uso por codigo, reivindicado de forma atomica (`UPDATE ... WHERE status='disponivel'`). Username `voucher_<codigo>` (nao e CPF/MAC: sem grilagem), senha aleatoria, mesmas escritas do `leadLogin` (radcheck, radreply com `Mikrotik-Rate-Limit` + WISPr, radusergroup, `radius_users.liberado_em` no INSERT) e `gateway_info`/`tratarSessaoAtiva`. Voucher ja usado so reconecta do MESMO MAC e com saldo (devolve a credencial gravada, sem renovar franquia). O plano nao precisa de `mikrotik_id`: gateway/NAS vem do equipamento da requisicao.
- **Imprimir cartoes** (`utils/imprimirVouchers.js`, botao na tela): pega os vouchers DISPONIVEIS do filtro atual (lote/busca, todas as paginas) e abre uma janela com 30 cartoes por A4 (3x10, cartao 26 mm de altura com QR a esquerda e texto a direita; uma `.folha` por pagina; codigo, plano/duracao, validade, nome da rede opcional); a janela e aberta no clique, antes do fetch (senao o navegador bloqueia o pop-up); campos escapados. QR code (`qrcode-generator`, SVG gerado no navegador) opcional por cartao: abre `/voucher?empresa_id=..&mikrotik_id=..&codigo=..` (equipamento do plano ou o escolhido no dialogo para planos sem equipamento; sem equipamento = cartao sem QR); `Voucher.jsx` preenche o campo com `codigo`. Limite: a pagina aberta pelo QR nao recebe MAC/IP do hotspot (so chegam pelo redirect), entao o voucher libera na 1a vez mas o aparelho nao reconecta com o mesmo codigo depois (credencial gravada nao e devolvida sem MAC).
- **Selecao da impressao (migration 045):** marcar vouchers disponiveis na lista (caixa por linha + selecionar todos da PAGINA; limpa ao mudar filtro/pagina) imprime so os marcados; sem marcados, o dialogo escolhe Equipamento, Lote, Quantidade (vazio = todos; os MAIS ANTIGOS primeiro, `ordem=asc`) e "Pular os ja impressos" (padrao ligado), com contagem ao vivo. Depois que a janela abre, `POST /api/vouchers/impressos {ids}` (ate 1000, so `disponivel` da empresa) grava `impresso_em`; a lista mostra "impresso <data>", filtro Impressos/Nao impressos e o card Disponivel conta os nao impressos; o CSV traz "Impresso em". "Impresso" so significa que a janela abriu (impressora com defeito: desmarcar "Pular os ja impressos" para reimprimir). `listar` responde com a mensagem da migration 045 se a coluna faltar.
- **Relatorio de usados** (aba "Relatorio de usados" da tela Vouchers, `components/admin/VouchersRelatorio.jsx`, mesma permissao `portais`; sem migration): `GET /api/vouchers/relatorio?de&ate&equipamento&lote&page&limit` (`voucherRelatorioController`; periodo por `usado_em`, padrao 30 dias, max 366; `lote=__sem__` = sem lote) devolve resumo (usados no periodo, disponiveis, cancelados, taxa de uso = usados/(usados+disponiveis) geral), `por_dia`, `por_equipamento`, `por_lote` e a lista detalhada (codigo, plano, equipamento do voucher e onde foi usado, lote, usado_em, MAC/IP, tempo consumido x do plano). Tempo consumido vem da soma do `radacct` do username `voucher_<codigo>` (sessao aberta conta ate agora; radacct indisponivel = `-`). `GET /api/vouchers/relatorio/export` = CSV (ate 10000 linhas, anti-injecao de formula); "Imprimir relatorio" abre janela A4 paisagem (`utils/relatorioVouchers.js`, HTML escapado). Tudo escopado por `empresa_id`. Teste: `backend/tests/unit/voucherRelatorio.test.js`.
- **Acoes em massa (sem migration):** as caixas da lista valem para vouchers DISPONIVEIS e CANCELADOS (usados nunca tem caixa nem sao apagados: historico e relatorio); a impressao usa so os disponiveis marcados. `POST /api/vouchers/massa {acao:'excluir'|'cancelar', ids}` (ate 1000 ids inteiros): excluir = `DELETE ... WHERE empresa_id AND status <> 'usado'`, cancelar = so `disponivel`; responde `{afetados, ignorados}`. `POST /api/vouchers/massa-filtro {filtros, previa?, confirmar?}` exclui TUDO que casa com o filtro da tela (status/equipamento/lote incl. `__sem__`/impresso/busca; sempre `status <> 'usado'`): `previa:true` so conta (`alvo`); sem previa exige `confirmar === 'EXCLUIR'` NO SERVIDOR, apaga ate 5000 por chamada (DELETE por subconsulta derivada, portavel) e devolve `restantes` — o front repete ate zerar. Modal "Excluir todos do filtro atual…" mostra a contagem e pede para digitar EXCLUIR. Helper `montarFiltros` e' compartilhado com `listar`. As duas rotas usam `promocaoLimiter`. Irreversivel (nao ha lixeira); o acesso RADIUS de vouchers usados nao e afetado.
- A lista mostra o plano e o equipamento do plano (ou "Qualquer equipamento") e, nos usados, o equipamento onde foi resgatado (`radius_users.nas_id`); o CSV traz as mesmas colunas.
- Limites: o MAC vem do cliente (spoofavel); nao ha WhatsApp/lead no resgate. Nao testado contra MySQL/MikroTik reais (so mocks). Teste: `backend/tests/unit/voucher.test.js`.

---

## Planos da landing (lado a lado)

Na secao `#planos` de `ApexHome.jsx` os cartoes ficam em UMA fileira a partir de `xl` (ate 6 planos; 7+ quebram em 4 colunas) e cada plano a partir do 2o destaca o que GANHA contra o anterior da lista (`utils/ganhosPlano.ganhosDoPlano`: `+N equipamentos (total X)`, `+N administradores`, recursos novos, "ilimitados"); o 1o plano mostra a lista completa. A tabela comparativa abaixo tem a 1a coluna fixa e a coluna do plano "Mais escolhido" destacada. So frontend (`npm run build`). Teste: `backend/tests/unit/ganhosPlano.test.js`.

## SEO, AEO e GEO da pagina inicial

A landing `/` (`ApexHome.jsx`) e' uma SPA, entao o HTML inicial e' gerado no BUILD a partir de uma fonte unica: `frontend/src/constants/siteSeo.js` (dominio canonico `SITE_URL` = `https://apextelecom.com.br`, descricao, `RECURSOS`, `COMO_FUNCIONA`, `FAQ`, contatos; so afirmacoes verdadeiras, sem avaliacoes/enderecos inventados). O plugin `frontend/src/seo/vitePluginSeo.js` (dentro de `src/` de proposito: o sistema de atualizacao so copia `frontend/src` e `vite.config.js`; `og-apex.png` em `public/` nao vai no pacote de atualizacao, copiar a mao) (`transformIndexHtml` + `generateBundle`) injeta no `index.html`: `<title>`, description, canonical, robots, Open Graph/Twitter, JSON-LD (`Organization`, `WebSite`, `SoftwareApplication`, `FAQPage`) e um resumo semantico estatico dentro de `<div id="root">` (para rastreadores sem JS, como os de IA; o React o substitui e um script o remove fora da raiz), e emite `robots.txt` (areas privadas bloqueadas; GPTBot, ClaudeBot, PerplexityBot, Google-Extended etc. liberados na raiz), `sitemap.xml` (`/` e `/registro`) e `llms.txt`. `og-apex.png` (1200x630) e' estatico em `frontend/public/`. Em runtime: `hooks/useSeo.js` + `components/SeoRota.jsx` (montado em `App.jsx`) mantem titulo/description/canonical por rota e poem `noindex,nofollow` em tudo que nao seja `/` e `/registro` (login, painel, captive portal); `ApexHome.jsx` injeta `<script id="ld-planos">` com `Offer`s reais de `/api/assinatura/planos` (nunca os valores de fallback). **Trocar o dominio, texto ou FAQ so em `siteSeo.js`**; o site precisa de `npm run build` apos o `git pull`. Depois do deploy: enviar `https://apextelecom.com.br/sitemap.xml` no Google Search Console e no Bing Webmaster, validar com o Teste de Resultados Rich e conferir `/robots.txt`, `/sitemap.xml` e `/llms.txt` no ar. Teste: `backend/tests/unit/seoLanding.test.js`. JSON-LD completo: `Organization` com `image` e `address` (`ENDERECO` em `siteSeo.js`, tambem no rodape estatico e no `llms.txt`) e `SoftwareApplication` com `offers` do teste gratis de 7 dias (price 0); os precos dos planos continuam vindo da API em runtime. Nao ha `aggregateRating` de proposito (sem avaliacoes reais).

---

## Atendimento por WhatsApp (menu "WhatsApp", caixa de entrada)

Menu "WhatsApp" logo abaixo de Dashboard (`/admin/:slug/atendimento`, `Atendimento.jsx`): conversas dos clientes pela instancia Evolution da empresa (a tela de CONEXAO continua em Integracoes, `/admin/:slug/whatsapp`). Caixa **compartilhada** (sem atribuicao a atendente), polling de 3 s (so com a aba visivel), contador de nao lidas no menu (`GET /api/atendimento/nao-lidas`, 15 s).
- **Recebimento:** a Evolution chama `POST /api/whatsapp-webhook/:token` (publico, `whatsappWebhookLimiter`, em `server.js`). O token (48 hex) e' por empresa e fica em `empresa_configs` tipo `whatsapp` (`config_json.webhook_token`, criado por `obterOuCriarWebhookToken`; `saveConfig` o preserva). Token desconhecido = 404 sem gravar; `body.instance` de outra instancia e' ignorado; a empresa NUNCA vem do corpo. O webhook e' registrado em `createInstance` e pelo botao "Ativar recebimento" (`POST /api/whatsapp/webhook/ativar`, `GET .../status`), com `POST {evo}/webhook/set/{instancia}` (formato Evolution v2: `{webhook:{enabled,url,byEvents,base64,events}}`). **URL base** (`baseWebhook`): `EVOLUTION_WEBHOOK_BASE` do `.env` se definido; senao `https://$SYSTEM_DOMAIN` (via nginx, nao depende da rede Docker); `http://host.docker.internal:3001` so como ultimo recurso (em Linux NAO resolve dentro do container da Evolution sem `extra_hosts: host.docker.internal:host-gateway`, que o `install.sh` agora inclui; foi a causa de mensagens que nao chegavam). `statusWebhook` so considera `ativo` quando a URL registrada na Evolution e' IGUAL a esperada (token + base atual); `garantirWebhook` (`POST /api/atendimento/webhook/garantir`, chamado ao abrir a tela; 1 tentativa/10 min por empresa) registra de novo se faltar ou estiver com URL antiga. Cada evento recebido e' logado (`[atendimento] webhook empresa=.. evento=..` no PM2) e o status traz `ultimo_evento_em` (memoria do processo). Servidor ja instalado: reiniciar o PM2 e abrir a tela WhatsApp (ou 'Reativar' em Integracoes); sem `SYSTEM_DOMAIN`/`EVOLUTION_WEBHOOK_BASE` defina um deles.
- **Servico** `services/whatsappAtendimento.js`: `processarWebhook` (`messages.upsert` grava conversa+mensagem; `messages.update` avanca o status enviada->entregue->lida, nunca regride), ignora grupos/status/canais/reacoes, `@lid` usa `remoteJidAlt` (sem numero: so o jid), `fromMe` (resposta pelo celular) vira `out` sem contar nao lida, mensagem do cliente reabre a conversa, `lead_id` resolvido pelos 10 ultimos digitos do telefone na empresa. Idempotente (`INSERT IGNORE` + UNIQUE `wa_id`). **Cliente que responde exatamente "SAIR" marca `leads.whatsapp_optout`** (fecha a lacuna do rodape das promocoes). `enviarTexto`: grava `enviando` com `wa_id` temporario, chama `sendText`, troca pelo id real (se o webhook fromMe chegou antes, descarta a linha temporaria), falha vira `erro` + HTTP 502.
- **API** `/api/atendimento` (`auth, tenant, exigeAssinatura, checkPermissao('leads'), exigeRecurso('whatsapp')` — reaproveita a permissao `leads`, que o Usuario Padrao ja tem): `GET /conversas` (status/nao_lidas/q/pagina), `GET /conversas/:id/mensagens` (`limite`, `antes_de`), `POST /conversas/:id/mensagens` ({texto}, `atendimentoEnvioLimiter` 120/min por usuario), `PUT /conversas/:id` ({status, nome}), `POST /conversas/:id/lida`, `GET /nao-lidas`. Toda query com `empresa_id`.
- **Midia (fase 2)**: `utils/whatsappMidia.js` = whitelist de tipos (jpg/png/webp/gif, mp4, ogg/mp3/m4a/aac/wav, pdf, doc(x)/xls(x)/ppt(x), txt, csv, zip; SVG/HTML/executavel nunca), assinatura (magic bytes) conferida, 16 MB, extensao SEMPRE pela whitelist (nunca pelo nome do cliente) e arquivos em `backend/uploads/whatsapp/<empresa>/<AAAA-MM>/<uuid>.<ext>` (ignorado pelo git). **Recebimento:** o webhook grava `midia_mime/nome` e baixa o arquivo por `POST {evo}/chat/getBase64FromMediaMessage/{instancia}` (`baixarMidia`); falha nao perde a mensagem (`midia_path` fica NULL e a rota de leitura tenta de novo). **Envio:** `POST /api/atendimento/conversas/:id/midia` (multipart `arquivo` + `legenda`, `atendimentoEnvioLimiter`): imagem/video/documento por `sendMedia`, audio por `sendWhatsAppAudio` (`enviarMensagem` generaliza `enviarTexto`). **Leitura:** `GET /api/atendimento/midia/:id` (autenticada, escopada por `empresa_id`, `nosniff`, `Cache-Control: private`; inline so imagem/audio/video, PDF/Office sempre `attachment`; caminho nunca sai de `uploads/whatsapp`); o front busca com o token e usa blob URL (`MidiaMensagem.jsx`; imagem carrega sozinha, audio/video/documento ao clicar). **Gravar audio no painel:** botao 🎤 ao lado do 📎 (`Atendimento.jsx`, `MediaRecorder`; Chrome/Edge gravam `audio/webm;codecs=opus`, Firefox `audio/ogg`, Safari `audio/mp4`): cronometro, Cancelar/Enviar, limite 5 min, microfone liberado ao trocar de conversa; envia pelo mesmo `POST /conversas/:id/midia`. A whitelist aceita `audio/webm` (so audio, assinatura EBML; `video/webm` segue recusado) e `sendWhatsAppAudio` vai com `encoding: true` para a Evolution converter em nota de voz (OGG/Opus); se no celular chegar como arquivo em vez de voz, converter no servidor com ffmpeg. Precisa de HTTPS e permissao de microfone. Sem expurgo automatico de midia (proximo passo se o disco crescer). Nao validado contra uma Evolution real (so mocks). Testes: `backend/tests/unit/atendimentoMidia.test.js`.
- **Dia a dia (migration 051):** **atendente** da conversa (`atendente_id`; `POST /conversas/:id/assumir`, `POST /conversas/:id/transferir {admin_id|null}` so para admin vinculado a empresa em `admin_empresas`, `GET /atendentes`; cada troca vira nota interna; lista com `?atendente=eu|sem|<id>`, chips Todas/Minhas/Sem dono; a caixa continua compartilhada, qualquer um pode responder). **Aviso de mensagem nova** (`utils/avisoWhatsapp.js`, so no navegador, `localStorage.wa_aviso`, padrao ligado): `AdminLayout` consulta `/nao-lidas` a cada 15 s (tambem com a aba em segundo plano, se o aviso estiver ligado) e, quando o total de nao lidas sobe, toca um beep (WebAudio) e mostra `Notification` (so com a aba escondida; pede permissao ao ligar o sino 🔔 da tela). **Busca no texto:** `q` com 3+ letras tambem procura em `whatsapp_mensagens.texto` (`EXISTS`, escopado por empresa). **Citar:** `POST /conversas/:id/mensagens {texto, responder_a: <id da mensagem>}` (so mensagem da mesma conversa/empresa) manda `quoted` a Evolution e grava `resposta_a_wa_id`/`resposta_previa`; o webhook guarda a citacao recebida (`contextInfo.stanzaId`). **Localizacao e contato:** `POST /conversas/:id/localizacao {latitude, longitude, nome?, endereco?}` (`sendLocation`) e `/contato {nome, telefone}` (`sendContact`, telefone validado por `normalizarTelefone`), menu ➕ do rodape (`EnviarEspecial.jsx`; aceita link do Google Maps ou `lat, lng` via `utils/coordenadas.js`); recebidos viram texto ("📍 Localizacao" + link, "👤 Contato"). Testes: `backend/tests/unit/atendimentoDiaADia.test.js`. Nao validado contra uma Evolution real.
- - **Automacao (migration 052, tudo DESLIGADO por padrao):** botao "Resposta automatica" da tela WhatsApp (`GET/PUT /api/atendimento/automacao`, `atendimentoAutomacaoController`). Config em `empresa_configs` tipo `whatsapp` -> `config_json.automacao` (`ativo`, `fuso` padrao America/Sao_Paulo, `usar_horario`, `horarios[0..6]` domingo=0 com `ativo/de/ate`, `msg_boas_vindas`, `msg_fora_horario`; `{{nome}}` = 1o nome, `{{empresa}}`); `saveConfig` do `whatsappController` a preserva. Validacao e conta de horario em `utils/horarioAtendimento.js` (puro, `Intl` no fuso da config). `services/whatsappAutomacao.responderAutomatico` roda em segundo plano a partir de `registrarMensagem` (so mensagem RECEBIDA; falha nunca derruba o webhook) e NUNCA responde: `fromMe`, "SAIR", lead com `whatsapp_optout`, conversa em que a equipe/automacao ja mandou `out` nas ultimas 12 h, boas-vindas fora da 1a mensagem (houve `in` nas 12 h anteriores) ou se `auto_resposta_em` ja foi usado nas ultimas 12 h (reserva atomica por `UPDATE ... WHERE auto_resposta_em IS NULL OR < NOW()-12h`; falha de envio devolve a reserva). Sem o recurso `whatsapp` nao responde. A resposta sai por `enviarTexto(..., {automatica:true})`: grava `whatsapp_mensagens.automatica=1` (bolha "🤖 automatica") e NAO zera as nao lidas. **Agendadas:** "➕ > ⏰ Agendar" (`Agendar.jsx`; `GET/POST /conversas/:id/agendadas`, `DELETE /agendadas/:id`; futuro >= 30 s e <= 90 dias, ate 20 pendentes por conversa, escopado por `empresa_id`). `jobs/processaAgendadas.js` (cron a cada minuto, `emExecucao`): reserva a linha (`pendente -> enviada`), *mensagem* envia por `enviarTexto` (sem instancia conectada volta a `pendente` e vira `erro` apos 24 h), *lembrete* so vira nota interna "⏰ Lembrete" + conversa `aberta` com +1 nao lida se o cliente NAO escreveu depois da criacao (senao `cancelada`). Risco: respostas automaticas em excesso podem causar banimento do numero. Nao validado contra Evolution/MySQL reais. Testes: `backend/tests/unit/atendimentoAutomacao.test.js`.
- **Receita (migration 053, aviso DESLIGADO por padrao):** (1) **Aviso "seu tempo esta acabando"**: botao "Aviso de expiracao" da tela WhatsApp (`GET/PUT /api/atendimento/aviso-expiracao`, `POST .../teste`), config em `config_json.aviso_expiracao` (`ativo`, `minutos` 5-60, `template` com `{{nome}} {{minutos}} {{link}} {{plano}} {{empresa}}`; validacao em `utils/avisoExpiracao.js`; `saveConfig` preserva). `jobs/avisaExpiracao.js` (cron a cada 2 min, `emExecucao`): por empresa com o aviso ligado, recurso `whatsapp` e instancia conectada, pega sessoes ABERTAS do `radacct` com restante <= N min (mesma conta do `restante_segundos` das Sessoes Ativas), so username de 11 digitos (CPF; MAC/voucher/pix nao tem telefone confiavel), telefone pelo lead do CPF (nunca por MAC), pula `whatsapp_optout`, reserva o aviso por `INSERT IGNORE` em `whatsapp_avisos_expiracao` (1 por `liberado_em`), maximo 5 por empresa por rodada com 3-8 s entre mensagens, e grava `whatsapp_logs` com `contexto_tipo='aviso_expiracao'` (teste: `aviso_expiracao_teste`). O link e' `https://<host do portal>/planos-cliente?empresa_id&mikrotik_id&cliente_id` (`utils/linkPlanos.js`; host = dominio proprio ativo ou `SYSTEM_DOMAIN`; equipamento = `radius_users.nas_id` da empresa, senao o 1o da empresa); o pagamento segue pelo fluxo seguro PIX/cartao do portal, sem regra de pagamento no chat. (2) **Painel do cliente** (`GET /conversas/:id/cliente`) devolve `saldo {ativo, restante_segundos}` (`verificarSaldoRadius`) e `link_planos`; `PainelCliente.jsx` mostra "Tempo restante" e o botao "💳 Enviar planos" que so poe a mensagem com o link na caixa (o atendente revisa e envia). (3) **Reativacao**: filtro `inativo_dias` (1-3650) em `utils/promocaoWhatsapp.montarFiltroLeads` — lead com MAC, cadastrado ha mais de N dias e SEM sessao no `radacct` (MAC comparado sem separadores, maiusculo) nos ultimos N dias; sem MAC nao entra; opt-out e `descartado` continuam excluidos; campo "Reativacao: sem conectar ha (dias)" em `PromocoesWhatsapp.jsx`. A comparacao de MAC usa funcoes no `radacct.callingstationid` (sem indice): pode ser lenta em base grande, so afeta previa/criacao da promocao. Risco: avisos em massa podem causar banimento do numero. Nao validado contra Evolution/MySQL reais. Testes: `backend/tests/unit/atendimentoReceita.test.js`.
- **Relatorios, satisfacao, IA, painel e expurgo (migration 054):** (1) **Relatorios** `GET /api/atendimento/relatorios?de&ate` (padrao 30 dias, max 366; `atendimentoRelatoriosController`): mensagens por dia (in/out), tempo da 1a resposta (1a `in` do periodo -> 1a `out` DEPOIS dela, media e mediana; resposta automatica nao conta quando existe `automatica`), mensagens por atendente (`admin_id`), conversas abertas/resolvidas/novas e satisfacao (media + distribuicao). Tela `AtendimentoRelatorios.jsx` (`/admin/:slug/atendimento/relatorios`, link "Relatorios" na tela WhatsApp, CSV gerado no navegador com protecao contra formula). (2) **Satisfacao**: em "Resposta automatica" a opcao "Pedir nota de 1 a 5 ao resolver" (`pedir_nota`, `msg_pedir_nota`; desligada por padrao). Ao mudar para `resolvida`, `services/whatsappSatisfacao.pedirNota` manda a pergunta (marcada automatica; 1 pedido por conversa a cada 24 h por reserva atomica; nunca para opt-out nem sem o recurso; falha nao atrapalha o status); a proxima mensagem do cliente que seja SO `1`..`5` em ate 24 h grava `nota_satisfacao` (`capturarNota`, chamada em `registrarMensagem` ANTES de reabrir: a nota nao reabre a conversa nem conta como nao lida; texto comum nao consulta o banco). A nota aparece como `5★` no cabecalho da conversa. (3) **Sugerir resposta por IA** (`✨`, `POST /conversas/:id/sugerir`, `sugestaoIaLimiter` 60/h por usuario, `GET /ia-status`): so existe se o SERVIDOR tem `ANTHROPIC_API_KEY` (modelo `ANTHROPIC_MODEL`, padrao `claude-haiku-5-5`; **o custo e' da plataforma**) E a empresa liberou em "Resposta automatica" (`ia_sugestao`, desligado por padrao: trechos da conversa saem para a Anthropic). `services/sugestaoIA.js` manda ate 20 mensagens de texto (sem notas internas), 1o nome, empresa, plano e minutos restantes; CPF, e-mail e telefone sao mascarados do texto antes de sair; o texto da conversa e' tratado como dado (nao instrucao). Devolve um rascunho que preenche a caixa; o atendente revisa e envia. (4) **Painel "Hoje"** no Dashboard (`GET /api/dashboard/hoje`, cada bloco falha sozinho): vendas aprovadas e valor do dia, conectados agora e conexoes novas, e (so com o recurso `whatsapp`) conversas abertas, nao lidas e mensagens do dia. (5) **Expurgo de midia** `jobs/expurgaMidia.js` (cron diario 03:30; `MIDIA_RETENCAO_DIAS`, padrao 90, `0` desliga): apaga o arquivo (so dentro de `uploads/whatsapp`, via `caminhoAbsoluto`), zera `midia_path` e grava `midia_expirada_em`; o texto da mensagem fica, a bolha mostra "Midia removida pela limpeza automatica" e `servirMidia` responde 410 sem tentar baixar de novo. Irreversivel. Nao validado contra Evolution/Anthropic/MySQL reais. Testes: `backend/tests/unit/atendimentoRelatorios.test.js`.
**Fase 3** (`controllers/atendimentoExtrasController.js`, mesma permissao `leads` e recurso `whatsapp`): **notas internas** (`POST /conversas/:id/notas`, `direcao='nota'`, `wa_id` `nota_<uuid>`, nunca vao a Evolution nem mexem em previa/nao lidas; a tela as mostra em amarelo com o autor); **etiquetas** (`/etiquetas` CRUD, nome ate 40 e cor `#rrggbb`; `PUT /conversas/:id/etiquetas {ids}` substitui o conjunto e so aceita ids da empresa, ate 20; a lista traz `etiquetas` por conversa e filtra por `?etiqueta=`); **respostas rapidas** (`/respostas-rapidas` CRUD; atalho `[a-z0-9_-]` ate 30, `{{nome}}` e `{{empresa}}` sao trocados NO NAVEGADOR — nome = 1o nome da conversa, empresa vem de `/conversas/:id/cliente`; digitar `/` na caixa abre as sugestoes, Enter/Tab aplica); **painel do cliente** (`GET /conversas/:id/cliente`: lead vinculado ou de mesmo telefone, **CPF sempre mascarado** `123.***.***-45`, plano atual por `radius_users` (username = CPF) e ultimo pagamento por CPF; `POST /conversas/:id/vincular {lead_id|null}`, `GET /clientes?q=` busca sem CPF, `POST /conversas/:id/criar-cliente` cadastra sem CPF e com `lgpd_aceite=0`, origem `whatsapp`); **nova conversa** (`POST /conversas {telefone, nome?, texto?}`, `novaConversaLimiter` 30/h por usuario: recusa 409 quem tem `whatsapp_optout`, reaproveita a conversa do mesmo telefone (10 ultimos digitos) e so envia se vier texto; a tela avisa do risco de bloqueio do numero). O painel do cliente e' coluna a direita em telas >= xl e bloco recolhivel ("Cliente") abaixo disso. Nao ha saldo de tempo no painel (so plano e ultimo pagamento). **Tela Clientes (lista paginada):** `GET /api/leads` com `limit`/`page` responde `{itens,total,pagina,limite}` (sem `limit` continua array), so colunas leves (sem `lgpd_termo`/mac/ip), filtros `status`, `origem` (origem ou sistema_origem) e `q` (com `%`/`_` escapados); `GET /api/leads/resumo` devolve contadores por status e origem. `Leads.jsx` pagina de 50 em 50, busca com espera de 500 ms, ignora respostas atrasadas e mostra erro com "Tentar de novo". `listarConversas` responde 503 com instrucao quando faltam as migrations 048/049. Testes: `backend/tests/unit/leadsLista.test.js`. Testes: `backend/tests/unit/atendimentoExtras.test.js`; fase 1: `atendimento.test.js`.

---

## Trilha de ativacao de equipamento (tela Equipamentos)

Checklist por equipamento, 100% derivado (sem migration): cadastrado, conectividade (teste ao vivo do front), RADIUS (`nas.nasname = mikrotiks.ip`), hotspot (`end_hotspot`; Omada/UniFi/Grandstream = etapa `manual` com link ao tutorial), portal (`portal_id`), plano (ativo do equipamento ou sem equipamento) e primeira conexao (`radacct` por `nasipaddress`; `radpostauth` nao tem NAS). UniFi nao usa RADIUS (`na`). API: `GET /api/mikrotiks/trilha` (permissao `mikrotiks`, 3 consultas agregadas por empresa, sem RouterOS; tabela ausente vira etapa `desconhecido`; devolve tambem `usuarios_ativos` por equipamento, que antes vinha vazio). Codigo: `backend/src/utils/trilhaAtivacao.js`, `frontend/src/components/admin/TrilhaAtivacao.jsx` (painel de resumo + botao "Trilha n/7"/"Ativo" por linha; equipamento novo abre a propria trilha). Teste: `backend/tests/unit/trilhaAtivacao.test.js`. Nao testado contra MySQL/MikroTik reais.

---

## Auditoria do painel (quem fez o que)

Middleware global `utils/auditoria.auditoriaMiddleware` (montado em `server.js` logo apos `express.json`, em `/api`): ao terminar uma requisicao AUTENTICADA com status 2xx/3xx que case uma regra da tabela `REGRAS` (excluir/editar clientes em massa, exportar a base, criar/editar/excluir plano, usuario, equipamento, portal, salvar configuracoes (empresa-config, Mercado Pago, EFI, WhatsApp, automacao, aviso de expiracao), limpeza de dados, acoes em massa de vouchers, iniciar promocao) grava uma linha em `audit_logs` (migration 055). Grava so acao, entidade, id da URL, uma contagem (`N registro(s)`, de `body.ids`), IP e o admin; **nunca o corpo, senha, CPF ou token**. Falha ao gravar nunca derruba a requisicao (`registrar` engole o erro; tabela ausente e' ignorada). Tela `Auditoria.jsx` (`/admin/:slug/auditoria`, Configuracoes > Auditoria, permissao `configuracoes` = so Administrador): filtros por periodo, acao e busca, 50 por pagina, escopada por `empresa_id` (`GET /api/auditoria`). Sem expurgo automatico. **Para auditar uma rota nova, acrescente uma linha em `REGRAS`** (nao precisa mexer no controller). Teste: `backend/tests/unit/auditoria.test.js`. Nao testado contra MySQL real.

---

## Alertas de equipamento offline (WhatsApp)

Botao "Alertas offline" na tela Equipamentos (`components/admin/AlertasEquipamentos.jsx`; API `GET/PUT /api/alertas-equipamentos`, `POST .../teste`; permissao `mikrotiks` + recurso `whatsapp`; `alertaEquipamentosController`). Config em `empresa_configs` tipo `whatsapp` -> `config_json.alerta_equipamentos` (`ativo` **desligado por padrao**, `telefones` ate 3 (validados por `normalizarTelefone`, `ativo` exige ao menos 1), `falhas` 2-10 (padrao 3), `avisar_volta`; validacao em `utils/alertaEquipamentos.js`; `saveConfig` do `whatsappController` a preserva). `jobs/alertaEquipamentos.js` (cron a cada 5 min, `emExecucao`): por empresa com o alerta ligado e recurso `whatsapp`, testa CADA equipamento da empresa pelo driver (`getDriver(eq).testConnection(eq)`, timeout 10 s; excecao, timeout ou `{sucesso:false}` = offline) e guarda o estado em `equipamento_status` (migration 056). A maquina de estados e' `proximoEstado` (pura): so avisa na N-esima falha SEGUIDA, **1 aviso por queda** (nao repete enquanto segue offline) e, se `avisar_volta`, 1 aviso de volta com o tempo fora; uma falha isolada nunca avisa. Sem a instancia WhatsApp conectada nada e' marcado como avisado (a proxima rodada tenta de novo). Mensagens por `enviarMensagemEstrita` com 3-8 s entre telefones; log em `whatsapp_logs` (`contexto_tipo='alerta_equipamento'`, teste `alerta_equipamento_teste`). Limites: Omada External RADIUS e Grandstream sem chaves GWN respondem sempre "sucesso" no `testConnection` (nao ha o que testar), entao esses tipos nunca alertam; MikroTik/UniFi/Omada com API sim. Use um numero DIFERENTE do WhatsApp conectado. Auditoria: salvar a config entra em `audit_logs`. Nao testado contra equipamentos/Evolution/MySQL reais. Teste: `backend/tests/unit/alertaEquipamentos.test.js`.

---

## Aviso operacional (WhatsApp para quem esta conectado)

Tela `AvisoOperacional.jsx` (`/admin/:slug/aviso-operacional`, Marketing > Aviso operacional; permissao `configuracoes` = so Administrador, recurso `whatsapp`), API `/api/avisos-operacionais` (`avisoOperacionalController`): `POST /previa`, `POST /teste`, `POST /` (cria o envio `rascunho`), `GET /` (so `tipo='aviso'` da empresa) e, reaproveitando o controller de promocoes, `GET /:id`, `POST /:id/iniciar|pausar|retomar|cancelar`. Usa a MESMA fila e o MESMO worker das promocoes (`jobs/enviaPromocoes.js`, 1 envio por empresa por rodada, 4 mensagens com 8-20 s entre elas): o envio e' gravado em `promocao_envios` com `tipo='aviso'` (migration 057) e o worker, quando `tipo === 'aviso'`, monta a mensagem por `utils/avisoOperacional.montarMensagemAviso` (**sem o rodape "responda SAIR"** de marketing) e loga `whatsapp_logs.contexto_tipo='aviso_operacional'`. **Destinatarios** (`selecionarConectados`): leads da empresa com CPF + telefone, `whatsapp_optout = 0` (aviso de servico tambem respeita quem pediu para sair) e fora de `descartado`, que tenham sessao ABERTA agora (`radacct.acctstoptime IS NULL` com `username` = CPF so digitos, via `radius_users` da empresa); `equipamento_id` opcional restringe a `radacct.nasipaddress = mikrotiks.ip` do equipamento (validado contra a empresa, 400 se for de outra). Telefone normalizado e deduplicado; maximo 500 por aviso; quem nao tem lead/CPF (ex.: so MAC, voucher) nao recebe. A lista de promocoes (`GET /api/promocoes-whatsapp`) passou a mostrar so `tipo='promocao'` quando a coluna existe. Iniciar um aviso entra na auditoria (`aviso_operacional.iniciar`). Riscos: aviso em massa pode causar bloqueio do numero; o worker pausa o envio se o WhatsApp estiver desconectado. Nao testado contra Evolution/MySQL reais. Teste: `backend/tests/unit/avisoOperacional.test.js`.

---

## Chatbot de menu (atendimento WhatsApp)

Botao "Chatbot" da tela WhatsApp (`components/admin/atendimento/Chatbot.jsx`; `GET/PUT /api/atendimento/chatbot` em `atendimentoAutomacaoController`; config em `config_json.chatbot`, **desligado por padrao**; `saveConfig` do `whatsappController` a preserva; regras puras e validacao em `utils/chatbot.js`: ate 9 opcoes, teclas `1-9` unicas, tipos `saldo|planos|atendente|texto`, `texto` exige o texto da resposta, `ativo` exige menu e ao menos 1 opcao). `services/whatsappChatbot.processar` roda em segundo plano a partir de `registrarMensagem` (so mensagem RECEBIDA de texto), **antes** de `responderAutomatico`: se devolve `tratada:true` a resposta automatica NAO dispara. Fluxo: 1a mensagem (ou a cada 12 h, ou o cliente digita `menu`, no maximo 1/min) manda o menu numerado e grava `chatbot_estado='menu'`/`chatbot_em` por reserva atomica (`UPDATE ... WHERE chatbot_em IS NULL OR < NOW()-janela`; falha de envio devolve a reserva); o numero digitado em ate 30 min do menu executa a opcao: `saldo` = minutos restantes por `verificarSaldoRadius` do CPF do lead da conversa (**nunca mostra o CPF**; sem cadastro/sem acesso/tempo acabado tem mensagem propria), `planos` = link do portal (`linkPlanosDoCliente`), `texto` = texto fixo, `atendente` = `msg_atendente` (+ a mensagem de fora do horario da Resposta automatica, se estiver fora do horario), `chatbot_estado='humano'`, conversa `aberta` e nota interna; depois de `humano` o robo (e a resposta automatica) ficam calados por 12 h. Numero digitado sem menu recente nao reenvia o menu antes de 12 h (a equipe ve a mensagem). **Nunca responde**: desligado, sem o recurso `whatsapp`, sem a migration 058, `fromMe`, midia, "SAIR", lead com `whatsapp_optout`, conversa com `atendente_id`, conversa em que a equipe mandou `out` humano (`automatica = 0`) nas ultimas 12 h. As respostas saem marcadas `automatica` (bolha "🤖") e nao zeram as nao lidas. Auditoria: salvar a config entra em `audit_logs`. Risco: mensagens automaticas em excesso podem causar bloqueio do numero. Nao validado contra Evolution/MySQL reais. Teste: `backend/tests/unit/chatbot.test.js`.

---

## Pos-compra e avaliacoes (WhatsApp)

Botao "Pos-compra" da tela WhatsApp (`components/admin/atendimento/PosCompra.jsx`; `GET/PUT /api/atendimento/pos-compra` em `atendimentoAutomacaoController`; config em `config_json.pos_compra`, **desligado por padrao**; `saveConfig` do `whatsappController` a preserva; validacao em `utils/posCompra.js`: 1-72 h, link de avaliacao so `https://` sem credenciais, ate 3 telefones de alerta). Tres partes: (1) **Agradecimento**: `jobs/posCompra.js` (cron a cada 10 min, `emExecucao`) manda a `msg_agradecimento` (`{{nome}} {{plano}} {{empresa}}`) por pagamento `approved` com `liberado_em` ha >= N h e no maximo 3 dias (ligar o recurso nunca dispara o historico). Telefone pelo pagamento/lead (`cliente_id` ou CPF; nunca MAC); opt-out e sem telefone sao marcados como tratados sem enviar; varias compras do mesmo numero na rodada = 1 mensagem; maximo 5 por empresa por rodada, 3-8 s entre elas; exige recurso `whatsapp` e instancia conectada; log `whatsapp_logs.contexto_tipo='pos_compra'`. (2) **Nota 4-5**: `services/whatsappPosCompra.aoReceberNota` (chamado em segundo plano por `registrarMensagem` quando `capturarNota` grava a nota) manda o link de avaliacao na propria conversa (automatica, 1x por nota). (3) **Nota 1-2**: alerta aos telefones configurados com nome e telefone mascarado (`***1234`, nunca CPF); log `alerta_nota_baixa`. Dedupe e reserva atomica em `whatsapp_pos_compra` (a reserva e devolvida se o envio falhar). Auditoria: salvar a config entra em `audit_logs`. Risco: mensagens automaticas em excesso podem causar bloqueio do numero. Nao validado contra Evolution/MySQL reais. Teste: `backend/tests/unit/posCompra.test.js`.

---

## Cupom de desconto

Menu Marketing > Cupons (`Cupons.jsx`, `/admin/:slug/cupons`; API `/api/cupons`, permissao `configuracoes` = so Administrador; `cuponsController`, regras em `utils/cupons.js`). **Valores sempre em centavos** (como `planos.valor` e `pagamentos.valor`). Cliente digita o codigo em `Pagamento.jsx` ("Tem cupom de desconto?", tambem aceita `?cupom=` na URL) e `POST /api/cupom-portal/validar` ({plano_id, codigo, cpf?}; publico, `cupomFalhasLimiter` 30 falhas/15 min por IP) so mostra `valor_original/desconto/valor_final`, nada e gravado. **Todo calculo e do servidor**: `gerarPagamento` (PIX) e `gerarPagamentoCartao` recebem so o `cupom` (codigo), chamam `resolverCupom` e gravam `pagamentos.valor` = valor final (+ `cupom_id`, `valor_original`); valor/desconto vindos do cliente sao ignorados; cupom invalido = 400 `Cupom invalido ou indisponivel.` ANTES de gravar ou cobrar (nunca cai em cobranca cheia). Valida: mesma empresa do plano, `ativo`, `valido_ate`, `max_usos`, plano do cupom e **cada CPF usa o mesmo cupom uma vez** (pagamento `approved`/`expirado` com o cupom). Minimo R$ 1,00 (`VALOR_MINIMO`); plano de R$ 1,00 ou menos nao recebe cupom. Todas as recusas respondem igual (sem enumerar cupons). **O uso so conta na aprovacao**, idempotente: `registrarUsoCupom` roda junto da reserva `liberado_em` nos 3 caminhos (cartao, webhook PIX, polling `/status`) e `cupom_usos.pagamento_id` e UNIQUE. Limite conhecido: `max_usos` e conferido ao gerar, nao ao aprovar; varios PIX gerados antes da primeira aprovacao podem passar do limite. Cupom ja usado nao pode ser excluido (so desativado). Auditoria: criar/editar/excluir entram em `audit_logs`. **Correcao junto:** o webhook do PIX comparava `pagamentos.valor` (centavos) com `transaction_amount` do MP (reais), entao nunca aprovava pagamento pago (so o polling aprovava); agora compara `valor/100`. O card "Vendas" do Dashboard tambem dividia errado (centavos exibidos como reais). Nao testado contra MP/MySQL reais. Teste: `backend/tests/unit/cupons.test.js`.

---

## Renovacao por WhatsApp (compras do portal)

Botao "Renovacao" da tela WhatsApp (`components/admin/atendimento/Renovacao.jsx`; `GET/PUT /api/atendimento/renovacao` e `GET .../renovacao/relatorio?dias=` em `atendimentoAutomacaoController`; config em `config_json.renovacao`, **desligada por padrao**; `saveConfig` do `whatsappController` a preserva; validacao em `utils/renovacao.js`: ate 3 lembretes entre 0/1/2/3/5/7/10/14/30 dias apos o vencimento, mensagem OBRIGATORIAMENTE com `{{link}}`, cupom opcional `[A-Z0-9]{3,32}`). Nao ha fatura nem cobranca externa: "renovacao" = quem comprou no portal e o acesso venceu. `jobs/renovacaoWhatsapp.js` (cron `17 * * * *`, `emExecucao`): por empresa com a renovacao ligada, recurso `whatsapp` e instancia conectada, para cada etapa D pega a ULTIMA compra do cliente (`pagamentos` `approved`/`expirado`, valor > 0, sem compra posterior do mesmo `cliente_id` ou CPF) cujo `expira_em` caiu entre D e D+2 dias atras (ligar o recurso nunca dispara o historico). Telefone pelo pagamento/lead (`cliente_id` ou CPF; nunca MAC); opt-out e sem telefone viram `ignorada`; 1 lembrete por compra e etapa (UNIQUE), no maximo 1 por telefone a cada 20 h, 5 por empresa por rodada, 3-8 s entre mensagens; link por `linkPlanosDoCliente` (+ `?cupom=` se configurado, `renovacao.comCupom`); log `whatsapp_logs.contexto_tipo='renovacao'`. O pagamento segue pelo portal (PIX/cartao seguros). **Cupom no link:** `PlanosCliente.jsx` e `CadastroCliente.jsx` propagam `?cupom=` (so codigo no formato valido) ate `Pagamento.jsx`, que o valida sozinho na abertura (`cupomResolvido`: o PIX so e gerado depois, para nao sair com o valor cheio). O servidor continua validando o cupom (empresa, validade, usos, plano, 1 uso por CPF); cupom invalido so mostra a mensagem. **Relatorio:** lembretes enviados por etapa e quantos voltaram a comprar em ate 7 dias (compra posterior do mesmo cliente/CPF). Auditoria: salvar a config entra em `audit_logs`. Risco: mensagens automaticas em excesso podem causar bloqueio do numero. Nao validado contra Evolution/MySQL reais. Teste: `backend/tests/unit/renovacao.test.js`.

---

## Identidade por empresa (white label)

Cada empresa tem a PROPRIA identidade (logo, tamanho P/M/G/XG da logo no cabecalho do site / login / painel, favicon e icone do iPhone), igual ao modelo "Identidade do site" da plataforma, em Configuracoes > "Identidade da empresa" (`IdentidadeSite.jsx` com `empresa=<slug>`). A identidade GLOBAL (padrao da plataforma) fica numa pagina separada so do dono da plataforma: menu "Identidade da plataforma" (`/admin/:slug/identidade-plataforma`, `RotaDono`, `IdentidadeSite` sem a prop); ela NAO aparece mais em Configuracoes (evita enviar a logo no bloco errado e trocar a de todas as empresas). Logo em `empresas.logo_url`; favicon, icone e tamanhos em `empresas.branding_json` (migration 062, **rodar no servidor**; sem ela a logo funciona e salvar tamanhos/favicon responde 503 com a instrucao). API da empresa: `GET/PUT /api/empresas/minha/branding` (`{tamanhos}`), `POST/DELETE /api/empresas/minha/{logo,favicon,apple-icon}` (`empresaBrandingRoutes.js`: `auth, tenant, exigeAssinatura, checkPermissao('configuracoes')` = Administrador; a empresa vem so do token, nunca da URL/corpo; JPG/PNG/WEBP 2 MB (favicon 512 KB, icone iPhone PNG 1 MB), SVG bloqueado, assinatura conferida; arquivos `empresa-<id>-<tipo>-<ts>` e o antigo da empresa e' apagado). Publico: `GET /api/branding?empresa=<slug>` devolve a identidade da empresa por cima da plataforma (`brandingEmpresaController.mesclar`: o que a empresa nao enviou cai na plataforma; tamanhos da empresa so valem se ela enviou logo). Front: `useBranding(slug)` (cache por empresa), `MarcaApex`/`SiteHeader` com prop `empresa`; o painel usa o slug da URL; **`/login/<slug>`** abre o login com a marca da empresa (o `/login` geral segue com a da plataforma; o link aparece na tela de Configuracoes). Dominio proprio de empresa e' so do portal do cliente final (o login do painel fica 404 la), entao o login da empresa e' o link `/login/<slug>`. Logo do portal cativo segue por portal (`portais.logo_url`). Testes: `backend/tests/unit/brandingEmpresa.test.js`. Nao testado contra MySQL real.

---

## Hub WhatsApp (abas)

`pages/admin/WhatsAppHub.jsx` em `/admin/:slug/atendimento/:aba?` (padrao `conversas`; aba invalida/sem permissao cai na 1a permitida). Abas e a permissao de modulo de cada uma: **Conversas** (`Atendimento.jsx`, `leads`), **Contatos** (`leads`), **Régua de cobrança** (`configuracoes`), **Campanhas** (`configuracoes`: sub-abas Promocoes = `PromocoesWhatsapp.jsx` e Aviso agora = `AvisoOperacional.jsx`), **Modelos** (`leads`), **Relatórios** (`AtendimentoRelatorios.jsx`, `leads`). As paginas antigas ganharam a prop `embutido` (`components/admin/Moldura.jsx`: sem `AdminLayout` quando embutida); `/promocoes-whatsapp` e `/aviso-operacional` redirecionam para a aba (`RedirecionaAba` em `App.jsx`, `?sub=aviso`); o item "Promocoes WhatsApp" do menu Marketing aponta para a aba. Conversas aceita `?conversa=<id>` (a aba Contatos usa; o parametro e' limpo da URL ao abrir). Todas as 10 abas existem: Conversas, Contatos, Régua de cobrança, Campanhas, Indicações, Modelos, Não perturbe, Relatórios, Manutenções e Alertas técnicos.
- **Contatos:** `GET /api/atendimento/contatos?q&origem=conversas|sem_conversa&optout=1&etiqueta&pagina` (`atendimentoContatosController`, 50/pagina): UNION de `whatsapp_conversas` com `leads` com telefone SEM conversa (dedupe pelos 10 ultimos digitos, `exprTelefoneFim10` qualificada com alias), tudo por `empresa_id`; **nunca devolve CPF**; etiquetas das conversas anexadas. Acoes: Conversar (abre a conversa ou cria por `POST /conversas`, que ja recusa quem pediu para sair), Nao perturbe (`PUT /api/leads/:id {whatsapp_optout}`), gerenciar etiquetas.
- **Régua de cobrança:** so uma linha do tempo (`Regua.jsx`) que abre as 3 configuracoes ja existentes (Pos-compra, Aviso de expiracao, Renovacao) com status ligado/desligado e o relatorio de renovacao; fonte de dados continua sendo **compras do portal** (sem faturas externas/SGP).
- **Modelos** (`Modelos.jsx`, API das respostas rapidas): categorias em `utils/modelosMensagem.js` (`CATEGORIAS`, `categoriaValida`, `MODELOS_PADRAO`); `POST /api/atendimento/respostas-rapidas/padrao` cria os modelos prontos que ainda nao existem (`INSERT IGNORE`, nunca sobrescreve). `components/admin/atendimento/SeletorModelo.jsx` ("Usar modelo") preenche o campo de mensagem de Renovacao, Pos-compra, Aviso de expiracao, Promocoes e Aviso operacional (o texto continua editavel; as variaveis validas sao as de cada tela). O atalho `/` das conversas nao mudou.
- Testes: `backend/tests/unit/hubWhatsapp.test.js`. Nao validado contra MySQL real.
- **Nao perturbe (aba, migration 063):** `utils/naoPerturbe.js` e' o ponto UNICO que decide se um telefone pode receber mensagem proativa: `estaBloqueado`/`bloqueados` (lista `whatsapp_nao_perturbe` OU `leads.whatsapp_optout`, pelos 10 ultimos digitos, tolerante a tabela ausente), `adicionar` e `emSilencio(empresaId, tipo)`. Horario de silencio em `config_json.nao_perturbe` (`ativo` **desligado**, `fuso`, `de`/`ate` — pode cruzar a meia-noite, a madrugada pertence a noite anterior —, `dias` da noite, `aplicar_a` entre promocao/renovacao/pos_compra/aviso_expiracao/manutencao; regras puras em `utils/silencio.js`; `saveConfig` do `whatsappController` a preserva). Fora da janela os jobs so ADIAM (nada e reservado nem marcado como enviado). Plugado em `jobs/enviaPromocoes` (so `tipo` promocao; aviso operacional e' servico e nao entra no silencio), `posCompra`, `renovacaoWhatsapp`, `avisaExpiracao` e, so na lista (sem horario), em `whatsappSatisfacao.pedirNota`, `whatsappChatbot` e `whatsappAutomacao` (resposta ao proprio cliente nunca entra no silencio). Cliente que responde SAIR agora tambem entra na lista (origem `sair`), mesmo sem lead. API `/api/atendimento/nao-perturbe` (`GET/POST /`, `DELETE /:id`, `POST /importar` ate 5000 telefones, `GET /export` CSV, `GET/PUT /config`); aba "Nao perturbe" (`NaoPerturbe.jsx`, modulo `configuracoes`); auditoria registra config/adicionar/importar/remover. **Novo envio proativo TEM que chamar `naoPerturbe.estaBloqueado` (e `emSilencio` se for marketing/cobranca).** `promocaoWhatsapp.montarFiltroLeads` ainda nao filtra a lista nova na previa (o envio a ignora no worker). Teste: `backend/tests/unit/naoPerturbe.test.js`. Nao validado contra MySQL/Evolution reais.
- **Manutencoes (aba, migration 064):** `Manutencoes.jsx` + `/api/atendimento/manutencoes` (`GET ?quando=futuras|passadas`, `POST`, `PUT /:id` so `agendada` sem avisos ja reservados (409), `POST /:id/cancelar`, `POST /previa`; `manutencoesController`, validacao pura em `utils/manutencao.js`: titulo, datas `AAAA-MM-DD HH:mm` SEM fuso (vale o relogio do MySQL, o mesmo do job; inicio no futuro conferido por `TIMESTAMPDIFF` no banco), duracao <= 7 dias, antecedencias entre 15/30/60/180/720/1440/2880 min (ate 3), `{{nome}} {{equipamento}} {{inicio}} {{fim}}`). Publico (`utils/manutencaoPublico.selecionarPublico`): leads da empresa com CPF + telefone que tiveram sessao no `radacct` do equipamento (`mikrotiks.ip`, ou qualquer da empresa) nos ultimos N dias (padrao 30), sem opt-out nem lista nao perturbe, maximo 500; a tela mostra a previa antes de salvar. `jobs/manutencoes.js` (cron 5 min, `emExecucao`): para cada manutencao agendada/em andamento com `avisar_clientes`, reserva a etapa (`INSERT IGNORE` UNIQUE) e cria UM envio em `promocao_envios` (`tipo 'aviso'`, `filtros_json.origem = 'manutencao'`, `em_andamento`) com os destinatarios; o worker `enviaPromocoes` entrega com ritmo humano e, para `origem = 'manutencao'`, respeita o horario de silencio (`manutencao`). So a etapa mais proxima e' enviada (se criada em cima da hora, as mais distantes sao marcadas como vencidas); `fim` manda o aviso final (ate 6 h depois). Fora do silencio/sem recurso `whatsapp` so adia; erro ao criar o envio devolve a reserva. Cancelar para de avisar e cancela os envios pendentes da manutencao. **Alerta offline da equipe:** `jobs/alertaEquipamentos` nao avisa equipamento em manutencao agora (o estado segue registrado e o aviso, se ainda estiver fora depois da janela, sai). Nada e enviado sem a empresa criar uma manutencao. Auditoria: criar/editar/cancelar. Teste: `backend/tests/unit/manutencoes.test.js`. Nao validado contra MySQL/Evolution reais.
- **Alertas tecnicos (aba, migration 065):** `AlertasTecnicos.jsx` + `/api/atendimento/alertas-tecnicos` (`GET ?estado=abertos|resolvidos|todos&equipamento_id`, `POST` ocorrencia manual, `POST /:id/resolver` so manual, `GET /:id/previa`, `POST /:id/avisar-clientes {tipo:'queda'|'volta', confirmar:true}`, `GET/PUT /config`; `alertasTecnicosController`, regras em `services/alertasTecnicos.js` e `utils/alertaTecnico.js`). Config em `config_json.alertas_tecnicos` (`ativo` **desligado** = monitora e registra no feed SEM enviar nada; `avisar_clientes_auto` **desligado**, `apos_minutos` 5-240 (padrao 15), `avisar_volta`, `mensagem_queda`/`mensagem_volta` com `{{nome}} {{equipamento}} {{inicio}}`; `saveConfig` do `whatsappController` a preserva). **Quem alimenta o feed e' o proprio `jobs/alertaEquipamentos`** (cron 5 min): agora roda para a empresa que ligou o aviso a equipe (`alerta_equipamentos`) OU o monitoramento (`alertas_tecnicos.ativo`); a equipe so recebe WhatsApp se o aviso a equipe estiver ligado. Queda = N falhas seguidas (a mesma regra do aviso a equipe) e fora de manutencao programada; abre 1 alerta por equipamento (dedupe por alerta aberto) e encerra quando responde; WhatsApp desconectado abre/encerra um alerta so de painel. **Aviso aos clientes** reusa o publico e a fila da etapa Manutencoes (`services/avisoClientes.criarEnvioAviso`, `filtros_json.origem='alerta'`): 1 aviso de queda e 1 de volta por alerta (reserva atomica nas colunas `clientes_avisados_em`/`clientes_volta_avisados_em`, devolvida se o envio falhar); automatico so com `avisar_clientes_auto` (queda apos N min; volta em ate 6 h depois de resolver) e manual pelo botao "Avisar clientes agora" (previa com total + confirmacao, exige WhatsApp conectado). O silencio "Nao perturbe" so vale para alertas se `alerta_tecnico` estiver marcado em `aplicar_a` (por padrao nao e': queda e' urgente). Auditoria: config, criar e avisar clientes. Teste: `backend/tests/unit/alertasTecnicos.test.js`. Nao validado contra equipamentos/Evolution/MySQL reais.
- **Indicacoes (aba, migration 066):** `Indicacoes.jsx` + `/api/atendimento/indicacoes` (`GET ?status=`, `GET/PUT /config`, `POST /convite {lead_id, enviar?}`, `POST /:id/revogar`; `indicacoesController`, `services/indicacoes.js`, regras puras em `utils/indicacoes.js`). Config em `config_json.indicacoes` (`ativo` **desligado**, `desconto_indicado` e `recompensa_indicador` = `{tipo: percentual 1-99 | valor em centavos, valor}`, `validade_cupom_dias`, `limite_por_indicador_mes` (padrao 5), `exigir_compra_do_indicador`, `mensagem_convite` com `{{codigo}}`; `saveConfig` do `whatsappController` a preserva). Cada cliente tem um codigo `IND` + 6 caracteres (`indicacoes_codigos`); o link do convite e' o link de planos do portal com `?cupom=<codigo>` (a propagacao do `?cupom=` ja existia) e **nunca leva o `cliente_id` do indicador**. **O codigo entra pelo MESMO caminho do cupom:** `utils/cupons.resolverCupom` tenta o cupom comum e, se nao for um, `services/indicacoes.resolverIndicacao`; todo calculo e do servidor (`calcularDesconto`, minimo R$ 1,00) e qualquer recusa responde igual a cupom invalido (`Cupom inválido ou indisponível.`, 400, ANTES de gravar ou cobrar). Antifraude (`decidirIndicacao`): so a 1a compra do CPF (nenhum pagamento `approved`/`expirado`), CPF obrigatorio (o do cadastro, nao o do cartao), nunca o proprio indicador (mesmo CPF, mesmo telefone pelos 10 ultimos digitos ou mesmo aparelho/MAC), 1 indicacao por CPF, teto mensal por indicador e, se exigido, indicador com compra aprovada. `gerarPagamento`/`gerarPagamentoCartao` passam `mac` e `cliente_id` e, com indicacao, gravam `pagamentos.indicacao_id` + `valor_original` por `vincularPagamento` (indicacao `cadastrada`, `cupom_id` fica NULL). **Na aprovacao** `registrarUsoCupom` (que ja roda 1x por pagamento nos 3 caminhos, pelo marcador `liberado_em`) chama `aoAprovar`: reserva atomica `cadastrada -> comprou` (webhook repetido nao gera outra recompensa), reconfere o teto mensal (recusa com motivo `limite_mensal`), cria UM cupom unico do indicador (`IND` + 6, `max_usos 1`, validade da config, sem plano fixo), marca `recompensada` e avisa o indicador por WhatsApp (respeita recurso `whatsapp`, instancia conectada e lista nao perturbe; log `indicacao`). Limite: o cupom da recompensa nao e preso ao CPF do indicador (quem tiver o codigo, que so e enviado ao telefone dele, pode usar). `Revogar` desativa o cupom se `usos = 0`. A lista mostra o CPF do indicado mascarado (`123.***.***-45`) e o ranking dos que mais indicaram. Convite por WhatsApp e manual (botao, com confirmacao), recusa quem esta no nao perturbe. Auditoria: config, convite e revogar. Testes: `backend/tests/unit/indicacoes.test.js` (inclui PIX com valor adulterado). Nao validado contra MySQL/MP/Evolution reais.

---

## Asaas (PIX alternativo ao Mercado Pago)

Config por empresa em `empresa_configs` tipo `asaas` (`api_key`, `ambiente` producao|sandbox, `ativo` "1"/"0", `webhook_token` gerado no servidor; tela Configuracoes > Integracoes > Asaas, `ConfiguracaoAsaas.jsx`, API generica `/api/empresa-config/asaas` + `/asaas/testar`, `GET /asaas/webhook`, `POST /asaas/webhook/ativar`). PIX e cartao do portal de planos sao ligados separadamente: PIX com `ativo = "1"` (`asaasClient.pixAtivo`) e cartao com `cartao = "1"` (`cartaoAtivo`); o que estiver desligado segue 100% Mercado Pago. Sem Asaas ligado nada muda no fluxo do MP.
- **Geracao** (`pagamentoController.gerarPagamento`): exige CPF valido (o Asaas precisa de CPF/CNPJ do cliente); acha/cria o cliente por CPF com `notificationDisabled`, cria cobranca `PIX` (vencimento = hoje em Brasilia, `externalReference = pag_<id>_emp_<empresa>`) e le o QR (`/payments/{id}/pixQrCode`). O id da cobranca fica em `pagamentos.mp_pagamento_id` + `gateway='asaas'`, entao status/pix-trial/polling do portal funcionam sem mudanca. Erro do Asaas => pagamento `rejected` + 502 generico.
- **Confirmacao** (`services/asaasPagamento.confirmarPagamentoAsaas`): SEMPRE relê a cobranca no Asaas (corpo do webhook nao e confiavel), exige status `CONFIRMED`/`RECEIVED` (`RECEIVED_IN_CASH` = baixa manual, nao libera), `externalReference` e valor (centavos/100) iguais ao registro, aprova so quem nao esta `approved`/`expirado` e libera pelo marcador `liberado_em` (idempotente com webhook e polling). O Asaas nao diz quem pagou: grava `pagador_cpf = DESCONHECIDO` (nao confirma o CPF do cadastro, como PIX sem pagador no MP).
- **Webhook** `POST /api/pagamentos/asaas/webhook/:token` (publico): token de 48 hex por empresa identifica a tenant (desconhecido = 404); se vier o cabecalho `asaas-access-token` ele tem que bater. Responde 200 ao ignorar (para nao pausar a fila do Asaas). "Registrar webhook" chama `POST /v3/webhooks` com `authToken = webhook_token`. **Fallback:** `verificarStatusPagamento` confirma direto na API enquanto o pagamento esta `aguardando`, entao o portal libera mesmo se o webhook se perder.
- Limites: endpoints/campos do Asaas (`/finance/balance`, `/webhooks`, `/customers`, `pixQrCode`) seguem a documentacao e **nao foram testados contra o Asaas real** (so mocks; validar no sandbox); valor minimo/taxas sao do Asaas (o erro volta como falha de geracao); cupom reduz o valor cobrado normalmente. Teste: `backend/tests/unit/asaas.test.js`.
- **Cartao** (`gerarPagamentoCartao`, ramo `usarAsaas`): cobranca `CREDIT_CARD` a vista em `POST /payments` com `creditCard` + `creditCardHolderInfo` (titular do CARTAO: nome, CPF, CEP, numero do endereco; e-mail e telefone vem do lead, 400 se faltarem) e `remoteIp = req.ip`. Dados do cartao seguem direto ao Asaas, nunca vao ao banco nem ao log. `CONFIRMED`/`RECEIVED` => `confirmarComCredencial` (mesma validacao e liberacao idempotente) e resposta igual a do MP; `PENDING` => `pending` e o portal acompanha por `/status` (fallback + webhook); recusa (400 do Asaas) => `rejected` com a mensagem do Asaas. `GET /api/planos-publicos/:id` devolve `cartao_provider` (`asaas`|`mercadopago`): com `asaas` o `Pagamento.jsx` dispensa o fingerprint do MP e pede CEP + numero. Cartao nunca confirma o CPF do cadastro (`cpfConfirmado`). Nao testado contra o Asaas real.
- **Sino e engrenagem do hub:** na mesma linha das abas (canto direito, fora da rolagem das abas; o titulo "WhatsApp" virou `sr-only`), `AcoesDoCanto` em `WhatsAppHub.jsx`: **sino** liga/desliga o aviso de mensagem nova (`utils/avisoWhatsapp`, so neste navegador) e **engrenagem** abre o menu Nova conversa, Resposta automatica, Chatbot, Etiquetas e "Conexao e historico de envios" (link para `/whatsapp`). A barra de botoes que ficava dentro de `Atendimento.jsx` foi removida; a engrenagem manda um `pedido {modal}` ao `Atendimento` (props `pedido`/`onPedidoTratado`), que abre o modal ja existente — de outra aba o hub navega para Conversas antes.

---

## Painel por empresa (Super Admin)

Clicar no nome da empresa em `/super` ou `/super/empresas` abre `/super/empresas/:id` (`pages/super/EmpresaPainel.jsx`, `RotaDono`). API `/api/plataforma/empresas/:id/*` (`auth` + `exigeDonoPlataforma`, `empresaPainelController`; `:id` inteiro validado, empresa conferida): `GET` resumo em blocos que falham sozinhos (empresa, assinatura, adicionais, ultimas 20 cobrancas, uso 30 dias, alertas so dessa empresa, planos), `POST /plano` (troca mantendo o vencimento), `/gratificacao` (soma 1-365 dias; em trial prolonga o teste; plano gratis recusa), `/plano-gratis` (so plano com `saas_planos.gratis = 1`), `/plano-pago` (sai do gratis, ativa por N dias), `/status-assinatura`, `/suspender` e `/reativar` (`empresas.ativo`; recusa a empresa da plataforma `SITE_EMPRESA_ID` e a do proprio usuario; efeito em ate 60 s pelo cache de `sessaoAdmin`; nao derruba o Wi-Fi dos clientes finais), `GET/POST/DELETE /notas` (ate 1000 caracteres) e `GET /historico`. **Motivo (3-200 caracteres) e' obrigatorio em toda acao que mexe em plano, prazo ou acesso** e cada uma grava uma linha em `empresa_historico` (falha ao gravar nao desfaz a acao). A logica de assinatura e' a mesma da tela antiga: `assinaturaController.aplicarAssinatura(empresaId, dados)` (extraida de `definirAssinaturaEmpresa`, que continua igual). Regras puras (tempo de casa "2 anos e 3 meses", validacoes) em `utils/empresaPainel.js`. Testes: `backend/tests/unit/empresaPainel.test.js`. Nao testado contra MySQL real.
