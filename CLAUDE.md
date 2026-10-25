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
(Fonte: `radiusController.listarSessoesAtivas`; os JOINs usam `COLLATE utf8mb4_unicode_ci`. CPF vem de `leads`, nao de `lgpd_logins`.)

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
   - Resolve telefone na ordem: `telefone` explicito → `cliente_id` (leads) → `cpf` (leads) → `mac` (leads com origem='lgpd')
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
| Super admin | `admins` | `admin@empresa.com / admin123` (bcrypt) |
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
- Limites da grilagem: (1) **pagamento com CPF alheio — tratado:** `pagamentos.pagador_cpf` (migration 030) guarda o CPF de QUEM PAGOU (PIX: dado do banco no MP, `point_of_interaction.transaction_data.bank_info.payer` ou `payer.identification`, gravado no webhook, aceita mascara com `*`; cartao: CPF do titular informado no form) e `leadUtils.cpfConfirmado` so conta o pagamento se `pagador_cpf` for NULL (desconhecido, conta como antes) ou compativel com o CPF do cadastro (`utils/pagadorCpf.js`). Limites: o formato dos campos do MP no PIX nao foi validado contra um MP real (ausente = NULL = conta como antes); no cartao o CPF e' digitado, entao quem usa cartao proprio digitando o CPF da vitima ainda confirma; pai pagando pelo filho nao confirma o CPF do filho; pagamentos antigos (NULL) continuam contando; sem a migration 030 `cpfConfirmado` cai no catch e devolve `true`; (2) **acesso gratis exposto — tratado:** em CPF sem pagamento a data NAO prova nada (quem reivindica a grava e volta com ela), entao `leadUtils.podeReceberCredenciais` so devolve as credenciais de um acesso EXISTENTE (LGPD `lgpdLogin`, Lead `leadLogin`, auto-login do `cadastroCliente`) se o CPF e' confirmado por pagamento (a data basta, trava rigida) **ou** o aparelho (MAC) ja conectou com aquele username (`dispositivoJaUsouAcesso`: sessao no `radacct` com `callingstationid` = MAC). Os demais caem na re-liberacao (senha nova, franquia nova — nunca a senha antiga), que e' permitida por ser acesso gratis; e a resposta da re-liberacao traz `tratarSessaoAtiva` (aviso para desconectar a sessao em outro aparelho, senao o `Simultaneous-Use=1` recusaria o login novo). `POST /api/sessao/desconectar-anterior` aplica a mesma regra (`podeReceberCredenciais` ou `acessoEhGratis`) para nao derrubar acesso que nao seja o gratis; (3) a troca de dono apaga o contato anterior desse cadastro provisorio (o aceite LGPD do novo cadastrante o substitui; `[reivindicacao-cpf]` fica no log sem CPF).

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

`CadastroLGPD.jsx` (`/cadastro`) e `CadastroLead.jsx` (`/lead`) mostram so CPF + data de nascimento (`components/public/BuscaCpf.jsx`, botao "Continuar"); o restante do formulario (nome, e-mail, telefone, MAC/IP, aceite, botao final) so aparece depois da busca (`POST /api/lgpd/consulta-cpf`): achou + "Sim, sou eu" = formulario preenchido (nome, telefone e e-mail via `confirmar:true`); nao achou/erro = formulario em branco; 429 = nao libera. Mudar CPF ou data esconde o restante e limpa os dados trazidos de outro cadastro. Lead sem CPF (`exibir_cpf=false`) mostra tudo direto. As regras de titularidade (`conferirDataNascimento`, reivindicacao, re-liberacao) continuam todas no servidor (`lgpdLogin`/`leadLogin`).

---

## Sessao simultanea: desconectar o outro aparelho

`Simultaneous-Use=1` faz o FreeRADIUS recusar o login de quem ja esta conectado em outro aparelho (o MikroTik nao explica o motivo). Nos portais LGPD e Lead (`CadastroLGPD.jsx`, `CadastroLead.jsx`), na reconexao com saldo, `utils/sessaoAtiva.tratarSessaoAtiva` olha o `radacct` aberto do username (ignora sessoes sem update ha >15 min, restrito a empresa): **mesmo MAC** = sessao velha, desconecta sozinho; **outro MAC** = a resposta traz `requer_desconexao:true` + `sessao_ativa` (so os 2 ultimos bytes do MAC) e o portal mostra `SessaoAtivaAviso.jsx` ("Desconectar o outro e conectar aqui" / "Cancelar"). A confirmacao chama `POST /api/sessao/desconectar-anterior` (publico, `cpfLookupLimiters`): exige CPF + data de nascimento com `conferirDataNascimento === 'ok'` (nunca `reivindicado`/`ausente`), empresa vinda do `mikrotik_id` e username do proprio titular (CPF ou telefone/e-mail/MAC do lead). `desconectarSessao`: Disconnect-Request via `radclient` (`coa.desconectarSessaoCoA`, porta 3799) -> fallback API do MikroTik (so `/ip/hotspot/active` do usuario) -> espera o Accounting-Stop (4 s) e, se nao chegar, fecha a linha (`Admin-Reset`). **Nunca apaga radcheck/radreply/radius_users** (o saldo continua). Sem metodo que funcione (ex.: Omada External RADIUS, Grandstream) = `ok:false` e a linha NAO e fechada. Fora do escopo (fase 2): pagamento PIX/cartao e `LoginHotspot.jsx`. Testes: `backend/tests/unit/sessaoAtiva.test.js`. Nao testado contra um MikroTik real (so mocks).

---

## Cadastro completo de clientes e importacao (SGP / planilha)

Tela `Clientes` (`frontend/src/pages/admin/Leads.jsx`, rota `/admin/:slug/leads`) edita o cadastro completo em `leads`. Importacao em `/admin/:slug/importar-clientes` (`ImportarClientes.jsx`), API `/api/clientes-import` (permissao do modulo `leads`).

- **Cadastro manual (tela Clientes) exige Nome, CPF (PF) ou CNPJ (PJ), E-mail, Data de nascimento e Telefone** (`utils/cadastroObrigatorio.js`, validado no front e em `leadController.criarLead/atualizarLead`; edicao que so troca `status`/`observacoes` nao exige). A importacao em massa e os portais NAO passam por essa regra.
- Logica: `backend/src/utils/importCadastros.js` (mapeamento, normalizacao, `processarImportacao`, parse CSV/XLSX) e `backend/src/utils/sgpClient.js` (config por empresa em `empresa_configs` tipo `sgp`; `testar`, `amostra` mascarada, `buscarTodos`).
- **Integracao SGP fica em Configuracoes > Integracoes > SGP** (`Integracoes.jsx`, `IntegracaoSgp.jsx`; rotas `/admin/:slug/integracoes[/sgp]`), API `/api/integracoes/sgp/{,testar,amostra,importar}` (modulo `configuracoes`; controller `integracaoController.js`). Fluxo da tela: salvar -> testar conexao (HTTP + campos recebidos + mapeamento) -> ver amostra mascarada -> simular -> importar. A aba SGP de *Importar clientes* so aponta para la.
- **CPF/CNPJ existente: so preenche campos vazios** (`COALESCE(NULLIF(col,''), ?)`); nunca toca `lgpd_aceite`/`lgpd_termo`/`status`/CPF. Importados entram com `origem='importacao'`, `lgpd_aceite=0`.
- Importar `data_nascimento` torna o lead localizavel por CPF+data em `/api/lgpd/consulta-cpf`.
- **SGP:** o endpoint padrao (`/api/ura/clientes/`) e o formato da resposta NAO foram validados contra um SGP real (so contra um SGP simulado em `sgpIntegracao.test.js`); o cliente aceita a lista em `clientes|results|data|items` e achata objetos aninhados. Ajustar o campo "Endpoint" na tela se a versao do SGP for diferente. A URL e validada contra destinos internos (SSRF) no controller; erros do SGP viram mensagens seguras (`SgpError`), sem app/token.
- Testes: `backend/tests/unit/importCadastros.test.js`, `backend/tests/unit/sgpIntegracao.test.js`.

---

## Site institucional Apex Telecom (pagina inicial)

- `/` agora e a landing page `frontend/src/pages/public/ApexHome.jsx` (planos de EXEMPLO na constante `PLANOS`, WhatsApp/contatos placeholders); o login admin passou para `/login`. Todo redirect de "nao autenticado" aponta para `/login`.
- Pedido de contratacao: `POST /api/site/pedido` (`siteController.criarPedido`, limiter `sitePedidoLimiter` 10/h por IP, honeypot `website`). Grava em `leads` com `origem='site'`, endereco (migration 029), `lgpd_termo` via `resolverTextoLgpd` e plano em `observacoes`.
- `empresa_id` vem de `SITE_EMPRESA_ID` no `.env` (default 1), NUNCA do body. CPF ja existente so recebe nova linha em `observacoes` (nao sobrescreve cadastro de hotspot).
- Teste: `backend/tests/unit/siteController.test.js`.
