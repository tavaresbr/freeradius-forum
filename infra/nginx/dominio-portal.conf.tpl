# Gerado pelo painel (utils/dominioPortal.escreverVhost). NAO editar a mao: e' sobrescrito ao reativar o dominio.
# Dominio proprio do portal: so o portal do cliente final. Painel admin, registro e login ficam no dominio da plataforma.
server {
    listen 443 ssl;
    server_name {{HOST}};

    ssl_certificate     /etc/letsencrypt/live/{{HOST}}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{{HOST}}/privkey.pem;

    root {{DIST}};
    index index.html;
    client_max_body_size 10M;
    include /etc/nginx/snippets/hotspot-security.conf;

    set_real_ip_from 10.0.0.0/8;
    set_real_ip_from 172.16.0.0/12;
    set_real_ip_from 192.168.0.0/16;
    real_ip_header X-Forwarded-For;
    real_ip_recursive on;

    # Painel/registro/login nunca abrem pelo dominio do cliente
    location ~ ^/(admin|super|login|registro)(/|$) {
        return 404;
    }

    location /assets/ {
        expires 1y;
        include /etc/nginx/snippets/hotspot-security.conf;
        add_header Cache-Control "public, immutable, max-age=31536000";
        try_files $uri =404;
    }

    location = /index.html {
        include /etc/nginx/snippets/hotspot-security.conf;
        add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0";
        add_header Pragma "no-cache";
        expires off;
    }

    location / {
        try_files $uri /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:{{PORT}}/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_read_timeout 180s;
        proxy_connect_timeout 30s;
        proxy_send_timeout 180s;
    }

    location /hotspot/ {
        proxy_pass http://localhost:{{PORT}}/hotspot/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }

    location /uploads/campanhas/ {
        alias {{BACKEND}}/uploads/campanhas/;
        expires 1d;
        include /etc/nginx/snippets/hotspot-security.conf;
        add_header Cache-Control "public, max-age=86400";
        try_files $uri =404;
    }

    location /uploads/ {
        alias {{DIST}}/uploads/;
        expires 30d;
        include /etc/nginx/snippets/hotspot-security.conf;
        add_header Cache-Control "public, immutable";
    }
}
