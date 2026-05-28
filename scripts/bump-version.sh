#!/usr/bin/env bash
# Единый bump версии клиента/сервера (источник: VERSION в корне репозитория).
#
#   ./scripts/bump-version.sh              # показать текущую версию
#   ./scripts/bump-version.sh 0.0.5        # задать явно
#   ./scripts/bump-version.sh patch        # 0.0.4 -> 0.0.5
#   ./scripts/bump-version.sh minor        # 0.0.4 -> 0.1.0
#   ./scripts/bump-version.sh major        # 0.0.4 -> 1.0.0
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="${ROOT}/VERSION"

read_current() {
  tr -d '[:space:]' < "${VERSION_FILE}"
}

bump_part() {
  local mode="$1"
  local current="$2"
  local major minor patch
  IFS='.' read -r major minor patch <<< "${current}"
  major="${major:-0}"
  minor="${minor:-0}"
  patch="${patch:-0}"

  case "${mode}" in
    major)
      echo "$((major + 1)).0.0"
      ;;
    minor)
      echo "${major}.$((minor + 1)).0"
      ;;
    patch)
      echo "${major}.${minor}.$((patch + 1))"
      ;;
    *)
      echo "Invalid bump mode: ${mode}" >&2
      exit 1
      ;;
  esac
}

validate_version() {
  if [[ ! "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Version must be MAJOR.MINOR.PATCH (e.g. 0.0.5), got: $1" >&2
    exit 1
  fi
}

update_cmake() {
  local file="$1"
  local version="$2"
  local major minor patch
  IFS='.' read -r major minor patch <<< "${version}"

  sed -i "s/^set(VERSION_MAJOR .*/set(VERSION_MAJOR ${major})/" "${file}"
  sed -i "s/^set(VERSION_MINOR .*/set(VERSION_MINOR ${minor})/" "${file}"
  sed -i "s/^set(VERSION_PATCH .*/set(VERSION_PATCH ${patch})/" "${file}"
}

update_frontend_consts() {
  local version="$1"
  local file="${ROOT}/web/frontend_net_port/src/consts/client.js"
  local binary="module_net_port_client-${version}"

  sed -i "s|^export const CLIENT_BINARY_NAME = .*|export const CLIENT_BINARY_NAME = '${binary}';|" "${file}"
  sed -i "s|^export const CLIENT_VERSION_LABEL = .*|export const CLIENT_VERSION_LABEL = '${version}';|" "${file}"
}

if [[ ! -f "${VERSION_FILE}" ]]; then
  echo "Missing ${VERSION_FILE}" >&2
  exit 1
fi

CURRENT="$(read_current)"

if [[ $# -eq 0 ]]; then
  echo "Current version: ${CURRENT}"
  echo "Client binary:   module_net_port_client-${CURRENT}"
  exit 0
fi

ARG="$1"
case "${ARG}" in
  patch|minor|major)
    NEW="$(bump_part "${ARG}" "${CURRENT}")"
    ;;
  *)
    NEW="${ARG}"
    validate_version "${NEW}"
    ;;
esac

if [[ "${NEW}" == "${CURRENT}" ]]; then
  echo "Version unchanged: ${CURRENT}"
  exit 0
fi

echo "${NEW}" > "${VERSION_FILE}"

for cmake_file in \
  "${ROOT}/client/CMakeLists.txt" \
  "${ROOT}/server/CMakeLists.txt" \
  "${ROOT}/client_win/CMakeLists.txt"
do
  if [[ -f "${cmake_file}" ]]; then
    update_cmake "${cmake_file}" "${NEW}"
    echo "Updated ${cmake_file#${ROOT}/}"
  fi
done

update_frontend_consts "${NEW}"

echo "Bumped ${CURRENT} -> ${NEW}"
echo "Next: rebuild C targets and frontend; for arm clients run scripts/build-client-cross.sh"
