FROM ubuntu:22.04

# Установка необходимых зависимостей
ENV DEBIAN_FRONTEND=noninteractive
ENV DB_USER=admin
ENV DB_PASSWORD=lbvsx123

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
COPY .env_db /root/net_port/source/web/backend_net_port/.env

# Создание скрипта для запуска сервера
RUN echo "#!/bin/bash\n" \
    "sed -i 's/#listen_addresses = \x27localhost\x27/listen_addresses = \x27*\x27/' /etc/postgresql/*/main/postgresql.conf \n" \
    "service postgresql restart \n" \
    "su - postgres -c \"psql -f /var/lib/postgresql/init_db.sql\"\n" \
    "# Load environment variables from .env file\n" \
    "export \$(grep -v '^#' /root/net_port/source/web/backend_net_port/.env | xargs)\n" \
    "# Create PostgreSQL user admin with password from environment\n" \
    "su - postgres -c \"psql -c \\\"CREATE ROLE admin WITH LOGIN PASSWORD '\$DB_PASSWORD';\\\"\"\n" \
    "# Grant privileges\n" \
    "su - postgres -c \"psql -c \\\"GRANT ALL PRIVILEGES ON DATABASE net_port TO admin;\\\"\"\n" \
    "su - postgres -c \"psql -d net_port -c \\\"GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO admin;\\\"\"\n" \
    "service nginx start \n" \
    "cd /root/net_port/source/web/backend_net_port && bash -c \"source $NVM_DIR/nvm.sh && npm start\" \n" \
    "wait && tail -f /dev/null" > /root/net_port/start.sh && \
    chmod +x /root/net_port/start.sh

EXPOSE 80
EXPOSE 6000-6999
EXPOSE 8080
EXPOSE 5432

CMD ["/root/net_port/start.sh"]
