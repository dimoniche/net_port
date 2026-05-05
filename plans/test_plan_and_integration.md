# Тестовый план и интеграция системы динамического перенаправления портов

## Обзор тестирования

Комплексный план тестирования для системы динамического перенаправления портов с идентификацией клиентов IoT устройств.

## 1. Тестирование базы данных

### 1.1. Тестирование схемы базы данных
```sql
-- Тест 1: Создание таблиц
\i init_device_db.sql

-- Тест 2: Проверка структуры таблиц
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name LIKE 'device%';

-- Тест 3: Проверка ограничений
SELECT conname, contype, consrc FROM pg_constraint 
WHERE conrelid IN (
    SELECT oid FROM pg_class 
    WHERE relname IN ('devices', 'device_sessions', 'port_allocations')
);

-- Тест 4: Тестовые данные
INSERT INTO devices (device_id, name, auth_token_hash, status) 
VALUES ('test-device-001', 'Test Device', crypt('test-token', gen_salt('bf')), 'active');

-- Тест 5: Функции базы данных
SELECT allocate_device_port(
    (SELECT id FROM devices WHERE device_id = 'test-device-001'),
    NULL,
    15001
);

SELECT cleanup_expired_sessions();
```

### 1.2. Тестирование производительности БД
```bash
# Тест нагрузки на базу данных
pgbench -c 10 -T 60 -f test_queries.sql net_port

# Тест одновременных подключений
for i in {1..100}; do
    psql -c "SELECT * FROM devices LIMIT 1;" net_port &
done
```

## 2. Тестирование сервера управления устройствами

### 2.1. Модульные тесты
```c
// test_device_manager.c
#include "device_manager.h"
#include <assert.h>

void test_device_authentication() {
    device_manager_config_t config = {0};
    // ... инициализация конфигурации
    
    assert(device_manager_init(&config) == 0);
    assert(device_manager_start() == 0);
    
    // Тест аутентификации
    device_info_t device_info;
    assert(device_authenticate("test-device", "test-token", &device_info) == 0);
    
    device_manager_stop();
}

void test_port_allocation() {
    uint16_t port = allocate_port_for_device("test-device", "session-token", 0);
    assert(port >= 10000 && port <= 60000);
    
    assert(free_device_port(port) == 0);
}

int main() {
    test_device_authentication();
    test_port_allocation();
    printf("All tests passed!\n");
    return 0;
}
```

### 2.2. Интеграционные тесты
```bash
# Запуск сервера управления устройствами
./net_port_server --enable-device-management --device-control-port 8443

# Тест регистрации устройства
curl -k -X POST https://localhost:8443/device/register \
  -H "Content-Type: application/json" \
  -d '{
    "action": "register",
    "device_id": "test-iot-device",
    "auth_token": "test-auth-token",
    "version": "1.0",
    "capabilities": ["tcp", "ssl"]
  }'

# Тест heartbeat
curl -k -X POST https://localhost:8443/device/heartbeat \
  -H "Content-Type: application/json" \
  -d '{
    "action": "heartbeat",
    "session_token": "test-session-token",
    "status": "healthy"
  }'
```

## 3. Тестирование клиента IoT устройства

### 3.1. Тест регистрации устройства
```bash
# Запуск клиента с регистрацией
./net_port_client \
  --device-id "iot-gateway-001" \
  --device-token "secure-token-123" \
  --registration-server 192.168.1.100 \
  --registration-port 8443 \
  --host-out 127.0.0.1 \
  --p-out 22

# Проверка логов
tail -f /var/log/net_port_client.log
```

### 3.2. Тест heartbeat механизма
```c
// test_heartbeat.c
#include "device_heartbeat.h"

int main() {
    heartbeat_config_t config = {0};
    strcpy(config.device_id, "test-device");
    strcpy(config.session_token, "test-session");
    strcpy(config.server_host, "localhost");
    config.server_port = 8443;
    config.heartbeat_interval = 5; // 5 секунд для теста
    
    assert(heartbeat_manager_init(&config) == 0);
    assert(heartbeat_manager_start() == 0);
    
    // Ждем несколько heartbeat
    sleep(20);
    
    heartbeat_stats_t stats;
    assert(heartbeat_get_statistics(&stats) == 0);
    assert(stats.fail_count == 0);
    
    heartbeat_manager_stop();
    return 0;
}
```

## 4. Тестирование веб-интерфейса

### 4.1. Тесты API
```javascript
// test_devices_api.js
const request = require('supertest');
const app = require('../src/app');

describe('Devices API', () => {
  let authToken;
  
  before(async () => {
    // Аутентификация
    const res = await request(app)
      .post('/authentication')
      .send({ username: 'admin', password: 'admin' });
    authToken = res.body.accessToken;
  });
  
  it('should create a device', async () => {
    const res = await request(app)
      .post('/devices')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        device_id: 'test-device-api',
        name: 'Test Device API',
        type: 'iot_gateway'
      });
    
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('auth_token');
  });
  
  it('should list devices', async () => {
    const res = await request(app)
      .get('/devices')
      .set('Authorization', `Bearer ${authToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
  });
});
```

### 4.2. Тесты интерфейса
```javascript
// test_devices_ui.js
const { Builder, By, until } = require('selenium-webdriver');

describe('Devices UI', () => {
  let driver;
  
  before(async () => {
    driver = await new Builder().forBrowser('chrome').build();
    await driver.get('http://localhost:3030');
    
    // Логин
    await driver.findElement(By.name('username')).sendKeys('admin');
    await driver.findElement(By.name('password')).sendKeys('admin');
    await driver.findElement(By.css('button[type="submit"]')).click();
    
    await driver.wait(until.urlContains('/dashboard'), 5000);
  });
  
  it('should navigate to devices page', async () => {
    await driver.findElement(By.linkText('Devices')).click();
    await driver.wait(until.elementLocated(By.css('h1')), 5000);
    
    const title = await driver.findElement(By.css('h1')).getText();
    expect(title).toContain('Devices');
  });
  
  after(async () => {
    await driver.quit();
  });
});
```

## 5. Тестирование безопасности

### 5.1. Тесты аутентификации и авторизации
```bash
# Тест неверных учетных данных
curl -k -X POST https://localhost:8443/device/register \
  -d '{"device_id": "test", "auth_token": "wrong"}' \
  -H "Content-Type: application/json"

# Тест rate limiting
for i in {1..150}; do
  curl -k -X POST https://localhost:8443/device/register \
    -d '{"device_id": "test$i", "auth_token": "test"}' \
    -H "Content-Type: application/json" &
done

# Тест SQL injection
curl -k -X POST https://localhost:8443/device/register \
  -d '{"device_id": "test\"; DROP TABLE devices; --", "auth_token": "test"}' \
  -H "Content-Type: application/json"
```

### 5.2. Тесты SSL/TLS
```bash
# Проверка SSL сертификата
openssl s_client -connect localhost:8443 -showcerts

# Тест только TLS 1.2+
nmap --script ssl-enum-ciphers -p 8443 localhost

# Тест perfect forward secrecy
sslscan localhost:8443
```

## 6. Нагрузочное тестирование

### 6.1. Тест масштабируемости
```python
# load_test_devices.py
import asyncio
import aiohttp
import random
import string

async def register_device(session, device_id):
    url = "https://localhost:8443/device/register"
    data = {
        "action": "register",
        "device_id": device_id,
        "auth_token": "".join(random.choices(string.ascii_letters, k=32)),
        "version": "1.0"
    }
    
    try:
        async with session.post(url, json=data, ssl=False) as response:
            return await response.json()
    except Exception as e:
        return {"error": str(e)}

async def main():
    connector = aiohttp.TCPConnector(limit=100)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = []
        for i in range(1000):  # 1000 одновременных устройств
            device_id = f"load-test-device-{i:04d}"
            task = asyncio.create_task(register_device(session, device_id))
            tasks.append(task)
        
        results = await asyncio.gather(*tasks)
        
        success = sum(1 for r in results if 'assigned_port' in r)
        print(f"Successful registrations: {success}/1000")

if __name__ == "__main__":
    asyncio.run(main())
```

### 6.2. Тест пропускной способности
```bash
# Тест передачи данных через туннель
iperf3 -c localhost -p 15001 -t 60 -P 10

# Мониторинг ресурсов во время теста
top -b -d 1 -p $(pgrep net_port_server)

# Тест памяти
valgrind --leak-check=full ./net_port_server --enable-device-management
```

## 7. Тестирование отказоустойчивости

### 7.1. Тест восстановления после сбоев
```bash
# Тест переподключения устройства
./net_port_client --device-id "reconnect-test" --registration-server localhost &

# Симуляция сбоя сети
sudo iptables -A OUTPUT -p tcp --dport 8443 -j DROP
sleep 30
sudo iptables -D OUTPUT -p tcp --dport 8443 -j DROP

# Проверка восстановления
tail -f /var/log/net_port_client.log | grep -i "reconnect\|heartbeat"
```

### 7.2. Тест восстановления базы данных
```bash
# Симуляция сбоя БД
sudo systemctl stop postgresql
sleep 10
sudo systemctl start postgresql

# Проверка восстановления соединений
psql -c "SELECT count(*) FROM devices;" net_port
```

## 8. Тестирование мониторинга

### 8.1. Тест метрик Prometheus
```bash
# Получение метрик
curl http://localhost:9090/metrics

# Проверка алертов
curl http://localhost:9090/api/v1/alerts

# Тест Grafana дашбордов
curl http://localhost:3000/api/dashboards/uid/net_port
```

### 8.2. Тест health checks
```bash
# Health check endpoint
curl http://localhost:8080/health

# Подробный статус
curl http://localhost:8080/health/detailed

# readiness/liveness пробы
curl http://localhost:8080/ready
curl http://localhost:8080/live
```

## 9. Интеграционное тестирование

### 9.1. Полный сценарий работы
```bash
#!/bin/bash
# complete_test_scenario.sh

echo "1. Запуск сервера..."
./net_port_server --enable-device-management &

echo "2. Регистрация устройства..."
DEVICE_RESPONSE=$(curl -k -s -X POST https://localhost:8443/device/register \
  -H "Content-Type: application/json" \
  -d '{
    "action": "register",
    "device_id": "integration-test-device",
    "auth_token": "integration-test-token",
    "version": "1.0"
  }')

SESSION_TOKEN=$(echo $DEVICE_RESPONSE | jq -r '.session_token')
ASSIGNED_PORT=$(echo $DEVICE_RESPONSE | jq -r '.assigned_port')

echo "3. Запуск клиента на порту $ASSIGNED_PORT..."
./net_port_client \
  --device-id "integration-test-device" \
  --device-token "integration-test-token" \
  --registration-server localhost \
  --registration-port 8443 \
  --host-in localhost \
  --p-in $ASSIGNED_PORT \
  --host-out 127.0.0.1 \
  --p-out 22 &

echo "4. Тест подключения через туннель..."
sleep 5
ssh -p $ASSIGNED_PORT localhost "echo 'Connection successful!'"

echo "5. Проверка статистики..."
STATS_RESPONSE=$(curl -s http://localhost:8080/stats)
echo $STATS_RESPONSE | jq '.'

echo "6. Очистка..."
pkill net_port_server
pkill net_port_client
```

## 10. Автоматизация тестирования

### 10.1. CI/CD конфигурация
```yaml
# .github/workflows/test.yml
name: Net Port Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:13
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: net_port_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
    - uses: actions/checkout@v2
    
    - name: Setup Node.js
      uses: actions/setup-node@v2
      with:
        node-version: '16'
    
    - name: Install dependencies
      run: |
        cd web/backend_net_port
        npm ci
    
    - name: Run database migrations
      run: |
        psql -h localhost -U postgres -d net_port_test -f init_device_db.sql
    
    - name: Run unit tests
      run: |
        cd web/backend_net_port
        npm test
    
    - name: Build server
      run: |
        mkdir -p server/build
        cd server/build
        cmake ..
        make
    
    - name: Run integration tests
      run: |
        ./run_integration_tests.sh
    
    - name: Security scan
      uses: snyk/actions/node@master
      env:
        SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
```

## 11. Критерии приемки

### 11.1. Функциональные требования
- [ ] Устройство может зарегистрироваться на сервере
- [ ] Устройство получает уникальный динамический порт
- [ ] Внешние клиенты могут подключиться к устройству через назначенный порт
- [ ] Heartbeat механизм поддерживает соединение
- [ ] Веб-интерфейс отображает статус устройств
- [ ] Статистика собирается и отображается корректно

### 11.2. Требования к производительности
- [ ] Поддержка 1000+ одновременных устройств
- [ ] Задержка < 100ms для 95% запросов
- [ ] Пропускная способность > 100Mbps на устройство
- [ ] Память < 1MB на активное соединение

### 11.3. Требования безопасности
- [ ] Все соединения используют TLS 1.2+
- [ ] Rate limiting предотвращает DoS атаки
- [ ] Аутентификация устройств безопасна
- [ ] Нет утечек памяти или чувствительных данных

### 11.4. Требования надежности
- [ ] Автоматическое восстановление после сбоев сети
- [ ] Сохранение состояния при перезапуске
- [ ] Graceful degradation при высокой нагрузке
- [ ] Резервное копирование и восстановление данных

## 12. Документация для тестирования

### 12.1. Чеклист развертывания
```markdown
- [ ] Установлена PostgreSQL 12+
- [ ] Установлен Redis 6+
- [ ] Настроены SSL сертификаты
- [ ] Открыты порты 8443 (управление) и 10000-60000 (данные)
- [ ] Настроен фаервол
- [ ] Созданы системные пользователи
- [ ] Настроено логирование
- [ ] Настроен мониторинг
- [ ] Настроены алерты
```

### 12.2. Чеклист тестирования
```markdown
- [ ] Тестирование установки
- [ ] Тестирование конфигурации
- [ ] Функциональное тестирование
- [ ] Тестирование производительности
- [ ] Тестирование безопасности
- [ ] Тестирование отказоустойчивости
- [ ] Приемочное тестирование
- [ ] Документирование результатов
```

## Заключение

Данный тестовый план обеспечивает комплексную проверку всех компонентов системы динамического перенаправления портов. Реализация и выполнение этих тестов гарантирует, что система соответствует всем функциональным, производительностным и безопасностным требованиям.