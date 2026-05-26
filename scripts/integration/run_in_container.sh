#!/usr/bin/env bash
# Run integration tests inside the net_port_app container (disconnect requires localhost).
set -euo pipefail

CONTAINER_NAME="${NET_PORT_CONTAINER:-net_port_app}"
MODE="${1:-single}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "Container ${CONTAINER_NAME} is not running" >&2
  exit 1
fi

run_in_container() {
  local script_path="$1"
  docker exec \
    -e DB_HOST="${DB_HOST:-192.168.0.132}" \
    -e DB_PORT="${DB_PORT:-5432}" \
    -e DB_USER="${DB_USER:-admin}" \
    -e DB_PASSWORD="${DB_PASSWORD:?Set DB_PASSWORD before running}" \
    -e DB_NAME="${DB_NAME:-net_port}" \
    -e NET_PORT_CONTROL_HOST=127.0.0.1 \
    -e NET_PORT_CONTROL_PORT=8443 \
    "$CONTAINER_NAME" \
    bash "$script_path"
}

case "$MODE" in
  all)
    run_in_container /root/net_port/source/scripts/integration/run_all_integration_tests.sh
    ;;
  load)
    run_in_container /root/net_port/source/scripts/integration/load_test_devices.py
    ;;
  security)
    run_in_container /root/net_port/source/scripts/integration/security_control_test.sh
    ;;
  fixed-port|fixed_port)
    run_in_container /root/net_port/source/scripts/integration/fixed_port_test.sh
    ;;
  single|*)
    run_in_container /root/net_port/source/scripts/integration/device_tunnel_test.sh
    ;;
esac
