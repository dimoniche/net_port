#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMAGE_NAME="${NET_PORT_IMAGE:-net_port:latest}"

echo "Building Docker image: ${IMAGE_NAME}"
docker compose build net_port
docker tag net_port-net_port "${IMAGE_NAME}" 2>/dev/null || docker tag "$(docker compose images -q net_port)" "${IMAGE_NAME}" 2>/dev/null || true

echo "Done. Run: docker compose up -d net_port"
