#!/usr/bin/env bash
# Safe production upgrade: preserves legacy servers in `servers` table.
# Run on the target host (or via: ssh user@host 'bash -s' < scripts/upgrade-server.sh)
set -euo pipefail

ROOT="${NET_PORT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_DIR="${NET_PORT_BACKUP_DIR:-/root/net_port_backups}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_PATH="${BACKUP_DIR}/net_port_${TIMESTAMP}"

DB_USER="${DB_USER:-admin}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-net_port}"

log() { echo "[upgrade] $*"; }
warn() { echo "[upgrade][WARN] $*" >&2; }
die() { echo "[upgrade][ERROR] $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

psql_cmd() {
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" "$@"
}

detect_mode() {
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'net_port_app'; then
    echo docker
  elif systemctl list-units --type=service --all 2>/dev/null | grep -q 'net-port-server'; then
    echo systemd
  elif systemctl list-units --type=service --all 2>/dev/null | grep -q 'net_port_ui'; then
    echo legacy_ui
  elif ls /etc/systemd/system/net_port_u*.service >/dev/null 2>&1; then
    echo legacy_per_user
  else
    echo unknown
  fi
}

snapshot_legacy_servers() {
  local out="$1"
  psql_cmd -At -F $'\t' -c \
    "SELECT id, user_id, input_port, output_port, enable, COALESCE(description,'')
     FROM servers ORDER BY id;" > "$out"
  log "Legacy servers snapshot: $(wc -l < "$out") rows -> $out"
}

verify_legacy_servers() {
  local before="$1"
  local after="$2"

  if ! diff -q "$before" "$after" >/dev/null 2>&1; then
    warn "Legacy servers table changed during upgrade."
    diff -u "$before" "$after" || true
    warn "Review diff above. Rows in 6000-7000 may have been migrated intentionally."
    return 1
  fi
  log "Legacy servers table unchanged."
  return 0
}

backup_database() {
  mkdir -p "$BACKUP_PATH"
  log "Backing up critical tables to $BACKUP_PATH"

  psql_cmd -c "\copy servers TO '${BACKUP_PATH}/servers.csv' CSV HEADER"
  psql_cmd -c "\copy statistic TO '${BACKUP_PATH}/statistic.csv' CSV HEADER" 2>/dev/null || true
  psql_cmd -c "\copy users TO '${BACKUP_PATH}/users.csv' CSV HEADER" 2>/dev/null || true

  PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t servers -t statistic -t users -t role \
    > "${BACKUP_PATH}/legacy_tables.sql" 2>/dev/null || warn "pg_dump partial backup failed"

  snapshot_legacy_servers "${BACKUP_PATH}/servers_before.tsv"
}

preflight_legacy_ports() {
  local bad
  bad="$(psql_cmd -At -c \
    "SELECT count(*) FROM servers
     WHERE enable = true
       AND (input_port BETWEEN 6000 AND 7000 OR output_port BETWEEN 6000 AND 7000);")"
  if [ "${bad:-0}" != "0" ]; then
    warn "${bad} enabled legacy server(s) use ports 6000-7000."
    warn "They will be moved to 5998/5999 and disabled (device port pool conflict)."
    warn "Reassign legacy servers to 5000-5999 before upgrade to keep them active."
    psql_cmd -c \
      "SELECT id, user_id, input_port, output_port, enable, description
       FROM servers
       WHERE enable = true
         AND (input_port BETWEEN 6000 AND 7000 OR output_port BETWEEN 6000 AND 7000);"
  fi
}

apply_sql_migrations() {
  local sql_dir="$ROOT/sql"
  [ -d "$sql_dir" ] || sql_dir="/root/net_port/source/sql"

  local files=(
    port_release_fix.sql
    server_port_separation.sql
    internal_port_range_fix.sql
    device_traffic_samples.sql
    device_preferred_port.sql
    user_auto_connect.sql
    device_delete_notify.sql
    device_connecting_status_fix.sql
  )

  for file in "${files[@]}"; do
    local path="${sql_dir}/${file}"
    if [ -f "$path" ]; then
      log "Applying migration: $file"
      psql_cmd -v ON_ERROR_STOP=0 -f "$path" || warn "Migration $file reported errors (may be idempotent)"
    fi
  done

  if ! psql_cmd -tAc "SELECT 1 FROM information_schema.tables WHERE table_name='devices'" | grep -q 1; then
    local init_device="$ROOT/init_device_db.sql"
    [ -f "$init_device" ] || init_device="/etc/postgresql/init_device_db.sql"
    if [ -f "$init_device" ]; then
      log "Creating device management schema (first install)"
      sed -e '/^\\c/d' "$init_device" | psql_cmd -v ON_ERROR_STOP=1 -f - \
        || warn "init_device_db.sql failed"
    fi
  else
    log "Device tables already exist, skipping init_device_db.sql"
  fi
}

patch_systemd_device_management() {
  local changed=0
  shopt -s nullglob
  for unit in /etc/systemd/system/net_port_u*.service /etc/systemd/system/net-port-server.service; do
    [ -f "$unit" ] || continue
    if grep -q 'enable-device-management' "$unit"; then
      continue
    fi
    log "Patching $unit for device management"
    sed -i 's|\(--threads [0-9]\+\)|\1 --enable-device-management --device-control-port 8443|' "$unit" \
      || sed -i 's|module_net_port_server|& --enable-device-management --device-control-port 8443|' "$unit"
    changed=1
  done
  shopt -u nullglob
  if [ "$changed" -eq 1 ]; then
    systemctl daemon-reload
  fi
}

restart_services() {
  local mode="$1"
  case "$mode" in
    docker)
      log "Recreating docker container"
      local compose_dir="$ROOT"
      for candidate in /root/net_port /opt/net_port "$ROOT"; do
        if [ -f "${candidate}/docker-compose.yml" ]; then
          compose_dir="$candidate"
          break
        fi
      done
      if [ -f "${compose_dir}/docker-compose.yml" ]; then
        (cd "$compose_dir" && docker compose up -d --force-recreate net_port)
      else
        docker restart net_port_app
      fi
      ;;
    systemd)
      patch_systemd_device_management
      systemctl restart net-port-server net-port-backend nginx || true
      ;;
    legacy_ui|legacy_per_user)
      patch_systemd_device_management
      systemctl restart net_port_ui nginx 2>/dev/null || true
      shopt -s nullglob
      for unit in /etc/systemd/system/net_port_u*.service; do
        systemctl restart "$(basename "$unit")" || warn "Failed to restart $(basename "$unit")"
      done
      shopt -u nullglob
      ;;
    *)
      warn "Unknown deployment mode; restart services manually"
      ;;
  esac
}

upgrade_docker_binary() {
  local image="${NET_PORT_IMAGE:-net_port:latest}"
  if [ -f "${NET_PORT_IMAGE_TAR:-}" ]; then
    log "Loading docker image from ${NET_PORT_IMAGE_TAR}"
    docker load -i "${NET_PORT_IMAGE_TAR}"
  fi
  if docker image inspect "$image" >/dev/null 2>&1; then
    log "Using docker image: $image"
  else
    warn "Docker image $image not found. Build locally and transfer with docker save/load."
  fi
}

upgrade_native_binary() {
  local bin_src="${NET_PORT_SERVER_BIN:-}"
  if [ -z "$bin_src" ]; then
    bin_src="$(find "$ROOT/build/server" -name 'module_net_port_server-*' -type f 2>/dev/null | head -1)"
  fi
  [ -n "$bin_src" ] || { warn "Server binary not found, skipping native binary update"; return 0; }

  local bin_dst="/root/net_port/$(basename "$bin_src")"
  mkdir -p /root/net_port
  log "Installing C server: $bin_src -> $bin_dst"
  install -m 755 "$bin_src" "$bin_dst"
}

main() {
  require_cmd psql
  [ -n "$DB_PASSWORD" ] || die "Set DB_PASSWORD (and DB_HOST if external DB)"

  local mode
  mode="$(detect_mode)"
  log "Detected deployment mode: $mode"
  log "Database: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

  preflight_legacy_ports
  backup_database
  apply_sql_migrations

  case "$mode" in
    docker) upgrade_docker_binary ;;
    systemd|legacy_ui|legacy_per_user) upgrade_native_binary ;;
  esac

  restart_services "$mode"

  sleep 5
  snapshot_legacy_servers "${BACKUP_PATH}/servers_after.tsv"
  verify_legacy_servers "${BACKUP_PATH}/servers_before.tsv" "${BACKUP_PATH}/servers_after.tsv" || true

  log "Upgrade finished. Backup: $BACKUP_PATH"
  log "Check health: curl -s http://127.0.0.1:8080/health"
  log "Legacy servers: psql ... -c 'SELECT id,input_port,output_port,enable FROM servers ORDER BY id;'"
}

main "$@"
