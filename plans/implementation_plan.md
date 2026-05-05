# План реализации системы динамического перенаправления портов

## Фаза 1: Подготовка инфраструктуры (2 недели)

### 1.1. Расширение базы данных
```sql
-- Создание таблицы устройств
CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255),
    description TEXT,
    type VARCHAR(50),
    status VARCHAR(20) DEFAULT 'inactive',
    auth_token VARCHAR(255) NOT NULL,
    internal_address VARCHAR(45),
    internal_port INTEGER,
    protocol VARCHAR(10) DEFAULT 'tcp',
    capabilities JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat TIMESTAMP
);

-- Создание таблицы маппинга портов
CREATE TABLE port_mappings (
    id SERIAL PRIMARY KEY,
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    assigned_port INTEGER NOT NULL,
    session_token VARCHAR(255),
    client_ip VARCHAR(45),
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    bytes_sent BIGINT DEFAULT 0,
    bytes_received BIGINT DEFAULT 0,
    active_connections INTEGER DEFAULT 0,
    UNIQUE(assigned_port)
);

-- Создание таблицы статистики
CREATE TABLE device_statistics (
    id SERIAL PRIMARY KEY,
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    period_start TIMESTAMP NOT NULL,
    period_end TIMESTAMP NOT NULL,
    bytes_sent BIGINT DEFAULT 0,
    bytes_received BIGINT DEFAULT 0,
    connection_count INTEGER DEFAULT 0,
    uptime_seconds INTEGER DEFAULT 0
);

-- Индексы для производительности
CREATE INDEX idx_devices_status ON devices(status);
CREATE INDEX idx_port_mappings_device_id ON port_mappings(device_id);
CREATE INDEX idx_port_mappings_expires ON port_mappings(expires_at);
CREATE INDEX idx_statistics_device_period ON device_statistics(device_id, period_start);
```

### 1.2. Настройка сервера
1. Установка дополнительных портов в конфигурации
2. Настройка SSL сертификатов для порта 8443
3. Конфигурация фаервола (открытие портов 8443 и диапазона 10000-60000)
4. Настройка мониторинга (Prometheus, Grafana)

### 1.3. Создание тестового окружения
1. Развертывание тестовой БД
2. Создание тестовых устройств
3. Настройка CI/CD пайплайна

## Фаза 2: Модификация сервера (3 недели)

### 2.1. Расширение proxy_server.c
```c
// Новые структуры данных
typedef struct device_session_s {
    char device_id[64];
    char session_token[256];
    uint16_t assigned_port;
    time_t connected_at;
    time_t last_heartbeat;
    uint64_t bytes_sent;
    uint64_t bytes_received;
    uint32_t active_connections;
} device_session_t;

typedef struct port_manager_s {
    uint16_t port_range_start;
    uint16_t port_range_end;
    uint16_t *available_ports;
    uint32_t available_count;
    pthread_mutex_t lock;
} port_manager_t;

// Новые функции
int device_authenticate(const char *device_id, const char *auth_token);
int allocate_port_for_device(const char *device_id, uint16_t *assigned_port);
int create_device_session(const char *device_id, uint16_t port, char *session_token);
int update_device_heartbeat(const char *session_token);
int get_device_by_port(uint16_t port, char *device_id, size_t device_id_len);
```

### 2.2. Реализация Control Server (порт 8443)
1. Создание отдельного потока для управления соединениями
2. Реализация протокола регистрации устройств
3. Обработка heartbeat сообщений
4. Управление сессиями

### 2.3. Модификация Proxy Server
1. Динамическое создание сокетов для выделенных портов
2. Интеграция с системой маппинга портов
3. Обновление статистики в реальном времени
4. Обработка таймаутов и очистки неактивных сессий

### 2.4. Безопасность
1. Реализация rate limiting для устройств
2. Валидация входных данных
3. Шифрование sensitive данных в памяти
4. Аудит всех операций

## Фаза 3: Модификация клиента (2 недели)

### 3.1. Расширение proxy_client.c
```c
// Новые структуры
typedef struct device_registration_s {
    char device_id[64];
    char auth_token[256];
    char server_host[256];
    uint16_t server_port;
    uint16_t assigned_port;
    char session_token[256];
    uint32_t heartbeat_interval;
    time_t last_heartbeat;
} device_registration_t;

// Новые функции
int device_register(device_registration_t *reg);
int send_heartbeat(device_registration_t *reg);
int reconnect_device(device_registration_t *reg);
```

### 3.2. Реализация протокола устройства
1. Фаза регистрации при старте
2. Периодическая отправка heartbeat
3. Обработка команд от сервера
4. Автоматическое переподключение

### 3.3. Улучшение надежности
1. Экспоненциальная backoff стратегия переподключения
2. Кэширование credentials
3. Восстановление состояния после перезапуска
4. Детальное логирование

## Фаза 4: Веб-интерфейс (2 недели)

### 4.1. Расширение существующего Feathers.js приложения
```javascript
// Новые сервисы
class DevicesService {
  async find(params) {}      // Получить список устройств
  async get(id, params) {}   // Получить устройство
  async create(data, params) {} // Создать устройство
  async update(id, data, params) {} // Обновить устройство
  async remove(id, params) {} // Удалить устройство
}

class SessionsService {
  async find(params) {}      // Активные сессии
  async remove(id, params) {} // Завершить сессию
}

class StatisticsService {
  async find(params) {}      // Статистика
}
```

### 4.2. Новые компоненты фронтенда
1. Страница управления устройствами
2. Панель мониторинга активных сессий
3. Графики статистики трафика
4. Форма создания/редактирования устройств

### 4.3. Real-time обновления
1. WebSocket подключение для live данных
2. Уведомления о событиях (подключение/отключение)
3. Автоматическое обновление статистики

## Фаза 5: Интеграция и тестирование (2 недели)

### 5.1. Интеграционное тестирование
1. Тестирование полного цикла: устройство → сервер → клиент
2. Тестирование переподключения при разрыве сети
3. Тестирование нагрузки (100+ одновременных устройств)
4. Тестирование безопасности (SQL injection, XSS, etc.)

### 5.2. Нагрузочное тестирование
```bash
# Тестирование регистрации устройств
./load_test --devices 1000 --rate 10 --duration 300

# Тестирование передачи данных
./traffic_test --devices 50 --bandwidth 10M --duration 600

# Тестирование переподключения
./reconnect_test --devices 100 --drop-rate 0.1 --duration 900
```

### 5.3. Тестирование безопасности
1. Penetration testing
2. Аудит кода на уязвимости
3. Тестирование rate limiting
4. Проверка защиты от DDoS

### 5.4. Документация
1. API документация (OpenAPI/Swagger)
2. Руководство по развертыванию
3. Руководство разработчика устройств
4. Руководство администратора

## Фаза 6: Развертывание и мониторинг (1 неделя)

### 6.1. Production развертывание
1. Поэтапный rollout (canary deployment)
2. Мониторинг метрик в реальном времени
3. Настройка алертинга

### 6.2. Мониторинг ключевых метрик
```yaml
metrics:
  - devices.active_count
  - devices.connection_rate
  - ports.usage_percentage
  - traffic.bytes_per_second
  - latency.p95
  - errors.per_minute
  - sessions.success_rate
```

### 6.3. Алёрты
1. Высокая загрузка портов (>90%)
2. Большое количество ошибок аутентификации
3. Пропущенные heartbeat (>5% устройств)
4. Высокая задержка (>200ms)

## Детальный план по неделям

### Неделя 1-2: Подготовка инфраструктуры
- День 1-2: Расширение БД, создание миграций
- День 3-4: Настройка сервера, SSL, фаервол
- День 5-7: Тестовое окружение, CI/CD
- День 8-10: Базовые unit tests

### Неделя 3-5: Модификация сервера
- День 11-13: Структуры данных, port manager
- День 14-16: Control server (порт 8443)
- День 17-19: Интеграция с proxy server
- День 20-22: Безопасность, rate limiting
- День 23-25: Тестирование серверной части

### Неделя 6-7: Модификация клиента
- День 26-28: Протокол регистрации устройств
- День 29-31: Heartbeat механизм
- День 32-34: Переподключение, надежность
- День 35: Интеграционное тестирование клиент-сервер

### Неделя 8-9: Веб-интерфейс
- День 36-38: Backend сервисы (Feathers.js)
- День 39-41: Frontend компоненты (React)
- День 42-44: Real-time обновления (WebSocket)
- День 45: UI/UX тестирование

### Неделя 10-11: Интеграция и тестирование
- День 46-48: Интеграционное тестирование
- День 49-51: Нагрузочное тестирование
- День 52-54: Тестирование безопасности
- День 55: Документация

### Неделя 12: Развертывание
- День 56-57: Production развертывание
- День 58-59: Мониторинг и алертинг
- День 60: Финальное тестирование, релиз

## Требования к команде

### Разработчики (3 человека)
1. **Backend разработчик (C)**: Модификация proxy_server.c, proxy_client.c
2. **Full-stack разработчик (JavaScript)**: Веб-интерфейс, Feathers.js сервисы
3. **DevOps инженер**: Развертывание, мониторинг, инфраструктура

### Тестировщики (2 человека)
1. **QA инженер**: Функциональное тестирование
2. **Security специалист**: Тестирование безопасности

## Риски и митигация

### Риск 1: Производительность при большом количестве устройств
- **Митигация**: Оптимизация БД запросов, кэширование в Redis, горизонтальное масштабирование

### Риск 2: Безопасность соединений
- **Митигация**: Детальный security audit, penetration testing, регулярное обновление SSL сертификатов

### Риск 3: Совместимость с существующей системой
- **Митигация**: Поэтапная интеграция, feature flags, backward compatibility

### Риск 4: Надежность переподключения
- **Митигация**: Тщательное тестирование сетевых сбоев, экспоненциальный backoff, состояние сессии

## Критерии успеха

### Технические критерии
1. Поддержка 1000+ одновременных устройств
2. Задержка < 100ms для 95% запросов
3. 99.9% uptime системы
4. Полное шифрование всех соединений

### Бизнес критерии
1. Упрощение управления IoT устройствами
2. Сокращение времени настройки новых устройств на 80%
3. Централизованный мониторинг всех подключений
4. Соответствие требованиям безопасности

## Следующие шаги после реализации

1. **Мобильное приложение** для управления устройствами
2. **API для сторонних интеграций** (Zapier, IFTTT)
3. **Расширенные аналитики** (ML-based anomaly detection)
4. **Кластерная версия** для высокой доступности
5. **Поддержка дополнительных протоколов** (MQTT, CoAP, WebRTC)