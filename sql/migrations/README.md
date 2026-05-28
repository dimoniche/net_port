# SQL migrations

Версионированные миграции применяются скриптом [`scripts/run-migrations.sh`](../../scripts/run-migrations.sh) и записываются в таблицу `schema_migrations`.

## Именование

```
NNN_short_description.sql
```

- `000` — служебная миграция (таблица `schema_migrations`)
- `001` … `999` — изменения схемы/данных по порядку

## Новая миграция

1. Создайте файл, например `011_my_feature.sql` (следующий свободный номер).
2. Пишите идемпотентный SQL (`IF NOT EXISTS`, `CREATE OR REPLACE`).
3. При необходимости обновите копию в `sql/` для совместимости со старыми ссылками.
4. Пересоберите Docker-образ или запустите вручную:

```bash
USE_LOCAL_DB=true DB_USER=admin DB_PASSWORD=... \
  ./scripts/run-migrations.sh
```

## Существующие БД

При первом запуске на уже развёрнутой базе (есть `users`, но пустая `schema_migrations`) скрипт выполняет **baseline**: помечает миграции `001`–`007` и `009`–`010` как применённые. Миграция `008_device_connecting_status_fix` **выполняется**, если ещё не была в старом `start.sh`.

## Проверка

```sql
SELECT * FROM schema_migrations ORDER BY version;
```
