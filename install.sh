#!/bin/bash

# Parar na primeira falha critica
set -euo pipefail

# Evitar dialogos interativos do apt (kernel upgrade, etc)
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

# Funcao para exibir erros
error_exit() {
  echo ""
  echo "ERRO: $1"
  echo "Instalacao interrompida na etapa: $2"
  echo "Corrija o problema e execute o script novamente."
  exit 1
}

# Funcao para verificar se comando anterior teve sucesso
check_step() {
  if [ $? -ne 0 ]; then
    error_exit "$1" "$2"
  fi
}

# Verificar privilegios de root
if [ "$EUID" -ne 0 ]; then
  echo "Este script deve ser executado como root (sudo)."
  exit 1
fi

echo "=========================================================="
echo "    INSTALADOR GLOBAL - HOTSPOT, RADIUS & EVOLUTION       "
echo "=========================================================="
echo ""

# ============================================================
# 1. MODO DE INSTALACAO
# ============================================================
echo "Selecione o modo de instalacao:"
echo ""
echo "  1) VPS com IP publico (direto na internet)"
echo "     - Nginx + Certbot para SSL"
echo "     - WireGuard com IP publico do servidor"
echo "     - Firewall UFW configurado"
echo ""
echo "  2) Servidor com IP privado (atras de Traefik/proxy reverso)"
echo "     - Nginx escuta em porta interna"
echo "     - SSL gerenciado pelo Traefik externo"
echo "     - WireGuard precisa de IP publico do host/roteador"
echo "     - Sem UFW (rede interna)"
echo ""
read -p "Escolha [1/2]: " INSTALL_MODE
if [[ "$INSTALL_MODE" != "1" && "$INSTALL_MODE" != "2" ]]; then
  echo "Erro: Escolha 1 ou 2."
  exit 1
fi

# ============================================================
# 2. PERGUNTAS INTERATIVAS
# ============================================================
read -p "Dominio do Painel/Hotspot (ex: painel.empresa.com.br): " DOMAIN_HOTSPOT
if [ -z "$DOMAIN_HOTSPOT" ]; then
  echo "Erro: Dominio do Hotspot e obrigatorio."
  exit 1
fi

read -p "Dominio da Evolution API (ex: mkt.empresa.com.br): " DOMAIN_EVOLUTION
if [ -z "$DOMAIN_EVOLUTION" ]; then
  echo "Erro: Dominio da Evolution API e obrigatorio."
  exit 1
fi

read -p "Email para registro (usado no Certbot se VPS): " SSL_EMAIL
if [ -z "$SSL_EMAIL" ]; then
  echo "Erro: Email e obrigatorio."
  exit 1
fi

# --- IP publico ---
if [ "$INSTALL_MODE" = "1" ]; then
  DETECTED_IP=$(curl -s -4 --connect-timeout 5 ifconfig.me 2>/dev/null || curl -s -4 --connect-timeout 5 icanhazip.com 2>/dev/null || echo "")
  if [ -n "$DETECTED_IP" ]; then
    read -p "IP publico da VPS (detectado: ${DETECTED_IP}): " PUBLIC_IP
    PUBLIC_IP=${PUBLIC_IP:-$DETECTED_IP}
  else
    read -p "IP publico da VPS: " PUBLIC_IP
  fi
else
  echo ""
  echo "O servidor esta atras de proxy. O WireGuard precisa do IP publico"
  echo "do host onde o Traefik roda (ou do roteador com port-forward)."
  read -p "IP publico do host/roteador externo: " PUBLIC_IP
fi
if [ -z "$PUBLIC_IP" ]; then
  echo "Erro: IP publico e obrigatorio (necessario para WireGuard)."
  exit 1
fi

# --- Perguntas por modo ---
if [ "$INSTALL_MODE" = "1" ]; then
  read -p "Gerar certificado SSL com Certbot? (s/n) [s]: " INSTALL_SSL
  INSTALL_SSL=${INSTALL_SSL:-s}
  NGINX_LISTEN_PORT="80"
  NGINX_EVO_PORT="80"
else
  INSTALL_SSL="n"
  read -p "Porta interna do Nginx para Hotspot [8080]: " NGINX_LISTEN_PORT
  NGINX_LISTEN_PORT=${NGINX_LISTEN_PORT:-8080}
  read -p "Porta interna do Nginx para Evolution [8090]: " NGINX_EVO_PORT
  NGINX_EVO_PORT=${NGINX_EVO_PORT:-8090}
  echo ""
  echo "Configure o Traefik para encaminhar:"
  echo "  ${DOMAIN_HOTSPOT}    -> este servidor:${NGINX_LISTEN_PORT}"
  echo "  ${DOMAIN_EVOLUTION}  -> este servidor:${NGINX_EVO_PORT}"
  echo ""
fi

read -p "Porta do backend Node.js [3001]: " BACKEND_PORT
BACKEND_PORT=${BACKEND_PORT:-3001}

read -p "Porta do painel WireGuard [51821]: " WG_PANEL_PORT
WG_PANEL_PORT=${WG_PANEL_PORT:-51821}

read -p "Porta VPN WireGuard [51820]: " WG_VPN_PORT
WG_VPN_PORT=${WG_VPN_PORT:-51820}

# Detectar porta SSH (essencial pra nao perder conexao quando UFW ligar)
SSH_PORT_DETECTED=""
# 1) tenta pela conexao SSH atual (mais confiavel)
if [ -n "${SSH_CONNECTION:-}" ]; then
  SSH_PORT_DETECTED=$(echo "$SSH_CONNECTION" | awk '{print $4}' || true)
fi
# 2) fallback: le do sshd_config (|| true pq sshd_config padrao vem com "#Port 22" comentado,
#    grep vazio + pipefail + set -e mata o script silenciosamente)
if [ -z "$SSH_PORT_DETECTED" ] && [ -f /etc/ssh/sshd_config ]; then
  SSH_PORT_DETECTED=$(grep -E "^[[:space:]]*Port[[:space:]]+[0-9]+" /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}' | head -1 || true)
fi
# 3) fallback final: porta padrao
SSH_PORT_DETECTED=${SSH_PORT_DETECTED:-22}

echo ""
echo "ATENCAO: O firewall UFW sera habilitado. Se a porta SSH estiver errada, voce PERDE a conexao."
read -p "Porta SSH para liberar no firewall [${SSH_PORT_DETECTED}]: " SSH_PORT
SSH_PORT=${SSH_PORT:-$SSH_PORT_DETECTED}

# ============================================================
# 3. GERAR SENHAS ALEATORIAS
# ============================================================
echo ""
echo "Gerando credenciais seguras..."

generate_password() {
  openssl rand -base64 32 | tr -d '/+=' | head -c "$1"
}

MYSQL_PASS=$(generate_password 24)
JWT_SECRET=$(generate_password 48)
EVO_API_KEY=$(generate_password 32)
WG_PASS=$(generate_password 16)
ADMIN_PASS=$(generate_password 14)
POSTGRES_PASS=$(generate_password 24)

echo ""
echo "============================================================"
echo "  CREDENCIAIS GERADAS (SALVE EM LOCAL SEGURO!)              "
echo "============================================================"
echo "  Modo:               $([ "$INSTALL_MODE" = "1" ] && echo "VPS IP publico" || echo "Atras de Traefik")"
echo "  MySQL Password:     ${MYSQL_PASS}"
echo "  JWT Secret:         ${JWT_SECRET}"
echo "  Evolution API Key:  ${EVO_API_KEY}"
echo "  WireGuard Password: ${WG_PASS}"
echo "  PostgreSQL Password:${POSTGRES_PASS}"
echo "  Dominio Hotspot:    ${DOMAIN_HOTSPOT}"
echo "  Dominio Evolution:  ${DOMAIN_EVOLUTION}"
echo "  IP Publico:         ${PUBLIC_IP}"
echo "============================================================"
echo ""
read -p "Pressione ENTER para continuar ou Ctrl+C para cancelar..."

# Desabilitar set -e temporariamente para etapas que podem falhar parcialmente
set +e

# ============================================================
# 4. ATUALIZACOES E DEPENDENCIAS
# ============================================================
echo ""
echo "==> [1/16] Instalando pacotes do sistema..."
apt update -y
apt upgrade -y

# Pacotes base
apt install -y curl wget unzip git software-properties-common \
  nginx mysql-server \
  freeradius freeradius-mysql freeradius-utils \
  wireguard-tools python3-bcrypt

if [ "$INSTALL_MODE" = "1" ]; then
  apt install -y certbot python3-certbot-nginx
fi

# ============================================================
# 5. INSTALAR NODE.JS 20
# ============================================================
echo ""
echo "==> [2/16] Instalando Node.js..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi
if ! command -v node &>/dev/null; then
  error_exit "Node.js nao foi instalado corretamente" "Node.js"
fi
echo "  Node.js $(node -v) instalado"

npm install -g pm2
echo "  PM2 instalado"

# ============================================================
# 6. INSTALAR DOCKER
# ============================================================
echo ""
echo "==> [3/16] Instalando Docker..."
if ! command -v docker &>/dev/null; then
  echo "  Docker nao encontrado, instalando..."
  # Metodo 1: via apt (mais confiavel no Ubuntu 24.04)
  apt install -y docker.io docker-compose-plugin 2>/dev/null

  # Se nao instalou via apt, tentar script oficial
  if ! command -v docker &>/dev/null; then
    echo "  apt falhou, tentando script oficial..."
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sh /tmp/get-docker.sh || true
    rm -f /tmp/get-docker.sh
  fi
fi

# Verificar se Docker esta disponivel
if ! command -v docker &>/dev/null; then
  echo ""
  echo "  AVISO: Docker NAO foi instalado!"
  echo "  WireGuard e Evolution API NAO vao funcionar."
  echo "  Instale manualmente depois: apt install docker.io docker-compose-plugin"
  echo ""
  DOCKER_OK=false
else
  # Garantir que Docker esta rodando
  systemctl enable docker 2>/dev/null
  systemctl start docker 2>/dev/null
  echo "  Docker $(docker --version | awk '{print $3}') instalado"

  # Verificar se docker compose (plugin) funciona
  if docker compose version &>/dev/null; then
    echo "  Docker Compose plugin OK"
    DOCKER_OK=true
  elif command -v docker-compose &>/dev/null; then
    echo "  docker-compose standalone encontrado"
    DOCKER_OK=true
    # Criar alias para compatibilidade
    alias docker\ compose='docker-compose'
  else
    echo "  Instalando docker-compose-plugin..."
    apt install -y docker-compose-plugin 2>/dev/null || true
    if docker compose version &>/dev/null; then
      echo "  Docker Compose plugin instalado"
      DOCKER_OK=true
    else
      echo "  AVISO: Docker Compose nao disponivel!"
      DOCKER_OK=false
    fi
  fi
fi

# ============================================================
# 7. EXTRACAO DOS ARQUIVOS
# ============================================================
echo ""
echo "==> [4/16] Extraindo arquivos..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f freeradius.zip || ! -f hotspot.zip ]]; then
  error_exit "freeradius.zip ou hotspot.zip nao encontrados em ${SCRIPT_DIR}" "Extracao"
fi

unzip -o freeradius.zip -d freeradius_conf
unzip -o hotspot.zip -d hotspot_temp
echo "  Arquivos extraidos"

# ============================================================
# 8. FREERADIUS
# ============================================================
echo ""
echo "==> [5/16] Configurando FreeRADIUS..."
if [ -d "freeradius_conf/freeradius/3.0" ]; then
  cp -r freeradius_conf/freeradius/3.0/* /etc/freeradius/3.0/
fi
ln -sf /etc/freeradius/3.0/mods-available/sql /etc/freeradius/3.0/mods-enabled/sql

FREERADIUS_SQL="/etc/freeradius/3.0/mods-available/sql"
if [ -f "$FREERADIUS_SQL" ]; then
  sed -i "s|password = \".*\"|password = \"${MYSQL_PASS}\"|" "$FREERADIUS_SQL"
  sed -i "s|login = \".*\"|login = \"hotspotuser\"|" "$FREERADIUS_SQL"
  sed -i "s|radius_db = \".*\"|radius_db = \"hotspot\"|" "$FREERADIUS_SQL"
  echo "  Credenciais SQL atualizadas"
fi

# Habilitar sqlcounter
if [ -f "/etc/freeradius/3.0/mods-available/sqlcounter" ]; then
  cp -f /etc/freeradius/3.0/mods-available/sqlcounter /etc/freeradius/3.0/mods-enabled/sqlcounter 2>/dev/null
fi

# Habilitar CoA
if [ -f "/etc/freeradius/3.0/sites-available/coa" ]; then
  ln -sf /etc/freeradius/3.0/sites-available/coa /etc/freeradius/3.0/sites-enabled/coa
fi

# Corrigir permissoes (CRITICO - sem isso FreeRADIUS nao inicia)
chown -R freerad:freerad /etc/freeradius/3.0/
echo "  Permissoes corrigidas"

# Testar config antes de reiniciar
echo "  Testando configuracao..."
if freeradius -XC 2>&1 | tail -1 | grep -q "Configuration appears to be OK"; then
  echo "  Configuracao OK"
else
  echo "  AVISO: Teste de configuracao pode ter problemas"
  echo "  Rode 'freeradius -X' para debug"
fi

# ============================================================
# 9. CODIGO FONTE
# ============================================================
echo ""
echo "==> [6/16] Instalando codigo fonte..."
rm -rf /var/www/hotspot
mv hotspot_temp/hotspot /var/www/hotspot
echo "  Instalado em /var/www/hotspot"

# ============================================================
# 10. BANCO DE DADOS MYSQL
# ============================================================
echo ""
echo "==> [7/16] Configurando MySQL..."

# Garantir que MySQL esta rodando
systemctl enable mysql 2>/dev/null
systemctl start mysql 2>/dev/null

# Configurar root (MySQL recem instalado pode ter auth via socket)
mysql -uroot -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${MYSQL_PASS}';" 2>/dev/null
if [ $? -ne 0 ]; then
  # Tentar sem senha (MySQL recem instalado)
  mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${MYSQL_PASS}';" 2>/dev/null
  if [ $? -ne 0 ]; then
    echo "  AVISO: Nao foi possivel alterar senha do root MySQL"
    echo "  Tentando autenticacao via socket..."
  fi
fi

mysql -uroot -p"${MYSQL_PASS}" -e "CREATE DATABASE IF NOT EXISTS hotspot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null
mysql -uroot -p"${MYSQL_PASS}" -e "CREATE USER IF NOT EXISTS 'hotspotuser'@'localhost' IDENTIFIED BY '${MYSQL_PASS}';" 2>/dev/null
mysql -uroot -p"${MYSQL_PASS}" -e "GRANT ALL PRIVILEGES ON hotspot.* TO 'hotspotuser'@'localhost'; FLUSH PRIVILEGES;" 2>/dev/null

if [ -f "/var/www/hotspot/backend/jobs/estrutura.sql" ]; then
  echo "  Importando estrutura do banco..."
  mysql -u hotspotuser -p"${MYSQL_PASS}" hotspot < /var/www/hotspot/backend/jobs/estrutura.sql 2>&1
  if [ $? -eq 0 ]; then
    echo "  Banco importado com sucesso"
  else
    echo "  ERRO ao importar banco! Verifique o log acima."
  fi
fi

# Verificar se seed foi inserido
ADMIN_COUNT=$(mysql -u hotspotuser -p"${MYSQL_PASS}" hotspot -sN -e "SELECT COUNT(*) FROM admins;" 2>/dev/null || echo "0")
if [ "$ADMIN_COUNT" -gt 0 ]; then
  echo "  Admin seed OK (${ADMIN_COUNT} admin(s))"
else
  echo "  AVISO: Admin nao foi criado. Login pode falhar."
fi

# ============================================================
# 11. BACKEND
# ============================================================
echo ""
echo "==> [8/16] Configurando backend..."
cd /var/www/hotspot/backend

cat > .env <<EOF
PORT=${BACKEND_PORT}
DB_HOST=127.0.0.1
DB_USER=hotspotuser
DB_PASSWORD=${MYSQL_PASS}
DB_NAME=hotspot
JWT_SECRET=${JWT_SECRET}

# Dominio do sistema (usado nos redirects do hotspot/MikroTik)
SYSTEM_DOMAIN=${DOMAIN_HOTSPOT}

# Email do Let's Encrypt (dominio proprio de empresas, emitido pelo painel via certbot)
SSL_EMAIL=${SSL_EMAIL}

# Evolution API (WhatsApp)
EVOLUTION_API_URL=http://127.0.0.1:8080
EVOLUTION_API_KEY=${EVO_API_KEY}
EVOLUTION_INSTANCE=hotspot

# WireGuard
WG_HOST=${PUBLIC_IP}
WG_PASS=${WG_PASS}
WG_PANEL_PORT=${WG_PANEL_PORT}

# Sistema de Atualizacoes OTA
UPDATE_SERVER_URL=https://glpi.forumtelecom.com.br
EOF
chmod 600 .env
echo "  .env gerado (permissao 600)"

echo "  Instalando dependencias (npm install)..."
npm install --production 2>&1 | tail -1
echo "  Dependencias instaladas"

echo "  Criando diretorio de backups..."
mkdir -p /var/www/hotspot/backups

echo "  Criando diretorio de uploads de campanhas..."
mkdir -p /var/www/hotspot/backend/uploads/campanhas

echo "  Rodando migrations incrementais (001..N)..."
for migration in $(ls migrations/[0-9][0-9][0-9]_*.js 2>/dev/null | sort); do
  nome=$(basename "$migration")
  echo "    -> $nome"
  node "$migration" 2>&1 | tail -1 || true
done

# Senha do super admin: aleatoria (o seed traz admin123, publico). Falhou = mantem o seed e avisa.
echo "  Definindo senha aleatoria do admin..."
ADMIN_HASH=$(ADMIN_PASS="$ADMIN_PASS" node -e 'process.stdout.write(require("bcryptjs").hashSync(process.env.ADMIN_PASS, 10))' 2>/dev/null)
if [ -n "$ADMIN_HASH" ] && mysql -u hotspotuser -p"${MYSQL_PASS}" hotspot -e "UPDATE admins SET password='${ADMIN_HASH}' WHERE email='admin@empresa.com'" 2>/dev/null; then
  echo "  Senha do admin definida (consta em /root/hotspot-credenciais.txt)"
else
  ADMIN_PASS="admin123"
  echo "  AVISO: nao foi possivel definir a senha do admin; a senha padrao (admin123) continua ativa. TROQUE no primeiro acesso!"
fi

echo "  Iniciando com PM2..."
pm2 delete hotspot-api 2>/dev/null || true
pm2 start server.js --name hotspot-api
pm2 save
pm2 startup 2>/dev/null || true
echo "  Backend rodando na porta ${BACKEND_PORT}"

# ============================================================
# 12. FRONTEND
# ============================================================
echo ""
echo "==> [9/16] Buildando frontend..."
cd /var/www/hotspot/frontend
# Mantem o package-lock.json (build reprodutivel / sem puxar versao nova nao auditada)
rm -rf node_modules dist
if [ -f package-lock.json ]; then npm ci 2>&1 | tail -1; else npm install 2>&1 | tail -1; fi
NODE_OPTIONS=--max-old-space-size=4096 npm run build 2>&1 | tail -3
if [ -d "dist" ]; then
  echo "  Frontend buildado com sucesso"
else
  echo "  ERRO: Build do frontend falhou!"
fi

# ============================================================
# 13. DOCKER - EVOLUTION API
# ============================================================
echo ""
echo "==> [10/16] Configurando Evolution API..."
if [ "$DOCKER_OK" = true ]; then
  mkdir -p /var/www/evolution-api
  cat > /var/www/evolution-api/docker-compose.yaml <<EOF
services:
  evolution-api:
    image: evoapicloud/evolution-api:v2.3.7
    container_name: evolution-api
    restart: always
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      - SERVER_URL=https://${DOMAIN_EVOLUTION}
      - DOCKER_ENV=true
      - DATABASE_PROVIDER=postgresql
      - DATABASE_CONNECTION_URI=postgresql://evolution:${POSTGRES_PASS}@postgres:5432/evolution_db?schema=public
      - CACHE_REDIS_ENABLED=false
      - AUTHENTICATION_API_KEY=${EVO_API_KEY}
    depends_on:
      - postgres
  postgres:
    image: postgres:15-alpine
    container_name: evolution-postgres
    restart: always
    environment:
      - POSTGRES_USER=evolution
      - POSTGRES_PASSWORD=${POSTGRES_PASS}
      - POSTGRES_DB=evolution_db
    volumes:
      - evolution-db-data:/var/lib/postgresql/data
volumes:
  evolution-db-data:
EOF

  cd /var/www/evolution-api
  echo "  Baixando imagens Docker (pode demorar)..."
  PULL_OK=false
  for tentativa in 1 2 3 4 5; do
    echo "  Tentativa $tentativa/5 de download da imagem..."
    if docker compose pull 2>&1 | tail -2; then
      PULL_OK=true
      break
    fi
    echo "  Falhou. Aguardando 10s antes de tentar novamente..."
    sleep 10
  done
  if [ "$PULL_OK" = true ]; then
    docker compose up -d 2>&1
    if [ $? -eq 0 ]; then
      echo "  Evolution API iniciada"
    else
      echo "  ERRO ao iniciar Evolution API (containers falharam)"
    fi
  else
    echo "  ERRO: nao foi possivel baixar a imagem apos 5 tentativas."
    echo "  Verifique a conexao com a internet e rode manualmente:"
    echo "    cd /var/www/evolution-api && docker compose pull && docker compose up -d"
  fi
else
  echo "  PULADO - Docker nao disponivel"
fi

# ============================================================
# 14. DOCKER - WIREGUARD
# ============================================================
echo ""
echo "==> [11/16] Configurando WireGuard..."
WG_COMPOSE="/var/www/hotspot/infra/wireguard/docker-compose.yml"

if [ "$DOCKER_OK" = true ] && [ -d "/var/www/hotspot/infra/wireguard" ]; then

  # Gerar hash bcrypt para WireGuard
  echo "  Gerando hash da senha..."
  apt install -y python3-bcrypt 2>/dev/null | tail -1
  WG_PASS_HASH=$(python3 -c "import bcrypt; print(bcrypt.hashpw(b'${WG_PASS}', bcrypt.gensalt(12)).decode())" 2>/dev/null || echo "")

  if [ -z "$WG_PASS_HASH" ]; then
    echo "  AVISO: Nao conseguiu gerar hash bcrypt."
    echo "  Apos instalar, gere manualmente:"
    echo "    python3 -c \"import bcrypt; print(bcrypt.hashpw(b'SUA_SENHA', bcrypt.gensalt(12)).decode())\""
    WG_PASS_HASH='$2b$12$placeholder'
  else
    echo "  Hash gerado com sucesso"
  fi

  # Escapar $ -> $$ para docker-compose
  WG_PASS_HASH_ESC=$(echo "$WG_PASS_HASH" | sed 's/\$/\$\$/g')

  # Limpar configs do servidor anterior
  rm -rf /var/www/hotspot/infra/wireguard/.wg-easy

  # Escrever docker-compose com placeholder (sem heredoc para evitar problemas de $)
  if [ "$INSTALL_MODE" = "1" ]; then
    cat > "$WG_COMPOSE" <<'WGEOF'
services:
  wg-easy:
    network_mode: "host"
    environment:
      - WG_HOST=__WG_HOST__
      - PASSWORD_HASH=__WG_HASH__
      - PORT=__WG_PANEL_PORT__
      - WG_PORT=__WG_VPN_PORT__
    image: ghcr.io/wg-easy/wg-easy
    container_name: wg-easy
    restart: unless-stopped
    volumes:
      - ./.wg-easy:/etc/wireguard
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
WGEOF
  else
    cat > "$WG_COMPOSE" <<'WGEOF'
services:
  wg-easy:
    environment:
      - WG_HOST=__WG_HOST__
      - PASSWORD_HASH=__WG_HASH__
      - PORT=__WG_PANEL_PORT__
      - WG_PORT=__WG_VPN_PORT__
    image: ghcr.io/wg-easy/wg-easy
    container_name: wg-easy
    restart: unless-stopped
    ports:
      - "__WG_VPN_PORT__:__WG_VPN_PORT__/udp"
      - "__WG_PANEL_PORT__:__WG_PANEL_PORT__/tcp"
    volumes:
      - ./.wg-easy:/etc/wireguard
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    sysctls:
      - net.ipv4.ip_forward=1
      - net.ipv4.conf.all.src_valid_mark=1
WGEOF
  fi

  # Substituir placeholders com valores reais (sed nao tem problema com $$ pois le do arquivo)
  sed -i "s|__WG_HOST__|${PUBLIC_IP}|g" "$WG_COMPOSE"
  sed -i "s|__WG_HASH__|${WG_PASS_HASH_ESC}|g" "$WG_COMPOSE"
  sed -i "s|__WG_PANEL_PORT__|${WG_PANEL_PORT}|g" "$WG_COMPOSE"
  sed -i "s|__WG_VPN_PORT__|${WG_VPN_PORT}|g" "$WG_COMPOSE"

  echo "  Hash no arquivo: $(grep PASSWORD_HASH "$WG_COMPOSE" | sed 's/.*PASSWORD_HASH=//')"

  cd /var/www/hotspot/infra/wireguard
  echo "  Baixando imagem WireGuard..."
  docker compose pull 2>&1 | tail -1
  docker compose up -d 2>&1
  if [ $? -eq 0 ]; then
    echo "  WireGuard iniciado"
    sleep 3
    # Testar login
    WG_TEST=$(curl -s -X POST http://localhost:${WG_PANEL_PORT}/api/session -H "Content-Type: application/json" -d "{\"password\":\"${WG_PASS}\"}" 2>/dev/null || echo "")
    if echo "$WG_TEST" | grep -q '"success":true'; then
      echo "  Login WireGuard OK"
    else
      echo "  AVISO: Login WireGuard falhou. Verifique hash manualmente."
    fi
  else
    echo "  ERRO ao iniciar WireGuard"
  fi
else
  if [ "$DOCKER_OK" != true ]; then
    echo "  PULADO - Docker nao disponivel"
  else
    echo "  PULADO - Pasta infra/wireguard nao encontrada"
  fi
fi

# ============================================================
# 15. NGINX
# ============================================================
echo ""
echo "==> [12/16] Configurando Nginx..."

# Cabecalhos de seguranca (snippet incluido nos blocos server e nas locations estaticas, porque
# add_header numa location descarta os herdados). Mesmos valores do helmet do backend (sem duplicar conflito).
mkdir -p /etc/nginx/snippets
cat > /etc/nginx/snippets/hotspot-security.conf <<'SECEOF'
server_tokens off;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
SECEOF

if [ "$INSTALL_MODE" = "1" ]; then
  cat > /etc/nginx/sites-available/hotspot <<EOF
server {
    listen 80 default_server;
    server_name ${DOMAIN_HOTSPOT};

    root /var/www/hotspot/frontend/dist;
    index index.html;
    client_max_body_size 10M;
    include /etc/nginx/snippets/hotspot-security.conf;

    # Assets hasheados do Vite: cache longo e imutavel
    location /assets/ {
        expires 1y;
        include /etc/nginx/snippets/hotspot-security.conf;
        add_header Cache-Control "public, immutable, max-age=31536000";
        try_files \$uri =404;
    }

    # index.html nunca cacheado (essencial pro sistema de updates)
    location = /index.html {
        include /etc/nginx/snippets/hotspot-security.conf;
        add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0";
        add_header Pragma "no-cache";
        expires off;
    }

    location / {
        try_files \$uri /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:${BACKEND_PORT}/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_read_timeout 180s;
        proxy_connect_timeout 30s;
        proxy_send_timeout 180s;
    }

    location /hotspot/ {
        proxy_pass http://localhost:${BACKEND_PORT}/hotspot/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
    }

    # Uploads de campanhas (pre-portal): servidos pelo backend
    location /uploads/campanhas/ {
        alias /var/www/hotspot/backend/uploads/campanhas/;
        expires 1d;
        include /etc/nginx/snippets/hotspot-security.conf;
        add_header Cache-Control "public, max-age=86400";
        try_files \$uri =404;
    }

    location /uploads/ {
        alias /var/www/hotspot/frontend/dist/uploads/;
        expires 30d;
        include /etc/nginx/snippets/hotspot-security.conf;
        add_header Cache-Control "public, immutable";
    }
}
EOF

  cat > /etc/nginx/sites-available/evolution-api <<EOF
server {
    listen 80;
    server_name ${DOMAIN_EVOLUTION};

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

else
  cat > /etc/nginx/sites-available/hotspot <<EOF
server {
    listen ${NGINX_LISTEN_PORT};
    server_name ${DOMAIN_HOTSPOT} _;

    root /var/www/hotspot/frontend/dist;
    index index.html;
    client_max_body_size 10M;
    include /etc/nginx/snippets/hotspot-security.conf;

    set_real_ip_from 10.0.0.0/8;
    set_real_ip_from 172.16.0.0/12;
    set_real_ip_from 192.168.0.0/16;
    real_ip_header X-Forwarded-For;
    real_ip_recursive on;

    # Assets hasheados do Vite: cache longo e imutavel
    location /assets/ {
        expires 1y;
        include /etc/nginx/snippets/hotspot-security.conf;
        add_header Cache-Control "public, immutable, max-age=31536000";
        try_files \$uri =404;
    }

    # index.html nunca cacheado (essencial pro sistema de updates)
    location = /index.html {
        include /etc/nginx/snippets/hotspot-security.conf;
        add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0";
        add_header Pragma "no-cache";
        expires off;
    }

    location / {
        try_files \$uri /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:${BACKEND_PORT}/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_read_timeout 180s;
        proxy_connect_timeout 30s;
        proxy_send_timeout 180s;
    }

    location /hotspot/ {
        proxy_pass http://localhost:${BACKEND_PORT}/hotspot/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
    }

    # Uploads de campanhas (pre-portal): servidos pelo backend
    location /uploads/campanhas/ {
        alias /var/www/hotspot/backend/uploads/campanhas/;
        expires 1d;
        include /etc/nginx/snippets/hotspot-security.conf;
        add_header Cache-Control "public, max-age=86400";
        try_files \$uri =404;
    }

    location /uploads/ {
        alias /var/www/hotspot/frontend/dist/uploads/;
        expires 30d;
        include /etc/nginx/snippets/hotspot-security.conf;
        add_header Cache-Control "public, immutable";
    }
}
EOF

  cat > /etc/nginx/sites-available/evolution-api <<EOF
server {
    listen ${NGINX_EVO_PORT};
    server_name ${DOMAIN_EVOLUTION} _;

    set_real_ip_from 10.0.0.0/8;
    set_real_ip_from 172.16.0.0/12;
    set_real_ip_from 192.168.0.0/16;
    real_ip_header X-Forwarded-For;
    real_ip_recursive on;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
fi

ln -sf /etc/nginx/sites-available/hotspot /etc/nginx/sites-enabled/hotspot
ln -sf /etc/nginx/sites-available/evolution-api /etc/nginx/sites-enabled/evolution-api
rm -f /etc/nginx/sites-enabled/default

nginx -t 2>&1
if [ $? -eq 0 ]; then
  systemctl restart nginx
  echo "  Nginx configurado e reiniciado"
else
  echo "  ERRO na configuracao do Nginx!"
fi

# ============================================================
# 16. SSL (CERTBOT)
# ============================================================
echo ""
echo "==> [13/16] SSL..."
if [ "$INSTALL_MODE" = "1" ]; then
  if [[ "$INSTALL_SSL" == "s" || "$INSTALL_SSL" == "S" || "$INSTALL_SSL" == "y" || "$INSTALL_SSL" == "Y" ]]; then
    echo "  Gerando certificados SSL via Certbot..."
    certbot --nginx -d "${DOMAIN_HOTSPOT}" -d "${DOMAIN_EVOLUTION}" --non-interactive --agree-tos -m "${SSL_EMAIL}" 2>&1
    if [ $? -eq 0 ]; then
      echo "  SSL configurado"
    else
      echo "  AVISO: Certbot falhou. Verifique se os dominios apontam para ${PUBLIC_IP}"
    fi
  else
    echo "  Pulado (usuario escolheu nao)"
  fi
else
  echo "  Pulado (modo Traefik - SSL gerenciado externamente)"
fi

# ============================================================
# 17. FREERADIUS - REINICIAR
# ============================================================
echo ""
echo "==> [14/16] Reiniciando FreeRADIUS..."
systemctl enable freeradius 2>/dev/null
systemctl restart freeradius 2>&1
if [ $? -eq 0 ]; then
  echo "  FreeRADIUS rodando"
else
  echo "  ERRO ao iniciar FreeRADIUS!"
  echo "  Debug: freeradius -X"
fi

# ============================================================
# 18. FIREWALL
# ============================================================
echo ""
echo "==> [15/16] Firewall..."
if [ "$INSTALL_MODE" = "1" ]; then
  if command -v ufw &>/dev/null; then
    # CRITICO: liberar SSH antes de qualquer outra coisa pra nao derrubar a sessao
    echo "  Liberando porta SSH ${SSH_PORT}/tcp (sessao atual)..."
    ufw allow ${SSH_PORT}/tcp 2>/dev/null
    # Tambem libera 22 caso usuario tenha errado a deteccao (cinto + suspensorio)
    if [ "${SSH_PORT}" != "22" ]; then
      ufw allow 22/tcp 2>/dev/null
    fi
    ufw allow 80/tcp     2>/dev/null
    ufw allow 443/tcp    2>/dev/null
    # RADIUS (1812/1813) e CoA (3799): so da VPN (10.8.0.0/24) por padrao. Gateways com IP publico:
    #   ufw allow from <IP_DO_GATEWAY> to any port 1812,1813,3799 proto udp
    # (ou reinstale com RADIUS_ALLOW_FROM=any para abrir para todos — nao recomendado).
    RADIUS_ALLOW_FROM="${RADIUS_ALLOW_FROM:-10.8.0.0/24}"
    if [ "$RADIUS_ALLOW_FROM" = "any" ]; then
      ufw allow 1812/udp   2>/dev/null
      ufw allow 1813/udp   2>/dev/null
      ufw allow 3799/udp   2>/dev/null
    else
      ufw allow from ${RADIUS_ALLOW_FROM} to any port 1812,1813,3799 proto udp 2>/dev/null
      echo "  RADIUS/CoA liberados apenas para ${RADIUS_ALLOW_FROM}"
    fi
    ufw allow ${WG_VPN_PORT}/udp 2>/dev/null
    ufw --force enable   2>/dev/null
    echo "  UFW configurado (SSH em ${SSH_PORT}/tcp liberado)"
  fi
else
  echo "  Modo Traefik: sem UFW"
  echo "  Port-forward necessario: UDP ${WG_VPN_PORT} (WireGuard)"
fi

# ============================================================
# 19. SALVAR CREDENCIAIS
# ============================================================
echo ""
echo "==> [16/16] Salvando credenciais..."
CRED_FILE="/root/hotspot-credenciais.txt"
MODE_LABEL=$([ "$INSTALL_MODE" = "1" ] && echo "VPS IP publico" || echo "Atras de Traefik")
cat > "$CRED_FILE" <<EOF
============================================================
  CREDENCIAIS DO SISTEMA HOTSPOT
  Modo:     ${MODE_LABEL}
  Gerado:   $(date '+%Y-%m-%d %H:%M:%S')
  Servidor: ${PUBLIC_IP}
============================================================

DOMINIOS:
  Painel Hotspot:    https://${DOMAIN_HOTSPOT}
  Evolution API:     https://${DOMAIN_EVOLUTION}

BANCO DE DADOS (MySQL):
  Host:     127.0.0.1
  Database: hotspot
  Usuario:  hotspotuser
  Senha:    ${MYSQL_PASS}

BACKEND:
  Porta:      ${BACKEND_PORT}
  JWT Secret: ${JWT_SECRET}

EVOLUTION API:
  URL:      http://localhost:8080
  API Key:  ${EVO_API_KEY}
  Instance: hotspot

WIREGUARD VPN:
  IP Publico:    ${PUBLIC_IP}
  Porta VPN:     ${WG_VPN_PORT}
  Porta Painel:  ${WG_PANEL_PORT}
  Senha Painel:  ${WG_PASS}

POSTGRESQL (Evolution):
  Usuario: evolution
  Senha:   ${POSTGRES_PASS}
  Database: evolution_db

LOGIN ADMIN:
  URL:   https://${DOMAIN_HOTSPOT}
  Email: admin@empresa.com
  Senha: ${ADMIN_PASS}

============================================================
  MANTENHA ESTE ARQUIVO SEGURO!
  Localizacao: ${CRED_FILE}
============================================================
EOF
chmod 600 "$CRED_FILE"
echo "  Salvo em ${CRED_FILE}"

# ============================================================
# VERIFICACAO FINAL
# ============================================================
echo ""
echo "=========================================================="
echo "  VERIFICACAO DOS SERVICOS                                "
echo "=========================================================="

# Verificar cada servico
check_service() {
  local name="$1"
  local check="$2"
  if eval "$check" &>/dev/null; then
    echo "  [OK] $name"
  else
    echo "  [FALHOU] $name"
  fi
}

check_service "MySQL" "systemctl is-active mysql"
check_service "Nginx" "systemctl is-active nginx"
check_service "FreeRADIUS" "systemctl is-active freeradius"
check_service "PM2 (backend)" "pm2 pid hotspot-api"

if [ "$DOCKER_OK" = true ]; then
  sleep 3
  check_service "Docker" "systemctl is-active docker"
  check_service "WireGuard (wg-easy)" "docker ps --format '{{.Names}}' | grep -q wg-easy"
  check_service "Evolution API" "docker ps --format '{{.Names}}' | grep -q evolution-api"
  check_service "PostgreSQL (Evolution)" "docker ps --format '{{.Names}}' | grep -q evolution-postgres"
fi

echo ""
echo "=========================================================="
echo "    INSTALACAO CONCLUIDA!                                 "
echo "=========================================================="
echo ""
echo "  Modo:           ${MODE_LABEL}"
echo "  Painel:         https://${DOMAIN_HOTSPOT}"
echo "  Login:          admin@empresa.com / ${ADMIN_PASS}"
echo "  Evolution API:  https://${DOMAIN_EVOLUTION}"
echo ""
if [ "$INSTALL_MODE" = "1" ]; then
  echo "  WireGuard VPN:  ${PUBLIC_IP}:${WG_VPN_PORT}"
  echo "  WireGuard Web:  http://${PUBLIC_IP}:${WG_PANEL_PORT}"
else
  echo "  WireGuard VPN:  ${PUBLIC_IP}:${WG_VPN_PORT} (port-forward)"
  echo "  WireGuard Web:  http://localhost:${WG_PANEL_PORT}"
  echo "  Nginx Hotspot:  porta ${NGINX_LISTEN_PORT}"
  echo "  Nginx Evolution:porta ${NGINX_EVO_PORT}"
fi
echo ""
echo "  Credenciais:    ${CRED_FILE}"
echo ""
echo "  Comandos uteis:"
echo "    pm2 status                    # Ver backend"
echo "    pm2 logs hotspot-api          # Logs do backend"
echo "    docker ps                     # Ver containers"
echo "    systemctl status freeradius   # Ver RADIUS"
echo "    freeradius -X                 # Debug RADIUS"
echo ""
echo "=========================================================="
