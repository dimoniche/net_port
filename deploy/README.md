# Net Port deployment

## Docker image

```bash
./scripts/build-docker.sh
docker compose up -d net_port
```

Build args and env: see root `docker-compose.yml` and `Dockerfile`.

## Monitoring stack (optional)

Prometheus is included as an optional compose profile when not using an external instance:

```bash
docker compose --profile monitoring up -d
```

- Prometheus UI: http://localhost:9090
- Scrape target: `net_port:8080/metrics`
- Alert rules: `deploy/prometheus/alerts/net_port.yml`

To attach an existing Prometheus server, copy the `net_port` job from `deploy/prometheus/prometheus.yml`.

## Health and metrics URLs

| Path | Backend | Via nginx |
|------|---------|-----------|
| `/health` | :8080 | :80 |
| `/metrics` | :8080 | :80 |
| `/docs/openapi.yaml` | :8080 | — |

## Documentation

- [Admin guide](../docs/admin-guide.md)
- [OpenAPI](../docs/openapi.yaml)
