# Руководство администратора Net Port

## Обзор

Net Port — система динамического проброса портов для IoT-устройств. Компоненты:

| Компонент | Порт | Назначение |
|-----------|------|------------|
| nginx | 80 | Frontend, прокси `/api`, WebSocket |
| Node backend | 8080 | REST API, WebSocket, метрики |
| C device manager | 8443 | Регистрация устройств, туннели |
| PostgreSQL | 5432 | БД устройств, портов, сессий |

## Развёртывание

### Сборка образа

```bash
./scripts/build-docker.sh
# или
docker compose build net_port
```

### Запуск

```bash
docker compose up -d net_port
```

Переменные окружения (см. `docker-compose.yml`):

- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` — PostgreSQL
- `DEVICE_CONTROL_HOST`, `DEVICE_CONTROL_PORT` — C-сервер (по умолчанию `127.0.0.1:8443` внутри контейнера)
- `METRICS_CACHE_MS` — интервал кэша метрик (мс, по умолчанию 5000)

**Не используйте `docker cp` для продакшена** — все изменения должны попадать в образ через git и пересборку.

### Миграции БД

При старте контейнера `start.sh` применяет SQL из `sql/` и `init_device_db.sql`. Новые миграции добавляйте в `sql/` и регистрируйте в `start.sh` / `Dockerfile`.

## Мониторинг

### Health

```bash
curl -s http://localhost:8080/health | jq
curl -s http://localhost/health | jq   # через nginx
```

Ответ `200` — БД и device control доступны. `503` — деградация (проверьте `checks`).

### Prometheus

Метрики: `GET /metrics` (порт 8080 или `/metrics` через nginx).

| Метрика | Описание |
|---------|----------|
| `net_port_devices_total` | Всего устройств |
| `net_port_devices_active` | Статус `active` |
| `net_port_devices_connecting` | Ожидают регистрации |
| `net_port_devices_online` | Heartbeat за 2 мин |
| `net_port_devices_offline` | `active`, но без heartbeat 2 мин |
| `net_port_devices_stale_connecting` | `connecting` дольше 10 мин |
| `net_port_health_ok` | 1 = `/health` вернёт 200 |
| `net_port_check_database` | Проверка PostgreSQL |
| `net_port_check_device_control` | TCP 8443 |
| `net_port_registration_errors_total` | Ошибки регистрации из логов C-сервера |
| `net_port_ports_allocated` | Выделенные порты |
| `net_port_ports_reserved` | Зарезервированные (fixed) |
| `net_port_ports_available` | Свободные чётные 6000–6998 |
| `net_port_sessions_active` | Активные сессии |
| `net_port_session_connections` | Туннельные соединения |
| `net_port_bytes_sent_total` / `_received_total` | Трафик сессий |

### Prometheus в docker-compose

```bash
docker compose --profile monitoring up -d
```

Конфиг: `deploy/prometheus/prometheus.yml`, алерты: `deploy/prometheus/alerts/net_port.yml`.

| Алерт | Условие |
|-------|---------|
| `NetPortHealthDegraded` | `net_port_health_ok == 0` 2 мин (аналог HTTP 503) |
| `NetPortDevicesOffline` | активные устройства без heartbeat 5 мин |
| `NetPortRegistrationErrorsHigh` | >10 ошибок регистрации в логах за 10 мин |
| `NetPortDeviceControlDown` | порт 8443 недоступен |
| `NetPortStaleConnecting` | регистрация не завершается >10 мин |

Для уведомлений (email/Slack) подключите [Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) к Prometheus.

### Версия клиента/сервера

Единый bump (обновляет `VERSION`, CMakeLists client/server, `consts/client.js`):

```bash
./scripts/bump-version.sh patch   # 0.0.4 -> 0.0.5
./scripts/bump-version.sh 0.1.0   # явная версия
```

После bump: пересборка образа и при необходимости `./scripts/build-client-cross.sh`.

Если Prometheus уже развёрнут отдельно, добавьте job:

```yaml
- job_name: net_port
  static_configs:
    - targets: ['net_port:8080']
  metrics_path: /metrics
```

### Алерты (примеры)

- **NetPortDown** — `net_port_up == 0` или target недоступен
- **NetPortNoFreePorts** — `net_port_ports_available < 5`
- **NetPortDeviceControlDown** — health check `device_control: false`
- **NetPortHighConnecting** — много устройств в `connecting` (>10)

## API

Спецификация OpenAPI: [docs/openapi.yaml](./openapi.yaml)

- Swagger UI: импортируйте YAML в Swagger Editor или подключите к вашему порталу
- Статическая раздача: `GET /docs/openapi.yaml` (backend)

Аутентификация: JWT через `POST /api/v1/authentication` (`strategy: local`).

## Операции

### Подключение устройства

1. Создать устройство в UI или `POST /api/v1/devices`
2. Сохранить `auth_token` (показывается один раз)
3. `POST /api/v1/devices/{deviceId}/connect` — статус `connecting`
4. Клиент регистрируется на C-сервере (8443) с `device_id` и токеном

### Fixed port

При создании/редактировании задайте `preferred_port` (чётный, 6000–6998). Порт резервируется в `port_allocations`.

### Auto-connect

`PATCH /api/v1/settings/auto-connect` — автоматический вызов connect для неактивных устройств (worker `device-auto-connect.js`).

### Отключение и удаление

- `POST /api/v1/devices/{deviceId}/disconnect` — разрыв сессии
- `DELETE /api/v1/devices/{id}` — удаление; WebSocket `device:removed`

### Rate limits (C-сервер)

При перегрузке JSON/API — сброс с localhost:

```bash
echo '{"action":"reset_rate_limits"}' | nc 127.0.0.1 8443
```

## Логи и диагностика

```bash
docker logs -f net_port_app
docker exec -it net_port_app tail -f /var/log/net_port/*.log
```

Интеграционные тесты: `scripts/integration/run_all_integration_tests.sh`

## Резервное копирование

Регулярно бэкапьте PostgreSQL (таблицы `devices`, `port_allocations`, `device_sessions`, `users`).
