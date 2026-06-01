#!/usr/bin/env bash
# Run integration, security, fixed-port, and optional load tests.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INTEGRATION_DIR="${ROOT_DIR}/scripts/integration"
# shellcheck source=lib/common.sh
source "${INTEGRATION_DIR}/lib/common.sh"

RUN_LOAD="${NET_PORT_RUN_LOAD:-1}"
LOAD_DEVICES="${NET_PORT_LOAD_DEVICES:-10}"
LOAD_WORKERS="${NET_PORT_LOAD_WORKERS:-10}"

if [ -z "${DB_PASSWORD:-}" ]; then
  echo "Set DB_PASSWORD before running integration tests" >&2
  exit 1
fi

trap cleanup_all_test_devices EXIT

run_test() {
  local name="$1"
  local script="$2"
  echo
  echo "========== ${name} =========="
  bash "$script"
}

run_test "Registration / reconnect" "${INTEGRATION_DIR}/device_tunnel_test.sh"
sleep 2
run_test "Fixed port" "${INTEGRATION_DIR}/fixed_port_test.sh"

if [ "$RUN_LOAD" = "1" ]; then
  sleep 2
  send_control_json '{"action":"reset_rate_limits"}' >/dev/null 2>&1 || true
  sleep 1
  echo
  echo "========== Load (${LOAD_DEVICES} devices) =========="
  NET_PORT_LOAD_DEVICES="$LOAD_DEVICES" \
  NET_PORT_LOAD_WORKERS="$LOAD_WORKERS" \
    python3 "${INTEGRATION_DIR}/load_test_devices.py"
fi

sleep 2
run_test "Security" "${INTEGRATION_DIR}/security_control_test.sh"

echo
echo "All integration tests passed"
