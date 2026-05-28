FROM ubuntu:22.04

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
            pkg-config \
            libjansson-dev \
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
            pkg-config \
            libjansson-dev \
            openssl ; \
    fi && \
    rm -rf /var/lib/apt/lists/*

ARG NODE_VERSION=20
RUN wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
ENV NVM_DIR=/root/.nvm
RUN bash -c "source $NVM_DIR/nvm.sh && nvm install $NODE_VERSION"

RUN ln -fs /usr/share/zoneinfo/UTC /etc/localtime && \
    dpkg-reconfigure -f noninteractive tzdata

WORKDIR /root/net_port/source

# Локальные исходники (включая device management)
COPY . /root/net_port/source/

RUN rm -rf build CMakeCache.txt CMakeFiles cmake_install.cmake Makefile && \
    mkdir -p build && cd build && cmake .. && make -j"$(nproc)"

# amd64-клиент уже в build/client/ после cmake; в /root/net_port/ — для start.sh
RUN mkdir -p /root/net_port && \
    cp build/server/module_net_port_server-* /root/net_port/ && \
    cp build/client/module_net_port_client-* /root/net_port/

# Доп. клиенты (ARM, Windows .exe): scripts/build-client-cross.sh / build-client-windows.sh
COPY artifacts/clients/ /root/net_port/source/build/client/

WORKDIR /root/net_port/source/web/backend_net_port
RUN bash -c "source $NVM_DIR/nvm.sh && npm install && npm install bcryptjs"

WORKDIR /root/net_port/source/web/frontend_net_port
RUN bash -c "source $NVM_DIR/nvm.sh && npm install && npm run build"

RUN mkdir -p /var/www/html && cp -r build/* /var/www/html/

COPY init_db.sql /etc/postgresql/init_db.sql
COPY init_device_db.sql /etc/postgresql/init_device_db.sql
COPY sql/migrations/ /etc/postgresql/migrations/
COPY sql/grant_app_privileges.sql /etc/postgresql/grant_app_privileges.sql
RUN chown -R postgres:postgres /etc/postgresql/init_db.sql /etc/postgresql/init_device_db.sql /etc/postgresql/migrations /etc/postgresql/grant_app_privileges.sql

COPY nginx.conf /etc/nginx/sites-available/default
COPY start.sh /root/net_port/start.sh
RUN chmod +x /root/net_port/start.sh

EXPOSE 80 8080 5432 8443 5000-5999 6000-6999

CMD ["/root/net_port/start.sh"]
