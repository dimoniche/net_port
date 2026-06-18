#!/usr/bin/env bash
# Integration test: device register -> proxy ports -> disconnect -> reconnect gate.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=lib/common.sh
source "${ROOT_DIR}/scripts/integration/lib/common.sh"

main() {
  local response status message assigned_port tunnel_port

  log "device=${DEVICE_ID} control=${CONTROL_HOST}:${CONTROL_PORT} db=${DB_HOST}:${DB_PORT}/${DB_NAME}"
  check_prerequisites
  trap cleanup_test_device EXIT

  prepare_test_device "connecting"

  response="$(register_device || true)"
  status="$(json_field status "$response")"
  if [ "$status" = "authenticated" ]; then
    assigned_port="$(json_field assigned_port "$response")"
    tunnel_port="$(json_field tunnel_port "$response")"
    pass "registration succeeded (assigned_port=${assigned_port}, tunnel_port=${tunnel_port})"
  else
    message="$(json_field message "$response")"
    fail "registration failed: status=${status:-empty} message=${message:-empty}"
    summary || exit 1
    exit 1
  fi

  apply_assigned_ports_from_response "$response"

  assert_ports_listening || true

  response="$(disconnect_device || true)"
  status="$(json_field status "$response")"
  if [ "$status" = "ok" ]; then
    pass "disconnect control command accepted"
  else
    message="$(json_field message "$response")"
    fail "disconnect failed: status=${status:-empty} message=${message:-empty}"
  fi

  psql_exec "UPDATE devices SET status = 'inactive', assigned_port = NULL, updated_at = NOW() WHERE device_id = '${DEVICE_ID}';"

  sleep 1

  response="$(register_device || true)"
  status="$(json_field status "$response")"
  message="$(json_field message "$response")"
  if [ "$status" = "error" ] && [[ "$message" == *"Authentication failed"* ]]; then
    pass "registration blocked while device is inactive"
  else
    fail "expected Authentication failed after disconnect, got status=${status:-empty} message=${message:-empty}"
  fi

  prepare_test_device "connecting"

  sleep 1

  response="$(register_device || true)"
  status="$(json_field status "$response")"
  if [ "$status" = "authenticated" ]; then
    pass "registration succeeded after reconnect permission"
    apply_assigned_ports_from_response "$response"
  else
    message="$(json_field message "$response")"
    fail "reconnect registration failed: status=${status:-empty} message=${message:-empty}"
    summary || exit 1
    exit 1
  fi

  assert_ports_listening 40 || true
  summary || exit 1
}

main "$@"
