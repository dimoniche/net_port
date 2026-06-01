#!/usr/bin/env bash
# Shared helpers for net_port integration tests.

CONTROL_HOST="${NET_PORT_CONTROL_HOST:-127.0.0.1}"
CONTROL_PORT="${NET_PORT_CONTROL_PORT:-8443}"
DEVICE_ID="${NET_PORT_TEST_DEVICE_ID:-integration-test}"
AUTH_TOKEN="${NET_PORT_TEST_AUTH_TOKEN:-integration-test-token}"
INPUT_PORT="${NET_PORT_TEST_INPUT_PORT:-6000}"
TUNNEL_PORT="${NET_PORT_TEST_TUNNEL_PORT:-6001}"
PREFERRED_PORT="${NET_PORT_TEST_PREFERRED_PORT:-}"

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
      internal_address, internal_port, user_id, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), '${DEVICE_ID}', 'Integration Test Device', '${status}', '${token_hash}', ${preferred_sql},
      '127.0.0.1', 22, ${user_id}, NOW(), NOW()
    )
    ON CONFLICT (device_id) DO UPDATE SET
      status = EXCLUDED.status,
      auth_token_hash = EXCLUDED.auth_token_hash,
      preferred_port = EXCLUDED.preferred_port,
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
  delete_test_devices_matching "${NET_PORT_LOAD_PREFIX:-load-test}-%"
  delete_test_device_by_id "${NET_PORT_TEST_DEVICE_ID:-integration-test}"
  log "Removed test devices from database"
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
