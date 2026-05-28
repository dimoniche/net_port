#!/usr/bin/env bash
# Кросс-сборка Windows-клиента (MinGW) → artifacts/clients/*.exe
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f "${ROOT}/VERSION" ]]; then
  VERSION="$(tr -d '[:space:]' < "${ROOT}/VERSION")"
else
  read_version() {
    grep "^set($1 " client_win/CMakeLists.txt | awk '{print $2}' | tr -d ')'
  }
  VERSION="$(read_version VERSION_MAJOR).$(read_version VERSION_MINOR).$(read_version VERSION_PATCH)"
fi

MODULE="module_net_port_client"
TARGET="${MODULE}-${VERSION}"
OUTPUT_NAME="${TARGET}.exe"
OUT_DIR="${ROOT}/artifacts/clients"
IMAGE="net_port-cross-client-windows:build"

echo "==> Windows cross-build ${OUTPUT_NAME} (MinGW x86_64)"

docker build \
  -f scripts/cross-build-client-windows.Dockerfile \
  -t "${IMAGE}" \
  .

mkdir -p "${OUT_DIR}"

docker run --rm -i \
  -e "TARGET=${TARGET}" \
  -e "OUTPUT_NAME=${OUTPUT_NAME}" \
  -v "${ROOT}:/src:ro" \
  -v "${OUT_DIR}:/out" \
  "${IMAGE}" \
  /bin/bash -s <<'EOF'
set -euo pipefail
BUILD=/tmp/net_port_win_build
rm -rf "$BUILD"
cmake -S /src/client_win -B "$BUILD" \
  -DCMAKE_TOOLCHAIN_FILE=/src/client_win/cmake/toolchain-mingw64.cmake \
  -DCMAKE_BUILD_TYPE=Release
cmake --build "$BUILD" --target "$TARGET" -j4
BIN="$BUILD/${TARGET}.exe"
test -f "$BIN"
cp "$BIN" "/out/$OUTPUT_NAME"
file "/out/$OUTPUT_NAME"
EOF

echo "==> Done: ${OUT_DIR}/${OUTPUT_NAME}"
ls -lh "${OUT_DIR}/${OUTPUT_NAME}"
