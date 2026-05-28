#!/usr/bin/env bash
# Кросс-сборка module_net_port_client в Docker → artifacts/clients/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ARCH="${1:-armhf}"
read_version() {
  grep "^set($1 " client/CMakeLists.txt | awk '{print $2}' | tr -d ')'
}
VERSION="$(read_version VERSION_MAJOR).$(read_version VERSION_MINOR).$(read_version VERSION_PATCH)"
MODULE="module_net_port_client"
OUT_DIR="${ROOT}/artifacts/clients"
TARGET="${MODULE}-${VERSION}"

case "$ARCH" in
  armhf) SUFFIX="armhf" ;;
  aarch64) SUFFIX="aarch64" ;;
  *)
    echo "Usage: $0 [armhf|aarch64]" >&2
    exit 1
    ;;
esac

OUTPUT_NAME="${TARGET}-${SUFFIX}"
IMAGE="net_port-cross-client-${ARCH}:build"

echo "==> Cross-build ${OUTPUT_NAME} (Docker, Debian bookworm)"

docker build \
  -f scripts/cross-build-client.Dockerfile \
  --build-arg "TARGET_ARCH=${ARCH}" \
  -t "${IMAGE}" \
  .

mkdir -p "${OUT_DIR}"

docker run --rm -i \
  -e "TARGET=${TARGET}" \
  -e "OUTPUT_NAME=${OUTPUT_NAME}" \
  -e "ARCH=${ARCH}" \
  -v "${ROOT}:/src:ro" \
  -v "${OUT_DIR}:/out" \
  "${IMAGE}" \
  /bin/bash -s <<'EOF'
set -euo pipefail
BUILD=/tmp/net_port_cross_build
rm -rf "$BUILD"
mkdir -p "$BUILD"
cmake -S /src -B "$BUILD" \
  -DCMAKE_TOOLCHAIN_FILE="/src/client/cmake/toolchain-${ARCH}.cmake" \
  -DCMAKE_BUILD_TYPE=Release \
  -DNET_PORT_BUILD_SERVER=OFF
cmake --build "$BUILD" --target "$TARGET" -j4
BIN="$BUILD/client/$TARGET"
test -f "$BIN"
cp "$BIN" "/out/$OUTPUT_NAME"
chmod +x "/out/$OUTPUT_NAME"
file "/out/$OUTPUT_NAME"
EOF

echo "==> Done: ${OUT_DIR}/${OUTPUT_NAME}"
ls -lh "${OUT_DIR}/${OUTPUT_NAME}"
