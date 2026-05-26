# Обновление production (185.135.80.41 и аналогичные хосты)

Обновление с ветки **develop** на **feature/version4** без потери legacy-серверов.

## Что сохраняется

- Таблица `servers` — legacy switcher-серверы (порты **5000–5999**)
- Таблица `statistic` — статистика legacy-серверов
- Пользователи и роли

Миграции **не пересоздают** БД: `init_db.sql` пропускается, если таблицы уже есть.

## Риск для legacy-серверов

Если включённый (`enable=true`) legacy-сервер использует порты **6000–7000**, при миграции он будет **отключён** и перенесён на 5998/5999 (конфликт с пулом устройств).

Перед обновлением проверьте:

```sql
SELECT id, user_id, input_port, output_port, enable, description
FROM servers
WHERE enable = true
  AND (input_port BETWEEN 6000 AND 7000 OR output_port BETWEEN 6000 AND 7000);
```

Если есть строки — переназначьте порты на диапазон **5000–5999** до апгрейда.

## Вариант A: Docker (рекомендуется)

На машине сборки:

```bash
git checkout feature/version4
git pull
./scripts/build-docker.sh
docker save net_port:latest | gzip > /tmp/net_port_latest.tar.gz
scp /tmp/net_port_latest.tar.gz user@185.135.80.41:/root/
scp -r scripts sql init_device_db.sql docker-compose.yml user@185.135.80.41:/root/net_port_upgrade/
```

На сервере **185.135.80.41**:

```bash
export DB_USER=admin
export DB_PASSWORD='...'
export DB_HOST=...      # если внешняя БД
export DB_PORT=5432
export NET_PORT_IMAGE_TAR=/root/net_port_latest.tar.gz
export NET_PORT_ROOT=/root/net_port_upgrade

docker load < /root/net_port_latest.tar.gz
bash /root/net_port_upgrade/scripts/upgrade-server.sh
```

## Вариант B: Удалённый скрипт (SSH)

```bash
chmod +x scripts/remote-upgrade.sh
./scripts/remote-upgrade.sh \
  185.135.80.41 SSH_USER SSH_PASSWORD \
  net_port admin 'DB_PASSWORD' DB_HOST 5432
```

Скрипт:

1. Делает бэкап `servers`, `statistic`, `users`
2. Применяет SQL-миграции из `sql/`
3. Добавляет device management (не трогая legacy в 5000–5999)
4. Перезапускает сервисы
5. Сверяет таблицу `servers` до/после

## Вариант C: Legacy UI (`/root/net_port_ui`, develop)

Старый деплой через `web/deploy/main.py` обновляет только web. Для полного апгрейда:

1. Бэкап БД (см. `scripts/upgrade-server.sh`)
2. Обновить C-бинарник в `/root/net_port/`
3. Добавить в systemd unit'ы `net_port_u*` флаги:
   `--enable-device-management --device-control-port 8443`
4. Обновить backend/frontend (или перейти на Docker)

```bash
python3 web/deploy/main.py 185.135.80.41 USER PASS net_port admin DB_PASS DB_HOST 5432
```

## Проверка после обновления

```bash
# Legacy-серверы на месте
psql -h DB_HOST -U admin -d net_port -c \
  "SELECT id, input_port, output_port, enable FROM servers ORDER BY id;"

# C-сервер слушает legacy + device control
ss -tlnp | grep -E '500[0-9]|599[0-9]|8443|6000'

# Health / metrics
curl -s http://127.0.0.1:8080/health
curl -s http://127.0.0.1:8080/metrics | grep net_port_devices
```

## Откат

Бэкапы: `/root/net_port_backups/net_port_YYYYMMDD_HHMMSS/`

```bash
psql ... -c "\copy servers FROM '/root/net_port_backups/.../servers.csv' CSV HEADER"
systemctl restart net_port_u1 net_port_ui   # или docker restart net_port_app
```
