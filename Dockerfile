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

RUN mkdir -p build && cd build && cmake .. && make -j"$(nproc)"

RUN mkdir -p /root/net_port && \
    cp build/server/module_net_port_server-* /root/net_port/ && \
    cp build/client/module_net_port_client-* /root/net_port/

WORKDIR /root/net_port/source/web/backend_net_port
RUN bash -c "source $NVM_DIR/nvm.sh && npm install && npm install bcryptjs"

WORKDIR /root/net_port/source/web/frontend_net_port
RUN bash -c "source $NVM_DIR/nvm.sh && npm install && npm run build"

RUN mkdir -p /var/www/html && cp -r build/* /var/www/html/

COPY init_db.sql /etc/postgresql/init_db.sql
COPY init_device_db.sql /etc/postgresql/init_device_db.sql
COPY sql/port_release_fix.sql /etc/postgresql/port_release_fix.sql
COPY sql/device_preferred_port.sql /etc/postgresql/device_preferred_port.sql
COPY sql/user_auto_connect.sql /etc/postgresql/user_auto_connect.sql
RUN chown postgres:postgres /etc/postgresql/init_db.sql /etc/postgresql/init_device_db.sql /etc/postgresql/port_release_fix.sql /etc/postgresql/device_preferred_port.sql /etc/postgresql/user_auto_connect.sql

COPY nginx.conf /etc/nginx/sites-available/default
COPY start.sh /root/net_port/start.sh
RUN chmod +x /root/net_port/start.sh

EXPOSE 80 8080 5432 8443 6000-6999

CMD ["/root/net_port/start.sh"]
