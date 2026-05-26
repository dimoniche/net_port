#!/usr/bin/env bash
# Integration test: device registration with fixed (preferred) port.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=lib/common.sh
source "${ROOT_DIR}/scripts/integration/lib/common.sh"

PREFERRED_PORT="${NET_PORT_TEST_PREFERRED_PORT:-6010}"
INPUT_PORT="$PREFERRED_PORT"
TUNNEL_PORT="$((PREFERRED_PORT + 1))"

main() {
  local response status message assigned_port tunnel_port

  log "fixed port test device=${DEVICE_ID} preferred=${PREFERRED_PORT}"
  check_prerequisites
  trap cleanup_test_device EXIT

  prepare_test_device "connecting"

  response="$(register_device || true)"
  status="$(json_field status "$response")"
  if [ "$status" != "authenticated" ]; then
    message="$(json_field message "$response")"
    fail "registration failed: status=${status:-empty} message=${message:-empty}"
    summary || exit 1
    exit 1
  fi

  assigned_port="$(json_field assigned_port "$response")"
  tunnel_port="$(json_field tunnel_port "$response")"

  if [ "$assigned_port" = "$PREFERRED_PORT" ]; then
    pass "assigned_port matches preferred_port (${PREFERRED_PORT})"
  else
    fail "expected assigned_port=${PREFERRED_PORT}, got ${assigned_port:-empty}"
  fi

  if [ "$tunnel_port" = "$TUNNEL_PORT" ]; then
    pass "tunnel_port matches preferred pair (${TUNNEL_PORT})"
  else
    fail "expected tunnel_port=${TUNNEL_PORT}, got ${tunnel_port:-empty}"
  fi

  assert_ports_listening || true

  summary || exit 1
}

main "$@"
