# Integration tests

## Device tunnel lifecycle

`device_tunnel_test.sh` verifies the MVP flow:

1. Register device (status `connecting`)
2. Both proxy ports listen (`6000` input, `6001` tunnel)
3. Disconnect via control server (localhost only)
4. Registration blocked while device is `inactive`
5. Register again after status returns to `connecting`

### Run inside Docker (recommended)

Disconnect control action is accepted only from `127.0.0.1` on the server host.

```bash
export DB_PASSWORD='your-db-password'
./scripts/integration/run_in_container.sh
```

Copy scripts into the container first if they are not mounted:

```bash
docker cp scripts net_port_app:/root/net_port/source/
chmod +x /root/net_port/start.sh   # required if you update start.sh via docker cp
```

Requires `python3`, `psql`, and `sha256sum` on the host/container. The test uses Python sockets instead of `nc`.

### Run on the server host

```bash
export DB_PASSWORD='your-db-password'
export NET_PORT_CONTROL_HOST=127.0.0.1
./scripts/integration/device_tunnel_test.sh
```

### Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `NET_PORT_CONTROL_HOST` | `127.0.0.1` | Device control server host |
| `NET_PORT_CONTROL_PORT` | `8443` | Device control server port |
| `NET_PORT_TEST_DEVICE_ID` | `integration-test` | Temporary test device id |
| `NET_PORT_TEST_AUTH_TOKEN` | `integration-test-token` | Plain auth token (SHA-256 stored in DB) |
| `DB_HOST` | `127.0.0.1` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USER` | `admin` | PostgreSQL user |
| `DB_PASSWORD` | empty | PostgreSQL password |
| `DB_NAME` | `net_port` | Database name |
