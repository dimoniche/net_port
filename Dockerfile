FROM ubuntu:22.04

# Установка необходимых зависимостей
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    nginx \
    postgresql \
    postgresql-contrib \
    tzdata \
    libpq-dev \
    wget \
    mc \
    systemd \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# Установка 20 версии Node.js
ARG NODE_VERSION=20
RUN wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
ENV NVM_DIR=/root/.nvm
RUN bash -c "source $NVM_DIR/nvm.sh && nvm install $NODE_VERSION"

# Настройка часового пояса
RUN ln -fs /usr/sshare/zoneinfo/UTC /etc/localtime && \
    dpkg-reconfigure -f noninteractive tzdata

# Автоматическое соглашение с лицензией
RUN echo "Y" | apt-get install -y build-essential cmake git postgresql postgresql-contrib nginx

# Клонирование исходников сервера
WORKDIR /root/net_port/source
RUN git clone --branch feature/docker-support https://github.com/dimoniche/net_port.git .

# Копирование локальных изменений веб-части
COPY web /root/net_port/source/web

# Компиляция сервера
WORKDIR /root/net_port/source
RUN mkdir -p build
RUN cmake . && make

# Копирование скомпилированного сервера
WORKDIR /root/net_port/source
RUN cp server/module_net_port_server* /root/net_port/

# Установка и настройка веб-части
WORKDIR /root/net_port/source/web/backend_net_port
RUN bash -c "source $NVM_DIR/nvm.sh && npm install"
# Установка bcryptjs для скрипта add_test_user
RUN bash -c "source $NVM_DIR/nvm.sh && npm install bcryptjs"

WORKDIR /root/net_port/source/web/frontend_net_port
RUN bash -c "source $NVM_DIR/nvm.sh && npm install && npm run build"

# Копирование скомпилированного фронтенда в директорию, обслуживаемую Nginx
RUN mkdir -p /var/www/html && cp -r build/* /var/www/html/

WORKDIR /root/net_port/source

# Копирование скрипта для настройки PostgreSQL
COPY init_db.sql /root/net_port/source/

# Копирование конфигурации Nginx
COPY nginx.conf /etc/nginx/sites-available/default

COPY init_db.sql /var/lib/postgresql/
RUN chown postgres:postgres /var/lib/postgresql/init_db.sql

# Создание скрипта для запуска сервера
RUN echo "#!/bin/bash\n" \
    "# Set default values if environment variables are not set\n" \
    "DB_USER=\${DB_USER:-admin}\n" \
    "DB_PASSWORD=\${DB_PASSWORD}\n" \
    "DB_HOST=\${DB_HOST:-localhost}\n" \
    "THREADS=\${THREADS:-10}\n" \
    "\n" \
    "# Create .env file for backend with current environment variables\n" \
    "echo \"DB_USER=\$DB_USER\" > /root/net_port/source/web/backend_net_port/.env\n" \
    "echo \"DB_PASSWORD=\$DB_PASSWORD\" >> /root/net_port/source/web/backend_net_port/.env\n" \
    "echo \"DB_HOST=\$DB_HOST\" >> /root/net_port/source/web/backend_net_port/.env\n" \
    "\n" \
    "# Update PostgreSQL configuration to allow remote connections\n" \
    "sed -i 's/#listen_addresses = \x27localhost\x27/listen_addresses = \x27*\x27/' /etc/postgresql/*/main/postgresql.conf \n" \
    "service postgresql restart \n" \
    "\n" \
    "# Initialize database from SQL script\n" \
    "su - postgres -c \"psql -f /var/lib/postgresql/init_db.sql\"\n" \
    "\n" \
    "# Create PostgreSQL user with password from environment\n" \
    "su - postgres -c \"psql -c \\\"CREATE ROLE \\\"\\\"\$DB_USER\\\"\\\" WITH LOGIN PASSWORD '\$DB_PASSWORD';\\\"\"\n" \
    "\n" \
    "# Grant privileges\n" \
    "su - postgres -c \"psql -c \\\"GRANT ALL PRIVILEGES ON DATABASE net_port TO \\\"\\\"\$DB_USER\\\"\\\";\\\"\"\n" \
    "su - postgres -c \"psql -d net_port -c \\\"GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO \\\"\\\"\$DB_USER\\\"\\\";\\\"\"\n" \
    "su - postgres -c \"psql -d net_port -c \\\"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO \\\"\\\"\$DB_USER\\\"\\\";\\\"\"\n" \
    "\n" \
    "# Add admin user with hashed password from environment\n" \
    "cd /root/net_port/source/web/backend_net_port && bash -c \"source $NVM_DIR/nvm.sh && NODE_PATH=/root/net_port/source/web/backend_net_port/node_modules node ../utils/add_test_user.js\" \n" \
    "\n" \
    "# Generate SSL certificates if they don't exist\n" \
    "if [ ! -f /root/net_port/server.crt ] || [ ! -f /root/net_port/server.key ]; then\n" \
    "    mkdir -p /root/net_port\n" \
    "    cd /root/net_port\n" \
    "    openssl genrsa -out server.key 2048\n" \
    "    openssl req -new -x509 -key server.key -out server.crt -days 3650 -subj \"/C=RU/ST=Moscow/L=Moscow/O=Net Port/CN=localhost\"\n" \
    "fi\n" \
    "\n" \
    "service nginx start \n" \
    "\n" \
    "# Start net_port server in background\n" \
    "cd /root/net_port\n" \
    "./module_net_port_server* -v1 --user 1 --cert server.crt --key server.key --threads \$THREADS --username \$DB_USER --password \$DB_PASSWORD -p 5432 &\n" \
    "SERVER_PID=\$!\n" \
    "\n" \
    "# Start Node.js backend\n" \
    "cd /root/net_port/source/web/backend_net_port && bash -c \"source $NVM_DIR/nvm.sh && npm start\" &\n" \
    "BACKEND_PID=\$!\n" \
    "\n" \
    "wait \$SERVER_PID \$BACKEND_PID\n" \
    "tail -f /dev/null" > /root/net_port/start.sh && \
    chmod +x /root/net_port/start.sh

EXPOSE 80
EXPOSE 6000-6999
EXPOSE 8080
EXPOSE 5432

CMD ["/root/net_port/start.sh"]
