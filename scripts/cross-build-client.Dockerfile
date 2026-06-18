# Кросс-сборка клиента (armhf / aarch64). Debian bookworm — armhf ещё в репозиториях.
FROM debian:bookworm-slim

ARG TARGET_ARCH=armhf
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    pkg-config \
    file \
    && if [ "$TARGET_ARCH" = "armhf" ]; then \
      dpkg --add-architecture armhf \
      && apt-get update \
      && apt-get install -y --no-install-recommends \
        gcc-arm-linux-gnueabihf \
        g++-arm-linux-gnueabihf \
        libssl-dev:armhf \
        libjansson-dev:armhf; \
    elif [ "$TARGET_ARCH" = "aarch64" ]; then \
      dpkg --add-architecture arm64 \
      && apt-get update \
      && apt-get install -y --no-install-recommends \
        gcc-aarch64-linux-gnu \
        g++-aarch64-linux-gnu \
        libssl-dev:arm64 \
        libjansson-dev:arm64; \
    else \
      echo "Unsupported TARGET_ARCH=$TARGET_ARCH" >&2; exit 1; \
    fi \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
