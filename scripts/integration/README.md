# Integration tests

Based on `plans/test_plan_and_integration.md`.

## Quick start (Docker)

```bash
export DB_PASSWORD='your-db-password'

# Single lifecycle test
./scripts/integration/run_in_container.sh

# Full suite: register/reconnect, fixed port, security, load
./scripts/integration/run_in_container.sh all
```

Copy scripts into the container if they are not mounted:

```bash
docker cp scripts net_port_app:/root/net_port/source/
docker cp build/server/module_net_port_server-0.0.4 net_port_app:/root/net_port/
chmod +x /root/net_port/source/scripts/integration/*.sh
```

## Test suites

| Script | What it verifies |
|--------|------------------|
| `device_tunnel_test.sh` | Register, ports listen, disconnect, inactive gate, reconnect |
| `fixed_port_test.sh` | `preferred_port` pair allocation (default `6010/6011`) |
| `tunnel_tls_ssh_e2e_test.sh` | TLS tunnel port + device client + SSH banner through published port |
| `security_control_test.sh` | Invalid JSON, missing action, SQL injection safety, rate limiting |
| `load_test_devices.py` | Concurrent registrations (`--devices`, `--workers`) |
| `run_all_integration_tests.sh` | Runs all of the above |

### Backend unit tests (API validation)

```bash
cd web/backend_net_port
npm run jest
```

Covers `deviceValidation.js`: fixed port rules, `device_id` format, device type, internal port.

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `NET_PORT_CONTAINER` | `net_port_app` | Docker container name |
| `NET_PORT_CONTROL_HOST` | `127.0.0.1` | Device control server host |
| `NET_PORT_CONTROL_PORT` | `8443` | Device control server port |
| `NET_PORT_TEST_DEVICE_ID` | `integration-test` | Temporary test device id |
| `NET_PORT_TEST_AUTH_TOKEN` | `integration-test-token` | Plain auth token (SHA-256 in DB) |
| `NET_PORT_TEST_PREFERRED_PORT` | `6010` | Fixed port for `fixed_port_test.sh` |
| `NET_PORT_TEST_ENABLE_TUNNEL_SSL` | `false` | Enable TLS on device tunnel leg |
| `NET_PORT_TEST_ENABLE_INPUT_SSL` | `false` | Enable TLS on published input port |
| `NET_PORT_TEST_INTERNAL_PORT` | `22` / `18022` in TLS+SSH test | Local service port on device side |
| `NET_PORT_MOCK_SSH_PORT` | `18022` | Port for mock SSH server in e2e test |
| `NET_PORT_CLIENT_BIN` | auto-detect | Path to `module_net_port_client-*` binary |
| `NET_PORT_SSL_CERT` | `/root/net_port/ssl/server.crt` | CA/cert for client TLS |
| `NET_PORT_LOAD_DEVICES` | `10` | Devices for load test |
| `NET_PORT_LOAD_WORKERS` | `10` | Parallel workers for load test |
| `NET_PORT_RATE_LIMIT_PROBE` | `120` | Burst size for rate-limit test |
| `NET_PORT_RUN_LOAD` | `1` | Set `0` to skip load test in full suite |
| `DB_HOST` | `127.0.0.1` / `192.168.0.132` in container | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USER` | `admin` | PostgreSQL user |
| `DB_PASSWORD` | *(required)* | PostgreSQL password |
| `DB_NAME` | `net_port` | Database name |

## Notes

- Disconnect control action is accepted only from `127.0.0.1` on the server host — use `run_in_container.sh`.
- Rate limiting is enforced on the C control server (`security_features.c`), default 100 requests/minute per device and per IP.
- Load test prepares devices in status `connecting` and expects at least 50% successful registrations.
- After tests, devices `integration-test`, `integration-test-tls-ssh`, and `load-test-*` are **deleted** from the database (sessions and port reservations are released first).
- `tunnel_tls_ssh_e2e_test.sh` sends an SSH client hello (`SSH-2.0-...`) on the published port first; the mock backend then returns its banner through the TLS tunnel (real SSH clients behave the same way).
- Docker image requires full `python3` (not `python3-minimal`) for integration helpers — see root `Dockerfile`.
