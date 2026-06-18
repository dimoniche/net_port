#!/usr/bin/env bash
# Generate self-signed TLS certificates once; reuse on subsequent starts.
set -euo pipefail

SSL_DIR="${NET_PORT_SSL_DIR:-/root/net_port/ssl}"
CERT_FILE="${SSL_DIR}/server.crt"
KEY_FILE="${SSL_DIR}/server.key"
DAYS="${NET_PORT_SSL_DAYS:-3650}"
SUBJECT="${NET_PORT_SSL_SUBJECT:-/C=RU/ST=Moscow/L=Moscow/O=Net Port/CN=localhost}"

LEGACY_CERT="${NET_PORT_LEGACY_SSL_DIR:-/root/net_port}/server.crt"
LEGACY_KEY="${NET_PORT_LEGACY_SSL_DIR:-/root/net_port}/server.key"

mkdir -p "${SSL_DIR}"
chmod 700 "${SSL_DIR}"

if [ -f "${CERT_FILE}" ] && [ -f "${KEY_FILE}" ]; then
    echo "TLS certificates already exist in ${SSL_DIR}, skipping generation"
    exit 0
fi

if [ -f "${LEGACY_CERT}" ] && [ -f "${LEGACY_KEY}" ] \
    && [ ! -L "${LEGACY_CERT}" ] && [ ! -L "${LEGACY_KEY}" ]; then
    echo "Migrating existing TLS certificates from ${NET_PORT_LEGACY_SSL_DIR:-/root/net_port} to ${SSL_DIR}..."
    cp -f "${LEGACY_CERT}" "${CERT_FILE}"
    cp -f "${LEGACY_KEY}" "${KEY_FILE}"
    chmod 644 "${CERT_FILE}"
    chmod 600 "${KEY_FILE}"
    echo "TLS certificates migrated to ${SSL_DIR}"
    exit 0
fi

echo "Generating TLS certificates in ${SSL_DIR} (one-time)..."
openssl genrsa -out "${KEY_FILE}" 2048
chmod 600 "${KEY_FILE}"
openssl req -new -x509 -key "${KEY_FILE}" -out "${CERT_FILE}" -days "${DAYS}" -subj "${SUBJECT}"
chmod 644 "${CERT_FILE}"
echo "TLS certificates generated: ${CERT_FILE}"
