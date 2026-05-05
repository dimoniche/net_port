# Спецификация API для системы динамического перенаправления портов

## Базовый URL
```
https://server.example.com:3030/api/v1
```

## Аутентификация
Все запросы (кроме публичных) требуют Bearer токен:
```
Authorization: Bearer <jwt_token>
```

## Модели данных

### Устройство (Device)
```json
{
  "id": "uuid-v4",
  "device_id": "device-001",
  "name": "IoT Gateway Moscow",
  "description": "Основной шлюз в Москве",
  "type": "iot_gateway",
  "status": "active",
  "assigned_port": 15001,
  "internal_address": "192.168.1.100",
  "internal_port": 22,
  "protocol": "tcp",
  "auth_token": "encrypted-token",
  "capabilities": ["ssh", "http", "mqtt"],
  "metadata": {
    "firmware_version": "1.2.3",
    "location": "Moscow, Russia",
    "last_seen": "2024-01-15T10:30:00Z"
  },
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-15T10:30:00Z",
  "last_heartbeat": "2024-01-15T10:29:30Z"
}
```

### Сессия (Session)
```json
{
  "id": "uuid-v4",
  "device_id": "device-001",
  "session_token": "encrypted-session-token",
  "assigned_port": 15001,
  "client_ip": "192.168.1.100",
  "started_at": "2024-01-15T10:00:00Z",
  "last_activity": "2024-01-15T10:29:30Z",
  "expires_at": "2024-01-15T11:00:00Z",
  "bytes_sent": 1048576,
  "bytes_received": 524288,
  "active_connections": 3
}
```

### Статистика (Statistics)
```json
{
  "device_id": "device-001",
  "period": "2024-01-15",
  "bytes_sent_total": 1073741824,
  "bytes_received_total": 536870912,
  "connection_count": 150,
  "uptime_seconds": 86400,
  "peak_connections": 10
}
```

## Endpoints

### Устройства (Devices)

#### 1. Получить список устройств
```
GET /devices
```

**Параметры:**
- `page` (опционально): номер страницы (по умолчанию: 1)
- `limit` (опционально): количество на странице (по умолчанию: 50)
- `status` (опционально): фильтр по статусу (active, inactive, pending)
- `type` (опционально): фильтр по типу устройства

**Ответ:**
```json
{
  "data": [
    {
      "id": "uuid-v4",
      "device_id": "device-001",
      "name": "IoT Gateway",
      "status": "active",
      "assigned_port": 15001,
      "last_heartbeat": "2024-01-15T10:29:30Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 125,
    "pages": 3
  }
}
```

#### 2. Создать новое устройство
```
POST /devices
```

**Тело запроса:**
```json
{
  "device_id": "device-001",
  "name": "Новое устройство",
  "description": "Описание устройства",
  "type": "iot_gateway",
  "internal_address": "192.168.1.100",
  "internal_port": 22,
  "protocol": "tcp",
  "capabilities": ["ssh"],
  "metadata": {
    "location": "Moscow"
  }
}
```

**Ответ:**
```json
{
  "id": "uuid-v4",
  "device_id": "device-001",
  "auth_token": "generated-auth-token",
  "message": "Устройство успешно создано"
}
```

#### 3. Получить информацию об устройстве
```
GET /devices/{id}
```

**Ответ:** Полный объект устройства

#### 4. Обновить устройство
```
PUT /devices/{id}
```

**Тело запроса:** Частичные поля для обновления

**Ответ:** Обновленный объект устройства

#### 5. Удалить устройство
```
DELETE /devices/{id}
```

**Ответ:**
```json
{
  "message": "Устройство успешно удалено"
}
```

#### 6. Регенерировать токен устройства
```
POST /devices/{id}/regenerate-token
```

**Ответ:**
```json
{
  "auth_token": "new-generated-token",
  "message": "Токен успешно обновлен"
}
```

### Сессии (Sessions)

#### 1. Получить активные сессии
```
GET /sessions
```

**Параметры:**
- `device_id` (опционально): фильтр по устройству
- `active_only` (опционально): только активные сессии (true/false)

**Ответ:** Массив объектов сессий

#### 2. Получить информацию о сессии
```
GET /sessions/{session_id}
```

**Ответ:** Объект сессии

#### 3. Завершить сессию
```
DELETE /sessions/{session_id}
```

**Ответ:**
```json
{
  "message": "Сессия успешно завершена"
}
```

### Порты (Ports)

#### 1. Получить доступные порты
```
GET /ports/available
```

**Параметры:**
- `count` (опционально): количество портов (по умолчанию: 10)
- `protocol` (опционально): tcp/udp (по умолчанию: tcp)

**Ответ:**
```json
{
  "ports": [15001, 15002, 15003, 15004, 15005],
  "total_available": 24500
}
```

#### 2. Получить занятые порты
```
GET /ports/occupied
```

**Ответ:**
```json
{
  "ports": [
    {
      "port": 15001,
      "device_id": "device-001",
      "device_name": "IoT Gateway",
      "since": "2024-01-15T10:00:00Z"
    }
  ],
  "total_occupied": 150
}
```

#### 3. Освободить порт
```
DELETE /ports/{port}
```

**Ответ:**
```json
{
  "message": "Порт успешно освобожден"
}
```

### Статистика (Statistics)

#### 1. Получить статистику устройства
```
GET /devices/{id}/statistics
```

**Параметры:**
- `period` (опционально): day, week, month, year (по умолчанию: day)
- `from` (опционально): начальная дата (ISO 8601)
- `to` (опционально): конечная дата (ISO 8601)

**Ответ:**
```json
{
  "device_id": "device-001",
  "period": {
    "from": "2024-01-15T00:00:00Z",
    "to": "2024-01-15T23:59:59Z"
  },
  "bytes_sent": 1073741824,
  "bytes_received": 536870912,
  "connection_count": 150,
  "uptime_percentage": 99.5,
  "peak_connections": 10,
  "average_latency_ms": 45
}
```

#### 2. Получить общую статистику
```
GET /statistics/overview
```

**Ответ:**
```json
{
  "total_devices": 125,
  "active_devices": 89,
  "total_ports_used": 89,
  "total_ports_available": 49111,
  "total_bytes_sent_24h": 1099511627776,
  "total_bytes_received_24h": 549755813888,
  "total_connections_24h": 12500,
  "system_uptime": 604800
}
```

### Управление (Management)

#### 1. Перезапустить соединение устройства
```
POST /devices/{id}/restart
```

**Ответ:**
```json
{
  "message": "Соединение устройства перезапущено",
  "new_port": 15002,
  "session_id": "new-session-uuid"
}
```

#### 2. Принудительно отключить устройство
```
POST /devices/{id}/disconnect
```

**Ответ:**
```json
{
  "message": "Устройство принудительно отключено"
}
```

#### 3. Проверить доступность устройства
```
GET /devices/{id}/ping
```

**Ответ:**
```json
{
  "online": true,
  "latency_ms": 45,
  "last_heartbeat": "2024-01-15T10:29:30Z"
}
```

### Аутентификация (Authentication)

#### 1. Вход в систему
```
POST /auth/login
```

**Тело запроса:**
```json
{
  "username": "admin",
  "password": "password"
}
```

**Ответ:**
```json
{
  "access_token": "jwt-token",
  "refresh_token": "refresh-token",
  "expires_in": 3600,
  "user": {
    "id": "user-uuid",
    "username": "admin",
    "role": "administrator"
  }
}
```

#### 2. Обновить токен
```
POST /auth/refresh
```

**Тело запроса:**
```json
{
  "refresh_token": "refresh-token"
}
```

**Ответ:** Новый access_token

#### 3. Выход из системы
```
POST /auth/logout
```

**Ответ:**
```json
{
  "message": "Успешный выход из системы"
}
```

## WebSocket API

### Подключение
```
wss://server.example.com:3030/ws
```

### События (Events)

#### 1. Подписка на события устройства
```json
{
  "type": "subscribe",
  "channel": "device",
  "device_id": "device-001"
}
```

#### 2. События в реальном времени
```json
{
  "type": "device_connected",
  "device_id": "device-001",
  "assigned_port": 15001,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

```json
{
  "type": "device_disconnected",
  "device_id": "device-001",
  "reason": "heartbeat_timeout",
  "timestamp": "2024-01-15T10:35:00Z"
}
```

```json
{
  "type": "traffic_update",
  "device_id": "device-001",
  "bytes_sent": 1048576,
  "bytes_received": 524288,
  "connections": 3,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

```json
{
  "type": "port_assigned",
  "device_id": "device-001",
  "old_port": 15001,
  "new_port": 15002,
  "reason": "manual_restart",
  "timestamp": "2024-01-15T10:40:00Z"
}
```

## Протокол устройства (Device Protocol)

### 1. Регистрация устройства
```
POST /device/register
Content-Type: application/json
```

**Тело запроса:**
```json
{
  "device_id": "device-001",
  "auth_token": "device-auth-token",
  "version": "1.2.3",
  "capabilities": ["ssh", "http"],
  "metadata": {
    "type": "iot_gateway",
    "firmware": "v1.0"
  }
}
```

**Ответ:**
```json
{
  "status": "authenticated",
  "assigned_port": 15001,
  "session_token": "session-token",
  "heartbeat_interval": 30,
  "server_time": "2024-01-15T10:30:00Z"
}
```

### 2. Heartbeat
```
POST /device/heartbeat
Authorization: Bearer <session_token>
```

**Тело запроса:**
```json
{
  "status": "healthy",
  "connections": 3,
  "metrics": {
    "cpu_usage": 45.5,
    "memory_usage": 60.2,
    "uptime": 86400
  }
}
```

**Ответ:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:30Z"
}
```

### 3. Отправка статистики
```
POST /device/statistics
Authorization: Bearer <session_token>
```

**Тело запроса:**
```json
{
  "bytes_sent": 1048576,
  "bytes_received": 524288,
  "active_connections": 3,
  "period_seconds": 60
}
```

## Коды ошибок

### Общие ошибки
- `400 Bad Request` - Неверный формат запроса
- `401 Unauthorized` - Неавторизованный доступ
- `403 Forbidden` - Доступ запрещен
- `404 Not Found` - Ресурс не найден
- `429 Too Many Requests` - Превышен лимит запросов
- `500 Internal Server Error` - Внутренняя ошибка сервера

### Специфичные ошибки устройства
- `460 Device Not Found` - Устройство не найдено
- `461 Invalid Auth Token` - Неверный токен аутентификации
- `462 Device Inactive` - Устройство неактивно
- `463 Port Unavailable` - Нет доступных портов
- `464 Session Expired` - Сессия истекла
- `465 Heartbeat Timeout` - Пропущен heartbeat

## Rate Limiting

- API: 100 запросов в минуту на IP
- Устройства: 10 запросов в секунду на устройство
- Аутентификация: 5 попыток в минуту на IP

## Версионирование API

- Текущая версия: v1
- Версия указывается в URL: `/api/v1/`
- Обратная совместимость поддерживается в течение 6 месяцев

## Документация

- Swagger/OpenAPI спецификация: `/api-docs`
- ReDoc документация: `/redoc`
- Postman коллекция: доступна для скачивания