#!/usr/bin/env bash
# Security tests: payload validation, SQL injection safety, rate limiting.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=lib/common.sh
source "${ROOT_DIR}/scripts/integration/lib/common.sh"

RATE_LIMIT_REQUESTS="${NET_PORT_RATE_LIMIT_PROBE:-120}"

main() {
  local response status message rate_limited=0

  log "security tests control=${CONTROL_HOST}:${CONTROL_PORT} rate_probe=${RATE_LIMIT_REQUESTS}"
  check_prerequisites

  response="$(send_control_raw '{not-json' || true)"
  status="$(json_field status "$response")"
  message="$(json_field message "$response")"
  if [ "$status" = "error" ] && [[ "$message" == *"Invalid"* ]]; then
    pass "malformed JSON rejected"
  else
    fail "malformed JSON not rejected (status=${status:-empty} message=${message:-empty})"
  fi

  response="$(send_control_json '{}' || true)"
  message="$(json_field message "$response")"
  if [[ "$message" == *"Missing 'action' field"* ]]; then
    pass "missing action rejected"
  else
    fail "missing action not rejected (message=${message:-empty})"
  fi

  response="$(send_control_json '{"action":"register","device_id":"test\"; DROP TABLE devices; --","auth_token":"x"}' || true)"
  status="$(json_field status "$response")"
  message="$(json_field message "$response")"
  if [ "$status" = "error" ]; then
    pass "SQL injection payload handled safely (${message})"
  else
    fail "unexpected response to SQL injection payload: status=${status:-empty}"
  fi

  if ! PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -Atqc "SELECT to_regclass('public.devices');" | grep -q devices; then
    fail "devices table missing after SQL injection probe"
  else
    pass "devices table still present after SQL injection probe"
  fi

  log "probing rate limit with ${RATE_LIMIT_REQUESTS} rapid register attempts..."
  for i in $(seq 1 "$RATE_LIMIT_REQUESTS"); do
    response="$(send_control_json "{\"action\":\"register\",\"device_id\":\"rate-probe-${i}\",\"auth_token\":\"invalid\",\"version\":\"1.0\"}" || true)"
    message="$(json_field message "$response")"
    if [[ "$message" == *"Rate limit exceeded"* ]]; then
      rate_limited=1
      break
    fi
  done

  if [ "$rate_limited" -eq 1 ]; then
    pass "rate limiting triggered after burst requests"
  else
    fail "rate limiting was not triggered after ${RATE_LIMIT_REQUESTS} requests"
  fi

  summary || exit 1
}

main "$@"
