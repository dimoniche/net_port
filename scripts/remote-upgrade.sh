#!/usr/bin/env bash
# Remote upgrade helper for production hosts (e.g. 185.135.80.41).
#
# Usage:
#   ./scripts/remote-upgrade.sh HOST SSH_USER SSH_PASSWORD \
#     DB_NAME DB_USER DB_PASSWORD DB_HOST DB_PORT
#
# Optional env:
#   NET_PORT_BRANCH=feature/version4   git branch to deploy (native mode)
#   NET_PORT_IMAGE_TAR=/path/net_port.tar.gz   docker image archive
#   NET_PORT_SKIP_BUILD=1              skip local docker build
#
set -euo pipefail

HOST="${1:-}"
SSH_USER="${2:-}"
SSH_PASSWORD="${3:-}"
DB_NAME="${4:-net_port}"
DB_USER="${5:-admin}"
DB_PASSWORD="${6:-}"
DB_HOST="${7:-localhost}"
DB_PORT="${8:-5432}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_DIR="/root/net_port_upgrade"
IMAGE_TAR="${NET_PORT_IMAGE_TAR:-/tmp/net_port_latest.tar.gz}"
BRANCH="${NET_PORT_BRANCH:-feature/version4}"

die() { echo "[remote-upgrade] ERROR: $*" >&2; exit 1; }

[ -n "$HOST" ] && [ -n "$SSH_USER" ] && [ -n "$SSH_PASSWORD" ] && [ -n "$DB_PASSWORD" ] \
  || die "Usage: $0 HOST SSH_USER SSH_PASSWORD DB_NAME DB_USER DB_PASSWORD [DB_HOST] [DB_PORT]"

require_cmd() { command -v "$1" >/dev/null 2>&1 || die "Missing: $1"; }

ssh_run() {
  if command -v sshpass >/dev/null 2>&1; then
    sshpass -p "$SSH_PASSWORD" ssh -o StrictHostKeyChecking=no "${SSH_USER}@${HOST}" "$@"
  else
    require_cmd python3
    python3 - "$HOST" "$SSH_USER" "$SSH_PASSWORD" "$@" <<'PY'
import paramiko, sys
host, user, password = sys.argv[1:4]
cmd = " ".join(sys.argv[4:])
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=password, timeout=20)
stdin, stdout, stderr = client.exec_command(cmd)
code = stdout.channel.recv_exit_status()
out = stdout.read().decode()
err = stderr.read().decode()
if out: print(out, end="")
if err: print(err, end="", file=sys.stderr)
client.close()
sys.exit(code)
PY
  fi
}

scp_put() {
  local src="$1" dst="$2"
  if command -v sshpass >/dev/null 2>&1; then
    sshpass -p "$SSH_PASSWORD" scp -o StrictHostKeyChecking=no "$src" "${SSH_USER}@${HOST}:$dst"
  else
    python3 - "$HOST" "$SSH_USER" "$SSH_PASSWORD" "$src" "$dst" <<'PY'
import paramiko, sys
host, user, password, src, dst = sys.argv[1:6]
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=password, timeout=20)
sftp = client.open_sftp()
sftp.put(src, dst)
sftp.close()
client.close()
PY
  fi
}

detect_remote_mode() {
  ssh_run "docker ps --format '{{.Names}}' 2>/dev/null | grep -qx net_port_app && echo docker || (
    systemctl list-units --type=service --all 2>/dev/null | grep -q net-port-server && echo systemd ||
    systemctl list-units --type=service --all 2>/dev/null | grep -q net_port_ui && echo legacy_ui ||
    ls /etc/systemd/system/net_port_u*.service >/dev/null 2>&1 && echo legacy_per_user || echo unknown
  )"
}

echo "[remote-upgrade] Probing ${HOST}..."
MODE="$(detect_remote_mode | tail -1 | tr -d '\r\n')"
echo "[remote-upgrade] Remote mode: ${MODE}"

ssh_run "mkdir -p ${REMOTE_DIR}"

echo "[remote-upgrade] Uploading upgrade-server.sh and SQL migrations..."
tar -C "$ROOT" -czf /tmp/net_port_upgrade_bundle.tgz scripts/upgrade-server.sh sql init_device_db.sql docker-compose.yml
scp_put /tmp/net_port_upgrade_bundle.tgz "${REMOTE_DIR}/bundle.tgz"
ssh_run "tar -xzf ${REMOTE_DIR}/bundle.tgz -C ${REMOTE_DIR}"

if [ "$MODE" = "docker" ]; then
  if [ "${NET_PORT_SKIP_BUILD:-0}" != "1" ]; then
    echo "[remote-upgrade] Building docker image locally..."
    (cd "$ROOT" && docker compose build net_port)
    docker save net_port:latest | gzip > "$IMAGE_TAR"
  fi
  echo "[remote-upgrade] Uploading docker image (may take a while)..."
  scp_put "$IMAGE_TAR" "${REMOTE_DIR}/net_port.tar.gz"
  ssh_run "docker load < ${REMOTE_DIR}/net_port.tar.gz"
  ssh_run "export DB_USER='${DB_USER}' DB_PASSWORD='${DB_PASSWORD}' DB_HOST='${DB_HOST}' DB_PORT='${DB_PORT}' DB_NAME='${DB_NAME}' NET_PORT_ROOT='${REMOTE_DIR}' NET_PORT_IMAGE_TAR='${REMOTE_DIR}/net_port.tar.gz'; bash ${REMOTE_DIR}/scripts/upgrade-server.sh"
else
  echo "[remote-upgrade] Native/legacy deployment detected."
  if [ "${NET_PORT_SKIP_BUILD:-0}" != "1" ]; then
    (cd "$ROOT" && mkdir -p build && cd build && cmake .. && make -j"$(nproc)" module_net_port_server-0.0.4)
  fi
  SERVER_BIN="$(find "$ROOT/build/server" -name 'module_net_port_server-*' -type f | head -1)"
  [ -n "$SERVER_BIN" ] || die "Server binary not built"
  scp_put "$SERVER_BIN" "${REMOTE_DIR}/module_net_port_server"
  ssh_run "export DB_USER='${DB_USER}' DB_PASSWORD='${DB_PASSWORD}' DB_HOST='${DB_HOST}' DB_PORT='${DB_PORT}' DB_NAME='${DB_NAME}' NET_PORT_ROOT='${REMOTE_DIR}' NET_PORT_SERVER_BIN='${REMOTE_DIR}/module_net_port_server'; bash ${REMOTE_DIR}/scripts/upgrade-server.sh"
  echo "[remote-upgrade] Update web UI separately if needed (web/deploy/main.py or install.sh)."
fi

echo "[remote-upgrade] Done. Verify:"
echo "  curl -s http://${HOST}:8080/health"
echo "  curl -s http://${HOST}/health"
