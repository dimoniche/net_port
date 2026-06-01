# --- Stage 1: compile C binaries and build frontend / backend deps ---
FROM node:20-bookworm AS node

FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    pkg-config \
    libjansson-dev \
    libssl-dev \
    libpq-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

WORKDIR /root/net_port/source
COPY . /root/net_port/source/

RUN rm -rf build CMakeCache.txt CMakeFiles cmake_install.cmake Makefile && \
    mkdir -p build && cd build && \
    cmake -DCMAKE_BUILD_TYPE=Release .. && \
    make -j"$(nproc)"

COPY artifacts/clients/ /root/net_port/source/build/client/

WORKDIR /root/net_port/source/web/backend_net_port
RUN npm ci && \
    npm run build:bundle && \
    rm -rf node_modules src test jest.config.js .eslintrc.json && \
    npm cache clean --force

WORKDIR /root/net_port/source/web/frontend_net_port
RUN npm ci && \
    npm run build && \
    npm cache clean --force && \
    rm -rf node_modules

# --- Stage 2: minimal runtime image ---
FROM ubuntu:22.04 AS runtime

ENV DEBIAN_FRONTEND=noninteractive

ARG EXTERNAL_DB=false

RUN apt-get update && \
    if [ "$EXTERNAL_DB" = "true" ]; then \
        apt-get install -y --no-install-recommends \
            nginx \
            openssl \
            ca-certificates \
            tzdata \
            libjansson4 \
            libpq5 \
            libssl3 \
            postgresql-client \
            python3-minimal ; \
    else \
        apt-get install -y --no-install-recommends \
            nginx \
            openssl \
            ca-certificates \
            tzdata \
            libjansson4 \
            libpq5 \
            libssl3 \
            postgresql \
            postgresql-contrib \
            python3-minimal ; \
    fi && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

COPY --from=node /usr/local/bin/node /usr/local/bin/node

RUN ln -fs /usr/share/zoneinfo/UTC /etc/localtime && \
    dpkg-reconfigure -f noninteractive tzdata

RUN mkdir -p /root/net_port /root/net_port/source/build/client /root/net_port/source/artifacts/clients /var/www/html

COPY --from=builder /root/net_port/source/build/server/module_net_port_server-* /root/net_port/
COPY --from=builder /root/net_port/source/build/client/ /root/net_port/source/build/client/
COPY --from=builder /root/net_port/source/artifacts/clients/ /root/net_port/source/artifacts/clients/

COPY --from=builder /root/net_port/source/web/backend_net_port /root/net_port/source/web/backend_net_port
COPY --from=builder /root/net_port/source/web/frontend_net_port/src/files /root/net_port/source/web/frontend_net_port/src/files
COPY --from=builder /root/net_port/source/scripts /root/net_port/source/scripts
COPY --from=builder /root/net_port/source/sql /root/net_port/source/sql
COPY --from=builder /root/net_port/source/docs /root/net_port/source/docs
COPY --from=builder /root/net_port/source/VERSION /root/net_port/source/VERSION
COPY --from=builder /root/net_port/source/web/frontend_net_port/build/ /var/www/html/

COPY init_db.sql /etc/postgresql/init_db.sql
COPY init_device_db.sql /etc/postgresql/init_device_db.sql
COPY sql/migrations/ /etc/postgresql/migrations/
COPY sql/grant_app_privileges.sql /etc/postgresql/grant_app_privileges.sql
RUN if id postgres >/dev/null 2>&1; then \
        chown -R postgres:postgres /etc/postgresql/init_db.sql /etc/postgresql/init_device_db.sql /etc/postgresql/migrations /etc/postgresql/grant_app_privileges.sql; \
    fi

COPY nginx.conf /etc/nginx/sites-available/default
COPY start.sh /root/net_port/start.sh
RUN chmod +x /root/net_port/start.sh

EXPOSE 80 8080 5432 8443 5000-5999 6000-6999

CMD ["/root/net_port/start.sh"]
