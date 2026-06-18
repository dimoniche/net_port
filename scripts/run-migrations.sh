#!/usr/bin/env bash
# Apply pending SQL migrations tracked in schema_migrations.
set -euo pipefail

DB_NAME="${DB_NAME:-net_port}"
DB_USER="${DB_USER:-admin}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
USE_LOCAL_DB="${USE_LOCAL_DB:-false}"

resolve_migrations_dir() {
  for candidate in \
    "${MIGRATIONS_DIR:-}" \
    /etc/postgresql/migrations \
    /root/net_port/source/sql/migrations \
    "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/sql/migrations"
  do
    if [ -n "${candidate}" ] && [ -d "${candidate}" ]; then
      echo "${candidate}"
      return 0
    fi
  done
  echo "Migrations directory not found" >&2
  return 1
}

run_psql() {
  if [ "${USE_LOCAL_DB}" = "true" ]; then
    su - postgres -c "psql -d ${DB_NAME} -v ON_ERROR_STOP=1 $(printf '%q ' "$@")"
  else
    PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 "$@"
  fi
}

table_exists() {
  local table_name="$1"
  if [ "${USE_LOCAL_DB}" = "true" ]; then
    su - postgres -c "psql -d ${DB_NAME} -tAc \"SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='${table_name}'\"" | grep -q 1
  else
    PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -tAc \
      "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='${table_name}'" | grep -q 1
  fi
}

migration_applied() {
  local version="$1"
  local applied
  if [ "${USE_LOCAL_DB}" = "true" ]; then
    applied="$(su - postgres -c "psql -d ${DB_NAME} -tAc \"SELECT 1 FROM schema_migrations WHERE version=${version}\"")"
  else
    applied="$(PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -tAc \
      "SELECT 1 FROM schema_migrations WHERE version=${version}")"
  fi
  [ "${applied}" = "1" ]
}

record_migration() {
  local version="$1"
  local name="$2"
  local escaped_name
  escaped_name="${name//\'/\'\'}"
  run_psql -c "INSERT INTO schema_migrations (version, name) VALUES (${version}, '${escaped_name}') ON CONFLICT (version) DO NOTHING;"
}

baseline_existing_schema() {
  if ! table_exists "schema_migrations"; then
    return 0
  fi

  local count
  if [ "${USE_LOCAL_DB}" = "true" ]; then
    count="$(su - postgres -c "psql -d ${DB_NAME} -tAc \"SELECT COUNT(*) FROM schema_migrations\"")"
  else
    count="$(PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -tAc \
      "SELECT COUNT(*) FROM schema_migrations")"
  fi

  if [ "${count}" != "0" ]; then
    return 0
  fi

  if ! table_exists "users"; then
    return 0
  fi

  echo "Baselining schema_migrations for existing database..."
  local file version name
  for file in "${MIGRATIONS_DIR}"/[0-9][0-9][0-9]_*.sql; do
    [ -f "${file}" ] || continue
    name="$(basename "${file}")"
    version="${name%%_*}"
    version=$((10#${version}))
    if [ "${version}" -eq 0 ]; then
      continue
    fi
    # 008 was missing from legacy start.sh — allow it to run on upgraded databases.
    if [ "${version}" -eq 8 ]; then
      continue
    fi
    record_migration "${version}" "${name%.sql}"
  done
}

apply_grants() {
  local grant_file=""
  for candidate in \
    /etc/postgresql/grant_app_privileges.sql \
    /root/net_port/source/sql/grant_app_privileges.sql
  do
    if [ -f "${candidate}" ]; then
      grant_file="${candidate}"
      break
    fi
  done

  if [ -z "${grant_file}" ]; then
    return 0
  fi

  echo "Applying application grants for role '${DB_USER}'..."
  if [ "${USE_LOCAL_DB}" = "true" ]; then
    su - postgres -c "psql -d ${DB_NAME} -v ON_ERROR_STOP=0 -c \"SET net_port.app_role = '${DB_USER}'\" -f ${grant_file}" || true
  else
    PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=0 \
      -c "SET net_port.app_role = '${DB_USER}'" -f "${grant_file}" || true
    if [ -n "${DB_SUPERUSER:-}" ] && [ -n "${DB_SUPERUSER_PASSWORD:-}" ]; then
      PGPASSWORD="${DB_SUPERUSER_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_SUPERUSER}" -d "${DB_NAME}" -v ON_ERROR_STOP=0 \
        -c "SET net_port.app_role = '${DB_USER}'" -f "${grant_file}" || true
    fi
  fi
}

MIGRATIONS_DIR="$(resolve_migrations_dir)"
echo "Using migrations from ${MIGRATIONS_DIR}"

run_psql -f "${MIGRATIONS_DIR}/000_schema_migrations.sql"
baseline_existing_schema

shopt -s nullglob
migration_files=("${MIGRATIONS_DIR}"/[0-9][0-9][0-9]_*.sql)
IFS=$'\n' migration_files=($(printf '%s\n' "${migration_files[@]}" | sort))
unset IFS

for file in "${migration_files[@]}"; do
  name="$(basename "${file}")"
  version="${name%%_*}"
  version=$((10#${version}))

  if [ "${version}" -eq 0 ]; then
    continue
  fi

  if migration_applied "${version}"; then
    continue
  fi

  echo "Applying migration ${version}: ${name}"
  run_psql -f "${file}"
  record_migration "${version}" "${name%.sql}"
done

apply_grants
echo "Database migrations are up to date."
