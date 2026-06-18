FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    gcc-mingw-w64-x86-64 \
    g++-mingw-w64-x86-64 \
    file \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
