#!/usr/bin/env bash
# Shared helpers for net_port integration tests.

CONTROL_HOST="${NET_PORT_CONTROL_HOST:-127.0.0.1}"
CONTROL_PORT="${NET_PORT_CONTROL_PORT:-8443}"
DEVICE_ID="${NET_PORT_TEST_DEVICE_ID:-integration-test}"
AUTH_TOKEN="${NET_PORT_TEST_AUTH_TOKEN:-integration-test-token}"
INPUT_PORT="${NET_PORT_TEST_INPUT_PORT:-6000}"
TUNNEL_PORT="${NET_PORT_TEST_TUNNEL_PORT:-6001}"
PREFERRED_PORT="${NET_PORT_TEST_PREFERRED_PORT:-}"
ENABLE_INPUT_SSL="${NET_PORT_TEST_ENABLE_INPUT_SSL:-false}"
ENABLE_TUNNEL_SSL="${NET_PORT_TEST_ENABLE_TUNNEL_SSL:-false}"
INTERNAL_PORT="${NET_PORT_TEST_INTERNAL_PORT:-22}"
INTERNAL_ADDRESS="${NET_PORT_TEST_INTERNAL_ADDRESS:-127.0.0.1}"
MOCK_SSH_PORT="${NET_PORT_MOCK_SSH_PORT:-18022}"
CLIENT_PID=""
MOCK_SSH_PID=""

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-admin}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_NAME="${DB_NAME:-net_port}"

PASS_COUNT=0
FAIL_COUNT=0

log() {
  printf '[integration] %s\n' "$*"
}

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  log "PASS: $*"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  log "FAIL: $*"
}

summary() {
  log "summary: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"
  if [ "$FAIL_COUNT" -gt 0 ]; then
    return 1
  fi
  return 0
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log "Missing required command: $cmd"
    exit 1
  fi
}

json_field() {
  local field="$1"
  local json="${2:-}"
  python3 - "$field" "$json" <<'PY'
import json
import sys

field = sys.argv[1]
raw = sys.argv[2] if len(sys.argv) > 2 else ""
if not raw.strip():
    print("")
    sys.exit(0)
try:
    data = json.loads(raw)
except json.JSONDecodeError:
    print("")
    sys.exit(0)
value = data.get(field, "")
if value is None:
    print("")
elif isinstance(value, (dict, list)):
    print(json.dumps(value))
else:
    print(value)
PY
}

json_bool_field() {
  local field="$1"
  local json="${2:-}"
  python3 - "$field" "$json" <<'PY'
import json
import sys

field = sys.argv[1]
raw = sys.argv[2] if len(sys.argv) > 2 else ""
if not raw.strip():
    print("false")
    sys.exit(0)
try:
    data = json.loads(raw)
except json.JSONDecodeError:
    print("false")
    sys.exit(0)
value = data.get(field, False)
print("true" if value else "false")
PY
}

psql_exec() {
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -Atqc "$1"
}

send_control_json() {
  local payload="$1"
  python3 - "$CONTROL_HOST" "$CONTROL_PORT" "$payload" <<'PY'
import json
import os
import socket
import ssl
import sys

host = sys.argv[1]
port = int(sys.argv[2])
payload = sys.argv[3]
timeout = float(os.environ.get("NET_PORT_CONTROL_TIMEOUT", "10"))
use_ssl = os.environ.get("NET_PORT_CONTROL_SSL", "1") != "0"

sock = socket.create_connection((host, port), timeout=timeout)
if use_ssl:
    ctx = ssl.create_default_context()
    ca_file = os.environ.get("NET_PORT_CONTROL_CA_FILE")
    if ca_file:
        ctx.load_verify_locations(cafile=ca_file)
    else:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    sock = ctx.wrap_socket(sock, server_hostname=host)
try:
    sock.sendall(payload.encode("utf-8"))
    sock.settimeout(timeout)
    chunks = []
    while True:
        try:
            data = sock.recv(4096)
        except socket.timeout:
            break
        if not data:
            break
        chunks.append(data)
        try:
            json.loads(b"".join(chunks).decode("utf-8", errors="replace"))
            break
        except json.JSONDecodeError:
            continue
finally:
    sock.close()

print(b"".join(chunks).decode("utf-8", errors="replace"), end="")
PY
}

send_control_raw() {
  local payload="$1"
  python3 - "$CONTROL_HOST" "$CONTROL_PORT" "$payload" <<'PY'
import os
import socket
import ssl
import sys

host = sys.argv[1]
port = int(sys.argv[2])
payload = sys.argv[3]
timeout = float(os.environ.get("NET_PORT_CONTROL_TIMEOUT", "10"))
use_ssl = os.environ.get("NET_PORT_CONTROL_SSL", "1") != "0"

sock = socket.create_connection((host, port), timeout=timeout)
if use_ssl:
    ctx = ssl.create_default_context()
    ca_file = os.environ.get("NET_PORT_CONTROL_CA_FILE")
    if ca_file:
        ctx.load_verify_locations(cafile=ca_file)
    else:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    sock = ctx.wrap_socket(sock, server_hostname=host)
try:
    sock.sendall(payload.encode("utf-8", errors="replace"))
    sock.settimeout(timeout)
    chunks = []
    while True:
        try:
            data = sock.recv(4096)
        except socket.timeout:
            break
        if not data:
            break
        chunks.append(data)
finally:
    sock.close()

print(b"".join(chunks).decode("utf-8", errors="replace"), end="")
PY
}

auth_token_hash() {
  printf '%s' "$AUTH_TOKEN" | sha256sum | awk '{print $1}'
}

prepare_test_device() {
  local status="$1"
  local token_hash
  token_hash="$(auth_token_hash)"
  local user_id
  user_id="$(psql_exec "SELECT id FROM users ORDER BY id LIMIT 1;")"
  if [ -z "$user_id" ]; then
    log "No users in database; create an admin user first."
    exit 1
  fi

  local preferred_sql="NULL"
  if [ -n "$PREFERRED_PORT" ]; then
    preferred_sql="${PREFERRED_PORT}"
  fi

  psql_exec "
    INSERT INTO devices (
      id, device_id, name, status, auth_token_hash, preferred_port,
      internal_address, internal_port, enable_input_ssl, enable_tunnel_ssl,
      user_id, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), '${DEVICE_ID}', 'Integration Test Device', '${status}', '${token_hash}', ${preferred_sql},
      '${INTERNAL_ADDRESS}', ${INTERNAL_PORT}, ${ENABLE_INPUT_SSL}, ${ENABLE_TUNNEL_SSL},
      ${user_id}, NOW(), NOW()
    )
    ON CONFLICT (device_id) DO UPDATE SET
      status = EXCLUDED.status,
      auth_token_hash = EXCLUDED.auth_token_hash,
      preferred_port = EXCLUDED.preferred_port,
      internal_address = EXCLUDED.internal_address,
      internal_port = EXCLUDED.internal_port,
      enable_input_ssl = EXCLUDED.enable_input_ssl,
      enable_tunnel_ssl = EXCLUDED.enable_tunnel_ssl,
      assigned_port = NULL,
      updated_at = NOW()
    RETURNING id;
  " >/dev/null

  if [ -n "$PREFERRED_PORT" ]; then
    local device_uuid
    device_uuid="$(psql_exec "SELECT id FROM devices WHERE device_id = '${DEVICE_ID}';")"
    psql_exec "SELECT reserve_device_port_pair('${device_uuid}'::uuid, ${PREFERRED_PORT}::integer);" >/dev/null
  fi

  psql_exec "
    UPDATE device_sessions
    SET status = 'terminated', expires_at = NOW()
    WHERE device_id = (SELECT id FROM devices WHERE device_id = '${DEVICE_ID}')
      AND status = 'active';
  "
}

delete_test_device_by_id() {
  local device_id="$1"
  send_control_json "{\"action\":\"disconnect\",\"device_id\":\"${device_id}\"}" >/dev/null 2>&1 || true
  psql_exec "
    SELECT cleanup_device_sessions('${device_id}');
    SELECT release_device_port_reservation(id, preferred_port)
    FROM devices
    WHERE device_id = '${device_id}'
      AND preferred_port IS NOT NULL;
    DELETE FROM devices WHERE device_id = '${device_id}';
  " >/dev/null 2>&1 || true
}

delete_test_devices_matching() {
  local pattern="$1"
  psql_exec "
    DO \$\$
    DECLARE r RECORD;
    BEGIN
      FOR r IN SELECT device_id FROM devices WHERE device_id LIKE '${pattern}' LOOP
        PERFORM cleanup_device_sessions(r.device_id);
      END LOOP;
      FOR r IN
        SELECT id, preferred_port
        FROM devices
        WHERE device_id LIKE '${pattern}'
          AND preferred_port IS NOT NULL
      LOOP
        PERFORM release_device_port_reservation(r.id, r.preferred_port);
      END LOOP;
      DELETE FROM devices WHERE device_id LIKE '${pattern}';
    END \$\$;
  " >/dev/null 2>&1 || true
}

cleanup_test_device() {
  delete_test_device_by_id "${DEVICE_ID}"
}

cleanup_all_test_devices() {
  stop_device_client
  stop_mock_ssh_server
  delete_test_devices_matching "${NET_PORT_LOAD_PREFIX:-load-test}-%"
  delete_test_device_by_id "${NET_PORT_TEST_DEVICE_ID:-integration-test}"
  delete_test_device_by_id "${NET_PORT_TLS_SSH_DEVICE_ID:-integration-test-tls-ssh}"
  log "Removed test devices from database"
}

resolve_client_binary() {
  local version="${NET_PORT_CLIENT_VERSION:-}"
  local candidate

  if [ -z "$version" ] && [ -f "/root/net_port/source/VERSION" ]; then
    version="$(tr -d '\r\n' < /root/net_port/source/VERSION)"
  fi
  if [ -z "$version" ] && [ -f "${ROOT_DIR:-.}/VERSION" ]; then
    version="$(tr -d '\r\n' < "${ROOT_DIR}/VERSION")"
  fi
  version="${version:-0.0.4}"

  for candidate in \
    "${NET_PORT_CLIENT_BIN:-}" \
    "/root/net_port/source/build/client/module_net_port_client-${version}" \
    "${ROOT_DIR:-}/build/client/module_net_port_client-${version}"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  return 1
}

resolve_ssl_cert_file() {
  local candidate
  for candidate in \
    "${NET_PORT_SSL_CERT:-}" \
    "${NET_PORT_CONTROL_CA_FILE:-}" \
    "/root/net_port/ssl/server.crt"; do
    if [ -n "$candidate" ] && [ -f "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

start_mock_ssh_server() {
  local port="${1:-$MOCK_SSH_PORT}"
  local script_dir mock_script
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  mock_script="${script_dir}/lib/mock_ssh_server.py"

  if [ ! -f "$mock_script" ]; then
    log "Mock SSH script not found: ${mock_script}"
    return 1
  fi

  python3 "$mock_script" "$port" >/tmp/net_port_mock_ssh.log 2>&1 &
  MOCK_SSH_PID=$!
  sleep 0.5

  if ! kill -0 "$MOCK_SSH_PID" 2>/dev/null; then
    log "Mock SSH server failed to start"
    cat /tmp/net_port_mock_ssh.log >&2 || true
    return 1
  fi

  if ! wait_for_port "$port" 20 0.2; then
    log "Mock SSH server port ${port} is not listening"
    return 1
  fi

  log "Mock SSH server started on 127.0.0.1:${port} (pid=${MOCK_SSH_PID})"
  return 0
}

stop_mock_ssh_server() {
  if [ -n "$MOCK_SSH_PID" ] && kill -0 "$MOCK_SSH_PID" 2>/dev/null; then
    kill "$MOCK_SSH_PID" 2>/dev/null || true
    wait "$MOCK_SSH_PID" 2>/dev/null || true
  fi
  MOCK_SSH_PID=""
}

start_device_client() {
  local client_bin ssl_cert log_file
  client_bin="$(resolve_client_binary || true)"
  ssl_cert="$(resolve_ssl_cert_file || true)"

  if [ -z "$client_bin" ]; then
    log "Device client binary not found"
    return 1
  fi
  if [ -z "$ssl_cert" ]; then
    log "Server certificate not found for device client TLS"
    return 1
  fi

  log_file="${NET_PORT_CLIENT_LOG:-/tmp/net_port_client_${DEVICE_ID}.log}"
  : >"$log_file"

  (
    cd /tmp || cd /
    exec "$client_bin" \
      --device-id "$DEVICE_ID" \
      --device-token "$AUTH_TOKEN" \
      --registration-server "$CONTROL_HOST" \
      --registration-port "$CONTROL_PORT" \
      --registration-ca-file "$ssl_cert" \
      --host_out "$INTERNAL_ADDRESS" \
      -p_out "$INTERNAL_PORT"
  ) >>"$log_file" 2>&1 &

  CLIENT_PID=$!
  log "Device client started (pid=${CLIENT_PID}, log=${log_file})"
  sleep 1
  return 0
}

stop_device_client() {
  if [ -n "$CLIENT_PID" ] && kill -0 "$CLIENT_PID" 2>/dev/null; then
    kill "$CLIENT_PID" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      if ! kill -0 "$CLIENT_PID" 2>/dev/null; then
        break
      fi
      sleep 0.5
    done
    kill -9 "$CLIENT_PID" 2>/dev/null || true
    wait "$CLIENT_PID" 2>/dev/null || true
  fi
  CLIENT_PID=""
}

probe_tls_server() {
  local port="$1"
  python3 - "$CONTROL_HOST" "$port" <<'PY'
import socket
import ssl
import sys

host = sys.argv[1]
port = int(sys.argv[2])
sock = socket.create_connection((host, port), timeout=5)
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
tls = ctx.wrap_socket(sock, server_hostname=host)
tls.do_handshake()
version = tls.version()
tls.close()
print(version or "TLS")
PY
}

probe_plain_tcp_rejected_on_tls_port() {
  local port="$1"
  python3 - "$CONTROL_HOST" "$port" <<'PY'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
sock = socket.create_connection((host, port), timeout=3)
sock.settimeout(2)
try:
    data = sock.recv(16)
except Exception:
    data = b""
sock.close()
if data.startswith(b"SSH-"):
    raise SystemExit(1)
raise SystemExit(0)
PY
}

read_ssh_banner_via_tunnel() {
  local port="$1"
  local attempts="${2:-40}"
  python3 - "$CONTROL_HOST" "$port" "$attempts" <<'PY'
import socket
import sys
import time

host = sys.argv[1]
port = int(sys.argv[2])
attempts = int(sys.argv[3])
client_hello = b"SSH-2.0-net_port-integration-test\r\n"

for _ in range(attempts):
    try:
        sock = socket.create_connection((host, port), timeout=3)
        sock.settimeout(5)
        sock.sendall(client_hello)
        banner = sock.recv(256)
        sock.close()
        if banner.startswith(b"SSH-2.0"):
            print(banner.decode("ascii", errors="replace").strip())
            raise SystemExit(0)
    except OSError:
        pass
    time.sleep(0.5)

raise SystemExit(1)
PY
}

wait_for_device_registered() {
  local attempts="${1:-90}"
  local delay="${2:-1}"
  local assigned_port device_status
  local i

  for ((i = 1; i <= attempts; i++)); do
    device_status="$(psql_exec "SELECT status FROM devices WHERE device_id = '${DEVICE_ID}';")"
    assigned_port="$(psql_exec "SELECT assigned_port FROM devices WHERE device_id = '${DEVICE_ID}';")"
    if [ "$device_status" = "active" ] && [ -n "$assigned_port" ] && [ "$assigned_port" != "null" ]; then
      INPUT_PORT="$assigned_port"
      TUNNEL_PORT=$((assigned_port + 1))
      log "device registered with input=${INPUT_PORT} tunnel=${TUNNEL_PORT}"
      return 0
    fi
    sleep "$delay"
  done

  return 1
}

device_flag_enabled() {
  local column="$1"
  local value
  value="$(psql_exec "SELECT ${column} FROM devices WHERE device_id = '${DEVICE_ID}';")"
  [ "$value" = "t" ] || [ "$value" = "true" ] || [ "$value" = "1" ]
}

wait_for_port() {
  local port="$1"
  local attempts="${2:-20}"
  local delay="${3:-0.5}"
  local i

  for ((i = 1; i <= attempts; i++)); do
    if command -v ss >/dev/null 2>&1; then
      if ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq ":${port}$"; then
        return 0
      fi
    elif python3 - "$CONTROL_HOST" "$port" <<'PY' >/dev/null 2>&1; then
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
sock = socket.socket()
sock.settimeout(1)
try:
    sock.connect((host, port))
except OSError:
    raise SystemExit(1)
finally:
    sock.close()
PY
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

apply_assigned_ports_from_response() {
  local response="$1"
  local assigned_port tunnel_port

  assigned_port="$(json_field assigned_port "$response")"
  tunnel_port="$(json_field tunnel_port "$response")"
  if [ -n "$assigned_port" ]; then
    INPUT_PORT="$assigned_port"
    TUNNEL_PORT="${tunnel_port:-$((assigned_port + 1))}"
    log "using assigned ports input=${INPUT_PORT} tunnel=${TUNNEL_PORT}"
  fi
}

assert_ports_listening() {
  local ok=0
  local attempts="${1:-30}"
  if wait_for_port "$INPUT_PORT" "$attempts"; then
    pass "input port ${INPUT_PORT} is listening"
  else
    fail "input port ${INPUT_PORT} is not listening"
    ok=1
  fi

  if wait_for_port "$TUNNEL_PORT" "$attempts"; then
    pass "tunnel port ${TUNNEL_PORT} is listening"
  else
    fail "tunnel port ${TUNNEL_PORT} is not listening"
    ok=1
  fi

  return "$ok"
}

register_device() {
  local payload="${1:-}"
  local response=""
  local attempt

  if [ -z "$payload" ]; then
    payload="$(printf '{"action":"register","device_id":"%s","auth_token":"%s","version":"1.0"}' "$DEVICE_ID" "$AUTH_TOKEN")"
  fi

  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    response="$(send_control_json "$payload" 2>/dev/null || true)"
    if [ -n "$response" ]; then
      printf '%s' "$response"
      return 0
    fi
    sleep 0.5
  done

  printf '%s' "$response"
}

disconnect_device() {
  local response=""
  local attempt
  for attempt in 1 2 3; do
    response="$(send_control_json "{\"action\":\"disconnect\",\"device_id\":\"${DEVICE_ID}\"}" || true)"
    if [ -n "$response" ]; then
      printf '%s' "$response"
      return 0
    fi
    sleep 0.5
  done
  printf '%s' "$response"
}

check_prerequisites() {
  require_cmd psql
  require_cmd python3
  require_cmd sha256sum

  send_control_json '{"action":"reset_rate_limits"}' >/dev/null 2>&1 || true

  local attempt control_ok=0
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if python3 - "$CONTROL_HOST" "$CONTROL_PORT" <<'PY' >/dev/null 2>&1; then
import os
import socket
import ssl
import sys

host = sys.argv[1]
port = int(sys.argv[2])
sock = socket.create_connection((host, port), timeout=5)
if os.environ.get("NET_PORT_CONTROL_SSL", "1") != "0":
    ctx = ssl.create_default_context()
    ca_file = os.environ.get("NET_PORT_CONTROL_CA_FILE")
    if ca_file:
        ctx.load_verify_locations(cafile=ca_file)
    else:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    sock = ctx.wrap_socket(sock, server_hostname=host)
sock.close()
PY
      control_ok=1
      break
    fi
    sleep 0.5
  done

  if [ "$control_ok" -ne 1 ]; then
    log "Control server is not reachable at ${CONTROL_HOST}:${CONTROL_PORT}"
    log "Start the net_port server with device management enabled, then rerun this test."
    exit 1
  fi

  if ! PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" >/dev/null 2>&1; then
    log "Cannot connect to PostgreSQL at ${DB_HOST}:${DB_PORT}/${DB_NAME}"
    exit 1
  fi
}
