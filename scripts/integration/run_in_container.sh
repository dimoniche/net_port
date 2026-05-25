#!/usr/bin/env bash
# Run integration test inside the net_port_app container (disconnect requires localhost).
set -euo pipefail

CONTAINER_NAME="${NET_PORT_CONTAINER:-net_port_app}"
SCRIPT_PATH="/root/net_port/source/scripts/integration/device_tunnel_test.sh"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "Container ${CONTAINER_NAME} is not running" >&2
  exit 1
fi

docker exec \
  -e DB_HOST="${DB_HOST:-192.168.0.132}" \
  -e DB_PORT="${DB_PORT:-5432}" \
  -e DB_USER="${DB_USER:-admin}" \
  -e DB_PASSWORD="${DB_PASSWORD:?Set DB_PASSWORD before running}" \
  -e DB_NAME="${DB_NAME:-net_port}" \
  -e NET_PORT_CONTROL_HOST=127.0.0.1 \
  -e NET_PORT_CONTROL_PORT=8443 \
  "$CONTAINER_NAME" \
  bash "$SCRIPT_PATH"
