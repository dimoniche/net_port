# Net Port v4

Система динамического проброса портов для подключения сетевых устройств и IoT-хостов без белого IP. Версия **4** объединяет legacy-режим (фиксированные пары портов на пользователя) и режим **устройств** с регистрацией, heartbeat и выделением портов из пула **6000–6999**.

Текущая версия бинарников: **0.0.4** (см. файл [`VERSION`](VERSION)).

## Возможности v4

| Область | Описание |
|---------|----------|
| **Устройства (IoT)** | Регистрация по `device_id` + токен, control-порт **8443** (TLS), туннели на динамических портах |
| **Legacy-серверы** | Проброс `input_port` → `output_port` (5000+, per-user), статистика в PostgreSQL |
| **Веб-интерфейс** | React: устройства, серверы, статистика, настройки, скачивание клиентов |
| **Realtime** | WebSocket: статус устройств, обновление статистики (PostgreSQL `NOTIFY`) |
| **Клиенты** | Linux amd64 (в образе), armhf/aarch64, Windows `.exe` — [`artifacts/clients/`](artifacts/clients/README.md) |
| **Наблюдаемость** | `/health`, `/metrics` (Prometheus), алерты в [`deploy/prometheus/alerts/`](deploy/prometheus/alerts/net_port.yml) |

## Архитектура

```text
┌─────────────┐     :80      ┌────────┐     :8080    ┌──────────────────┐
│   Browser   │ ────────────►│ nginx  │ ──────────►│ Node (Feathers)  │
└─────────────┘              └────────┘            │  REST + WS       │
       │                                           └────────┬─────────┘
       │                                                    │
       │  module_net_port_client                            │ PostgreSQL
       ▼                                                    ▼
┌─────────────┐     :8443      ┌──────────────────────────────────────┐
│  IoT device │ ──────────────►│ C-server: device manager + proxy       │
└─────────────┘                │ legacy port pairs (5000+, per user)    │
                               └──────────────────────────────────────┘
```

| Компонент | Порт (по умолчанию) | Назначение |
|-----------|---------------------|------------|
| nginx | 80 | UI, `/api/v1`, WebSocket, `/files` |
| Node backend | 8080 | API, `/health`, `/metrics` |
| Device control (C) | 8443 | JSON-регистрация устройств |
| Туннели устройств | 6000–6999 | Внешние порты (чётные) |
| Legacy proxy | 5000–5999 | Пары портов пользователя |
| PostgreSQL | 5432 | Устройства, порты, статистика |

## Быстрый старт (Docker)

### Требования

- Docker, Docker Compose v2
- Доступная PostgreSQL (в образе или внешняя — `EXTERNAL_DB=true` в `Dockerfile`)

### Сборка и запуск

```bash
./scripts/build-docker.sh
# или
docker compose build net_port

docker compose up -d net_port
```

Порты в [`docker-compose.yml`](docker-compose.yml) (пример):

| Хост | Контейнер | Сервис |
|------|-----------|--------|
| 13080 | 80 | Веб-интерфейс |
| 13880 | 8080 | API напрямую |
| 8443 | 8443 | Регистрация устройств |
| 49000–49099 | 6000–6099 | Туннели (пример проброса) |

Откройте: `http://localhost:13080`

### Мониторинг (опционально)

```bash
docker compose --profile monitoring up -d
```

- Prometheus: `http://localhost:9090`
- Health: `curl -s http://localhost:13080/health | jq`
- Metrics: `curl -s http://localhost:13080/metrics`

Подробнее: [`deploy/README.md`](deploy/README.md), [`docs/admin-guide.md`](docs/admin-guide.md).

## Подключение устройства

1. Войти в веб-интерфейс → **Устройства** → создать устройство.
2. Сохранить `device_id` и токен (показывается один раз).
3. Скачать клиент: **Настройки** → вкладка с клиентом (список архитектур — только те бинарники, что есть на сервере).
4. На хосте устройства:

```bash
chmod +x module_net_port_client-0.0.4
./module_net_port_client-0.0.4 \
  --device-id DEVICE_ID \
  --device-token TOKEN \
  --registration-server SERVER_IP \
  --registration-port 8443 \
  --port-host-base 49000
```

`--port-host-base` — если клиент за NAT/Docker и внешний порт хоста отличается от внутреннего (например проброс `49000:6000`).

### Автообновление клиента

Проверка версии на сервере (нужны `curl`, для установки — `sha256sum`):

```bash
# Только проверить
./module_net_port_client-0.0.4 --check-update \
  --update-server http://SERVER:13080 --update-arch armhf

# Скачать новую версию и перезапуститься (symlink module_net_port_client)
./module_net_port_client --auto-update \
  --update-server http://SERVER:13080 \
  --registration-server SERVER --device-id ... --device-token ...
```

API: `GET /api/v1/clients/latest/check?current=0.0.4&platform=linux&arch=armhf`, `GET /api/v1/clients/latest`.

## Клиенты для разных архитектур

Linux **amd64** собирается при `docker build`. Для **ARM**:

```bash
./scripts/build-client-cross.sh armhf
./scripts/build-client-cross.sh aarch64
./scripts/build-client-windows.sh
docker build -t net_port:latest .
```

**Windows:** клиент в режиме legacy proxy (`--host_in`, `-p_in`, `--host_out`, `-p_out`). Регистрация устройств (порт 8443) — только Linux-клиент.

Инструкция: [`artifacts/clients/README.md`](artifacts/clients/README.md).

## Версионирование

Единый bump версии клиента и сервера:

```bash
./scripts/bump-version.sh patch    # 0.0.4 → 0.0.5
./scripts/bump-version.sh 0.1.0
```

Обновляет `VERSION`, `client/CMakeLists.txt`, `server/CMakeLists.txt`, `web/frontend_net_port/src/consts/client.js`.

## Структура репозитория

```text
net_port/
├── client/              # C-клиент (Linux)
├── client_win/          # C-клиент (Windows)
├── server/              # C-сервер + device manager
├── web/
│   ├── backend_net_port/   # Feathers API
│   └── frontend_net_port/  # React UI
├── sql/                 # Миграции БД
├── artifacts/clients/   # armhf/aarch64 бинарники для образа
├── deploy/prometheus/   # Prometheus + алерты
├── scripts/             # build-docker, bump-version, integration tests
├── docs/                # admin-guide, openapi.yaml
├── Dockerfile
├── docker-compose.yml
└── start.sh             # Entrypoint контейнера
```

## Legacy-режим (прокси портов)

По-прежнему поддерживается запуск C-сервера с фиксированными портами и PostgreSQL (без device manager):

```bash
./module_net_port_server-0.0.4 --user 1 --input-port 5000 --output-port 5001
```

Клиент legacy:

```bash
./module_net_port_client-0.0.4 --host_in SERVER --p_in 5000 --host_out 127.0.0.1 -p_out 22
```

SSL: сервер и клиент используют TLS; клиент проверяет сертификат сервера.

```text
Клиент                          Сервер
  |-------- SSL Connect -------->|
  | Проверяет сертификат сервера |
  |<----- SSL Established -------|
  |====== Secure Channel ========|
```

## Установка без Docker

См. [`INSTALLATION_GUIDE.md`](INSTALLATION_GUIDE.md) и `install.sh`.

## Тесты

Интеграционные тесты (туннель, fixed port, security):

```bash
./scripts/integration/run_all_integration_tests.sh
```

Описание: [`scripts/integration/README.md`](scripts/integration/README.md).

## API и документация

| Документ | Содержание |
|----------|------------|
| [`docs/admin-guide.md`](docs/admin-guide.md) | Эксплуатация, метрики, алерты, операции |
| [`docs/openapi.yaml`](docs/openapi.yaml) | OpenAPI (также `/docs/openapi.yaml` на backend) |
| [`plans/`](plans/) | Технические спецификации и планы |

## Переменные окружения (Docker)

| Переменная | Описание |
|------------|----------|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` | PostgreSQL |
| `DEVICE_CONTROL_HOST`, `DEVICE_CONTROL_PORT` | Адрес C device manager (в контейнере `127.0.0.1:8443`) |
| `METRICS_CACHE_MS` | Кэш метрик Prometheus (мс) |
| `THREADS` | Потоки C-сервера |

## Ветка и лицензия

Разработка v4: ветка `feature/version4`.
