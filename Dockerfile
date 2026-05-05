FROM ubuntu:22.04

# Установка необходимых зависимостей
ENV DEBIAN_FRONTEND=noninteractive

ARG EXTERNAL_DB=false

RUN apt-get update && \
    if [ "$EXTERNAL_DB" = "true" ]; then \
        apt-get install -y \
            build-essential \
            cmake \
            git \
            nginx \
            tzdata \
            libpq-dev \
            wget \
            mc \
            systemd \
            openssl ; \
    else \
        apt-get install -y \
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
            openssl ; \
    fi && \
    rm -rf /var/lib/apt/lists/*

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
RUN git clone --branch develop https://github.com/dimoniche/net_port.git .

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

# Copy init_db.sql to a location that won't be overwritten by volume mount
COPY init_db.sql /etc/postgresql/init_db.sql
RUN chown postgres:postgres /etc/postgresql/init_db.sql

# Создание скрипта для запуска сервера
COPY start.sh /root/net_port/start.sh
RUN chmod +x /root/net_port/start.sh

EXPOSE 80
EXPOSE 6000-6999
EXPOSE 8080
EXPOSE 5432

CMD ["/root/net_port/start.sh"]
