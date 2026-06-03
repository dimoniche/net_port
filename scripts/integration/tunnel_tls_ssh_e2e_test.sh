#!/usr/bin/env bash
# Integration test: TLS tunnel + SSH banner end-to-end through dynamic proxy.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=lib/common.sh
source "${ROOT_DIR}/scripts/integration/lib/common.sh"

DEVICE_ID="${NET_PORT_TEST_DEVICE_ID:-integration-test-tls-ssh}"
AUTH_TOKEN="${NET_PORT_TEST_AUTH_TOKEN:-integration-test-tls-ssh-token}"
ENABLE_INPUT_SSL="${NET_PORT_TEST_ENABLE_INPUT_SSL:-false}"
ENABLE_TUNNEL_SSL="${NET_PORT_TEST_ENABLE_TUNNEL_SSL:-true}"
INTERNAL_PORT="${NET_PORT_TEST_INTERNAL_PORT:-${MOCK_SSH_PORT}}"

cleanup_e2e() {
  stop_device_client
  stop_mock_ssh_server
  cleanup_test_device
}

verify_tunnel_port_tls_before_client() {
  local response status tunnel_tls tls_version message

  response="$(register_device || true)"
  status="$(json_field status "$response")"
  if [ "$status" != "authenticated" ]; then
    message="$(json_field message "$response")"
    fail "TLS probe registration failed: status=${status:-empty} message=${message:-empty}"
    return 1
  fi

  tunnel_tls="$(json_bool_field tunnel_tls "$response")"
  if [ "$tunnel_tls" = "true" ]; then
    pass "registration advertises tunnel_tls=true"
  else
    fail "expected tunnel_tls=true in registration response"
    return 1
  fi

  apply_assigned_ports_from_response "$response"
  assert_ports_listening 30 || true

  if ! tls_version="$(probe_tls_server "$TUNNEL_PORT" 2>/dev/null)"; then
    fail "TLS handshake failed on tunnel port ${TUNNEL_PORT}"
    return 1
  fi
  pass "TLS handshake on tunnel port ${TUNNEL_PORT} (${tls_version})"

  if probe_plain_tcp_rejected_on_tls_port "$TUNNEL_PORT"; then
    pass "tunnel port ${TUNNEL_PORT} does not expose plain SSH banner"
  else
    fail "tunnel port ${TUNNEL_PORT} returned SSH-like data without TLS"
    return 1
  fi

  disconnect_device >/dev/null 2>&1 || true
  psql_exec "
    UPDATE devices
    SET status = 'connecting', assigned_port = NULL, updated_at = NOW()
    WHERE device_id = '${DEVICE_ID}';
    UPDATE device_sessions
    SET status = 'terminated', expires_at = NOW()
    WHERE device_id = (SELECT id FROM devices WHERE device_id = '${DEVICE_ID}')
      AND status = 'active';
  " >/dev/null
  sleep 1
  return 0
}

main() {
  local banner client_bin client_log

  log "device=${DEVICE_ID} tunnel_ssl=${ENABLE_TUNNEL_SSL} mock_ssh=${INTERNAL_PORT}"
  check_prerequisites

  client_bin="$(resolve_client_binary || true)"
  if [ -z "$client_bin" ]; then
    fail "device client binary not found (build client or set NET_PORT_CLIENT_BIN)"
    summary || exit 1
    exit 1
  fi
  pass "client binary: ${client_bin}"

  trap cleanup_e2e EXIT

  if ! start_mock_ssh_server "$INTERNAL_PORT"; then
    fail "mock SSH server failed to start on port ${INTERNAL_PORT}"
    summary || exit 1
    exit 1
  fi
  pass "mock SSH server listening on ${INTERNAL_PORT}"

  prepare_test_device "connecting"

  if device_flag_enabled "enable_tunnel_ssl"; then
    pass "device configured with enable_tunnel_ssl=true"
  else
    fail "expected enable_tunnel_ssl=true in database"
  fi

  if ! device_flag_enabled "enable_input_ssl"; then
    pass "device configured with enable_input_ssl=false (plain SSH on published port)"
  else
    fail "expected enable_input_ssl=false for SSH-through-tunnel test"
  fi

  verify_tunnel_port_tls_before_client || true

  : > /tmp/logs/module_net_port.log 2>/dev/null || true

  if ! start_device_client; then
    fail "failed to start device client"
    summary || exit 1
    exit 1
  fi

  if wait_for_device_registered 90 1; then
    pass "device client completed registration"
  else
    fail "device client did not register within timeout"
    client_log="${NET_PORT_CLIENT_LOG:-/tmp/net_port_client_${DEVICE_ID}.log}"
    if [ -f "$client_log" ]; then
      log "client stdout log tail:"
      tail -n 15 "$client_log" || true
    fi
    if [ -f /tmp/logs/module_net_port.log ]; then
      log "client module log tail:"
      tail -n 20 /tmp/logs/module_net_port.log || true
    fi
    summary || exit 1
    exit 1
  fi

  assert_ports_listening 30 || true

  client_log="/tmp/logs/module_net_port.log"
  sleep 2

  if [ -f "$client_log" ] && grep -q "SSL connection established" "$client_log"; then
    pass "device client established TLS on tunnel leg"
  else
    fail "device client log missing TLS tunnel handshake"
  fi

  if banner="$(read_ssh_banner_via_tunnel "$INPUT_PORT" 40)"; then
    pass "SSH banner via input port ${INPUT_PORT}: ${banner}"
  else
    fail "did not receive SSH-2.0 banner on input port ${INPUT_PORT} through TLS tunnel"
    if [ -f "$client_log" ]; then
      log "client module log tail:"
      tail -n 20 "$client_log" || true
    fi
  fi

  summary || exit 1
}

main "$@"
