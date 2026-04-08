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
    curl \
    && rm -rf /var/lib/apt/lists/*

# Установка последней версии Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && \
    apt-get install -y nodejs

# Настройка часового пояса
RUN ln -fs /usr/sshare/zoneinfo/UTC /etc/localtime && \
    dpkg-reconfigure -f noninteractive tzdata

# Автоматическое соглашение с лицензией
RUN echo "Y" | apt-get install -y build-essential cmake git postgresql postgresql-contrib nginx

# Клонирование исходников сервера
WORKDIR /root/net_port/source
RUN git clone --branch feature/docker-support https://github.com/dimoniche/net_port.git .

# Компиляция сервера
WORKDIR /root/net_port/source
RUN mkdir -p build
RUN cmake . && make

# Копирование скомпилированного сервера
WORKDIR /root/net_port/source
RUN cp server/module_net_port_server* /root/net_port/

# Установка и настройка веб-части
WORKDIR /root/net_port/source/web/backend_net_port
RUN npm install

WORKDIR /root/net_port/source/web/frontend_net_port
RUN npm install && npm run build

# Копирование скомпилированного фронтенда в директорию, обслуживаемую Nginx
RUN mkdir -p /var/www/html && cp -r build/* /var/www/html/

WORKDIR /root/net_port/source

# Копирование скрипта для настройки PostgreSQL
COPY init_db.sql /root/net_port/source/

# Копирование конфигурации Nginx
COPY nginx.conf /etc/nginx/sites-available/default

# Создание скрипта для запуска сервера
RUN echo "#!/bin/bash\n" \
    "service postgresql start &\n" \
    "sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" /etc/postgresql/*/main/postgresql.conf &\n" \
    "sleep 10 &\n" \
    "su - postgres -c \"psql -f /root/net_port/source/init_db.sql\" &\n" \
    "service nginx start &\n" \
    "cd /root/net_port/web/backend_net_port && npm start &\n" \
    "wait && tail -f /dev/null" > /root/net_port/start.sh && \
    chmod +x /root/net_port/start.sh

EXPOSE 80
EXPOSE 6000-6999
EXPOSE 8080
EXPOSE 5432

CMD ["/root/net_port/start.sh"]
