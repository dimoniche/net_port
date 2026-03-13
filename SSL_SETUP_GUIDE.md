# SSL/TLS Setup Guide для Net Port Proxy

## 📋 Оглавление
1. [Генерация сертификатов](#генерация-сертификатов)
2. [Структура файлов](#структура-файлов)
3. [Запуск сервера](#запуск-сервера)
4. [Запуск клиента](#запуск-клиента)
5. [Проверка SSL соединения](#проверка-ssl-соединения)
6. [Решение проблем](#решение-проблем)

---

## 🔐 Генерация сертификатов

### Требования:
- OpenSSL (установлен на большинстве Linux систем)
- Права на запись в директорию

### Вариант 1: Генерация самоподписанного сертификата (для разработки)

#### Шаг 1: Создайте директорию для сертификатов
```bash
mkdir -p /etc/net_port/certs
cd /etc/net_port/certs
```

#### Шаг 2: Сгенерируйте приватный ключ сервера
```bash
openssl genrsa -out server.key 2048
```

**Объяснение:**
- `genrsa` - генерация RSA ключа
- `-out server.key` - сохраняет ключ в файл `server.key`
- `2048` - длина ключа (2048 бит - стандарт для базовой безопасности)

**Результат:**
```
Generating RSA private key, 2048 bit long modulus (2 primes)
..................................+++++
..+++++
e is 65537 (0x010001)
```

#### Шаг 3: Создайте файл конфигурации для сертификата (опционально)

```bash
cat > cert.conf << EOF
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
C = RU
ST = Moscow
L = Moscow
O = Net Port Organization
OU = Proxy Server
CN = localhost

[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:localhost, DNS:127.0.0.1, IP:127.0.0.1
EOF
```

#### Шаг 4: Сгенерируйте самоподписанный сертификат

**Вариант A: С конфиг файлом**
```bash
openssl req -new -x509 -key server.key -out server.crt -days 365 -config cert.conf
```

**Вариант B: С интерактивными вопросами**
```bash
openssl req -new -x509 -key server.key -out server.crt -days 365
```

Ответьте на вопросы (можно просто Enter):
```
Country Name (2 letter code) [AU]: RU
State or Province Name (full name) [Some-State]: Moscow
Locality Name (eg, city) []: Moscow
Organization Name (eg, company) [Internet Widgits Pty Ltd]: Net Port
Organizational Unit Name (eg, section) []: Proxy
Common Name (eg, your name or your server hostname) []: localhost
Email Address []: admin@localhost
```

**Параметры:**
- `req` - запрос сертификата
- `-new` - новый запрос
- `-x509` - самоподписанный сертификат (без CA)
- `-key server.key` - использует приватный ключ
- `-out server.crt` - выходной файл сертификата
- `-days 365` - сертификат действует 365 дней
- `-config cert.conf` - использует конфиг файл

**Результат:**
```
Generating a RSA private key, 2048 bit long modulus
..............................................................................................+++
.....+++
e is 65537 (0x010001)
```

#### Шаг 5: Используйте CA сертификат как CA файл для клиента

```bash
# Сервер использует server.crt и server.key
# Клиент использует server.crt как CA сертификат для проверки
cp server.crt /etc/net_port/certs/ca.crt
```

### Вариант 2: Генерация сертификата через CA (для production)

#### Создайте корневой CA сертификат:
```bash
# Генерируем CA ключ
openssl genrsa -out ca.key 2048

# Генерируем CA сертификат
openssl req -new -x509 -days 3650 -key ca.key -out ca.crt \
  -subj "/C=RU/ST=Moscow/L=Moscow/O=Net Port/CN=Net Port CA"
```

#### Создайте сертификат сервера, подписанный CA:
```bash
# Генерируем ключ сервера
openssl genrsa -out server.key 2048

# Создаем запрос на подпись сертификата (CSR)
openssl req -new -key server.key -out server.csr \
  -subj "/C=RU/ST=Moscow/L=Moscow/O=Net Port/CN=localhost"

# Подписываем CSR CA сертификатом
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out server.crt -days 365 \
  -extensions v3_req -extfile <(printf "subjectAltName=DNS:localhost,IP:127.0.0.1")
```

---

## 📁 Структура файлов

Рекомендуемая структура папок:

```
/etc/net_port/
├── certs/
│   ├── server.key          # Приватный ключ сервера (СЕКРЕТНЫЙ!)
│   ├── server.crt          # Сертификат сервера
│   └── ca.crt              # CA сертификат (используется клиентом)
└── config/
    └── proxy_config.conf   # Конфиг сервера/клиента
```

**Права доступа (ВАЖНО!):**
```bash
# Только владелец может читать приватный ключ
chmod 600 /etc/net_port/certs/server.key

# Сертификаты и CA могут быть доступны для чтения
chmod 644 /etc/net_port/certs/server.crt
chmod 644 /etc/net_port/certs/ca.crt
```

---

## 🚀 Запуск сервера

### Способ 1: С опциями командной строки

```bash
# Основной запуск (нужно знать параметры программы)
./module_net_port_server-0.0.3 \
  --enable-ssl \
  --cert /etc/net_port/certs/server.crt \
  --key /etc/net_port/certs/server.key
```

### Способ 2: С конфиг файлом (если поддерживается)

```bash
# Создайте конфиг файл
cat > /etc/net_port/proxy_config.conf << 'EOF'
# Server Configuration
enable_ssl=true
cert_file=/etc/net_port/certs/server.crt
key_file=/etc/net_port/certs/server.key

# Ports
input_port=5000
output_port=5001

# Database
db_host=localhost
db_port=5432
db_name=net_port
db_user=net_port
db_password=***

# SSL Options
ssl_verify_mode=none
EOF

# Запустите сервер с конфигом
./module_net_port_server-0.0.3 -c /etc/net_port/proxy_config.conf
```

### Способ 3: С переменными окружения

```bash
export NET_PORT_SSL_ENABLED=true
export NET_PORT_CERT_FILE=/etc/net_port/certs/server.crt
export NET_PORT_KEY_FILE=/etc/net_port/certs/server.key

./module_net_port_server-0.0.3
```

### Отладка запуска сервера:

```bash
# С максимальным логированием
NET_PORT_DEBUG=1 ./module_net_port_server-0.0.3 \
  --enable-ssl \
  --cert /etc/net_port/certs/server.crt \
  --key /etc/net_port/certs/server.key \
  --log-level DEBUG

# В отдельном окне посмотрите логи
tail -f /var/log/net_port/server.log

# Или прямо в консоль (если поддерживается)
./module_net_port_server-0.0.3 \
  --enable-ssl \
  --cert /etc/net_port/certs/server.crt \
  --key /etc/net_port/certs/server.key \
  --foreground
```

---

## 💻 Запуск клиента

### Способ 1: С опциями командной строки

```bash
# Основной запуск
./module_net_port_client-0.0.3 \
  --enable-ssl \
  --ca-cert /etc/net_port/certs/ca.crt \
  --server-host 127.0.0.1 \
  --server-port 5000
```

### Способ 2: С конфиг файлом

```bash
# Создайте конфиг файл для клиента
cat > /etc/net_port/client_config.conf << 'EOF'
# Client Configuration
enable_ssl=true
ca_cert=/etc/net_port/certs/ca.crt

# Server Connection
server_host=127.0.0.1
server_port=5000
output_port=5001

# Timeouts
connection_timeout=30
read_timeout=60
EOF

# Запустите клиента с конфигом
./module_net_port_client-0.0.3 -c /etc/net_port/client_config.conf
```

### Способ 3: С переменными окружения

```bash
export NET_PORT_SSL_ENABLED=true
export NET_PORT_CA_CERT=/etc/net_port/certs/ca.crt
export NET_PORT_SERVER_HOST=127.0.0.1
export NET_PORT_SERVER_PORT=5000

./module_net_port_client-0.0.3
```

### Отладка запуска клиента:

```bash
# С максимальным логированием
NET_PORT_DEBUG=1 ./module_net_port_client-0.0.3 \
  --enable-ssl \
  --ca-cert /etc/net_port/certs/ca.crt \
  --server-host 127.0.0.1 \
  --server-port 5000 \
  --log-level DEBUG

# В отдельном окне посмотрите логи
tail -f /var/log/net_port/client.log

# Или прямо в консоль
./module_net_port_client-0.0.3 \
  --enable-ssl \
  --ca-cert /etc/net_port/certs/ca.crt \
  --server-host 127.0.0.1 \
  --server-port 5000 \
  --foreground
```

---

## 🔍 Проверка SSL соединения

### Проверка 1: Просмотр информации о сертификате

```bash
# Просмотр сертификата сервера
openssl x509 -in /etc/net_port/certs/server.crt -text -noout

# Вывод:
# Certificate:
#     Data:
#         Version: 3 (0x2)
#         Serial Number: ...
#     Signature Algorithm: sha256WithRSAEncryption
#     Issuer: C = RU, ST = Moscow, L = Moscow, O = Net Port, CN = localhost
#     Validity
#         Not Before: Dec 17 10:00:00 2025 GMT
#         Not After : Dec 17 10:00:00 2026 GMT
#     Subject: C = RU, ST = Moscow, L = Moscow, O = Net Port, CN = localhost
```

### Проверка 2: Проверка ключа и сертификата

```bash
# Проверка соответствия ключа и сертификата
openssl x509 -noout -modulus -in /etc/net_port/certs/server.crt | openssl md5
openssl rsa -noout -modulus -in /etc/net_port/certs/server.key | openssl md5

# Результаты должны быть одинаковыми
```

### Проверка 3: Проверка SSL соединения с помощью openssl client

```bash
# Подключитесь к серверу с помощью openssl s_client
openssl s_client -connect 127.0.0.1:5000 -CAfile /etc/net_port/certs/ca.crt

# Вы должны увидеть:
# verify return:1
# CONNECTED(00000003)
# depth=0 C = RU, ST = Moscow, L = Moscow, O = Net Port, CN = localhost
# verify return:1
# ---
# Certificate chain
#  0 s:CN=localhost
#    i:CN=localhost
```

### Проверка 4: Тестирование передачи данных через SSL

```bash
# Откройте два терминала

# Терминал 1 - запустите сервер
./module_net_port_server-0.0.3 \
  --enable-ssl \
  --cert /etc/net_port/certs/server.crt \
  --key /etc/net_port/certs/server.key

# Терминал 2 - запустите клиента
./module_net_port_client-0.0.3 \
  --enable-ssl \
  --ca-cert /etc/net_port/certs/ca.crt \
  --server-host 127.0.0.1 \
  --server-port 5000

# Ищите в логах:
# Server: "SSL connection established on output_port 5001"
# Client: "SSL connection established for connection 0"
```

### Проверка 5: Просмотр логов

```bash
# Проверьте логи сервера на успешное SSL соединение
grep "SSL connection established" /var/log/net_port/server.log

# Проверьте логи клиента
grep "SSL connection established" /var/log/net_port/client.log

# Должны быть строки типа:
# [INFO] SSL connection established on output_port 5001
# [INFO] SSL connection established for connection 0
```

---

## 🐛 Решение проблем

### Проблема 1: "Failed to load server certificate"

**Причины:**
- Файл сертификата не существует
- Неправильный путь
- Неправильный формат файла

**Решение:**
```bash
# Проверьте существование файла
ls -la /etc/net_port/certs/server.crt

# Проверьте формат файла (должен быть PEM)
file /etc/net_port/certs/server.crt
# Результат: PEM certificate

# Проверьте содержимое
head -1 /etc/net_port/certs/server.crt
# Должно начинаться с: -----BEGIN CERTIFICATE-----
```

### Проблема 2: "Private key does not match the certificate"

**Причины:**
- Ключ и сертификат не совпадают
- Использованы разные ключи

**Решение:**
```bash
# Проверьте модули (должны совпадать)
openssl x509 -noout -modulus -in /etc/net_port/certs/server.crt | openssl md5
openssl rsa -noout -modulus -in /etc/net_port/certs/server.key | openssl md5

# Если не совпадают - переген заново:
openssl genrsa -out server.key 2048
openssl req -new -x509 -key server.key -out server.crt -days 365
```

### Проблема 3: "SSL handshake failed on output_port"

**Причины:**
- Сертификат истек
- Неправильная версия TLS
- Сертификат не подписан доверенным CA (для клиента)

**Решение:**
```bash
# Проверьте дату сертификата
openssl x509 -noout -dates -in /etc/net_port/certs/server.crt
# Результат:
# notBefore=Dec 17 10:00:00 2025 GMT
# notAfter=Dec 17 10:00:00 2026 GMT

# Если истек - создайте новый:
openssl req -new -x509 -key server.key -out server.crt -days 3650

# Для клиента - убедитесь что используется правильный CA файл
cat /etc/net_port/certs/ca.crt | head -1
# Должно начинаться с: -----BEGIN CERTIFICATE-----
```

### Проблема 4: "No peer certificate" на сервере

**Причина:**
- Клиент не отправляет сертификат (это нормально для Варианта 2!)

**Решение:**
Это НЕ ошибка! В текущей конфигурации (Вариант 2):
- Сервер НЕ требует сертификат клиента
- Логирование "No peer certificate" было удалено
- Если видите эту ошибку - значит используется старая версия кода

Обновите код до последней версии.

### Проблема 5: "Failed to load CA certificate" на клиенте

**Причины:**
- Файл CA не существует
- Неправильный путь
- Неправильный формат

**Решение:**
```bash
# Проверьте файл
ls -la /etc/net_port/certs/ca.crt

# Должен содержать PEM сертификат
file /etc/net_port/certs/ca.crt

# Проверьте что это копия server.crt (для самоподписанного)
diff /etc/net_port/certs/ca.crt /etc/net_port/certs/server.crt
# Должны быть одинаковыми для самоподписанного сертификата
```

### Проблема 6: Сертификат просрочен

**Решение:**
```bash
# Создайте новый сертификат на более длительный период
openssl req -new -x509 -key /etc/net_port/certs/server.key \
  -out /etc/net_port/certs/server.crt \
  -days 3650 \
  -subj "/C=RU/ST=Moscow/L=Moscow/O=Net Port/CN=localhost"

# Обновите CA для клиента
cp /etc/net_port/certs/server.crt /etc/net_port/certs/ca.crt

# Перезагрузите сервер и клиента
```

---

## 📝 Полный пример: Шаг за шагом

### Подготовка

```bash
# 1. Создайте директорию
mkdir -p /etc/net_port/certs
cd /etc/net_port/certs

# 2. Сгенерируйте сертификаты
openssl genrsa -out server.key 2048
openssl req -new -x509 -key server.key -out server.crt -days 3650 \
  -subj "/C=RU/ST=Moscow/L=Moscow/O=Net Port/CN=localhost"

# 3. Создайте CA файл для клиента
cp server.crt ca.crt

# 4. Установите правильные права доступа
chmod 600 server.key
chmod 644 server.crt
chmod 644 ca.crt

# 5. Проверьте
ls -la /etc/net_port/certs/
```

### Запуск в трех окнах терминала

**Окно 1: Мониторинг логов сервера**
```bash
tail -f /var/log/net_port/server.log
```

**Окно 2: Запуск сервера**
```bash
cd /home/dimoniche/home/net_port/build/server
./module_net_port_server-0.0.3 \
  --enable-ssl \
  --cert /etc/net_port/certs/server.crt \
  --key /etc/net_port/certs/server.key

# Ожидаемый вывод:
# [INFO] Server SSL context created
# [INFO] SSL context initialized
# [INFO] Connection accepted on output_port 5001
```

**Окно 3: Запуск клиента**
```bash
cd /home/dimoniche/home/net_port/build/client
./module_net_port_client-0.0.3 \
  --enable-ssl \
  --ca-cert /etc/net_port/certs/ca.crt \
  --server-host 127.0.0.1 \
  --server-port 5000

# Ожидаемый вывод:
# [INFO] Client SSL context created
# [INFO] SSL connection established for connection 0
```

### Проверка

```bash
# Проверьте что оба процесса работают
ps aux | grep module_net_port

# Проверьте что используются нужные порты
netstat -tlnp | grep 500[01]
# или
ss -tlnp | grep 500[01]

# Проверьте логи
grep "SSL connection established" /var/log/net_port/server.log
grep "SSL connection established" /var/log/net_port/client.log
```

---

## ⚙️ Дополнительные опции OpenSSL

### Генерация сертификата с SAN (Subject Alternative Names)

```bash
openssl req -new -x509 -key server.key -out server.crt -days 3650 \
  -addext "subjectAltName=DNS:localhost,DNS:*.example.com,IP:127.0.0.1" \
  -subj "/C=RU/ST=Moscow/L=Moscow/O=Net Port/CN=localhost"
```

### Просмотр SAN в сертификате

```bash
openssl x509 -in server.crt -noout -text | grep -A1 "Subject Alternative Name"
```

### Проверка цепочки сертификатов

```bash
openssl verify -CAfile ca.crt server.crt
# Результат: server.crt: OK
```

---

## 🔒 Рекомендации безопасности

1. **Приватный ключ:**
   - Храните в безопасности (chmod 600)
   - Никогда не передавайте по сети
   - Используйте только на сервере

2. **Сертификат:**
   - Может быть скопирован клиентам
   - Можно использовать как CA файл для клиентов

3. **Для production:**
   - Используйте сертификаты от доверенного CA (Let's Encrypt, DigiCert и т.д.)
   - Не используйте самоподписанные сертификаты
   - Регулярно обновляйте сертификаты

4. **Для разработки:**
   - Самоподписанные сертификаты приемлемы
   - Убедитесь что клиент использует тот же CA сертификат
   - Используйте localhost или внутренние IP адреса

---

## 📚 Полезные команды

```bash
# Просмотр сертификата
openssl x509 -in server.crt -text -noout

# Просмотр ключа
openssl rsa -in server.key -text -noout

# Просмотр CSR
openssl req -in server.csr -text -noout

# Проверка ключа на ошибки
openssl rsa -in server.key -check -noout

# Конвертация формата
openssl x509 -inform PEM -in server.crt -out server.der

# Извлечение модуля ключа
openssl rsa -noout -modulus -in server.key

# Извлечение модуля сертификата
openssl x509 -noout -modulus -in server.crt

# Проверка срока действия
openssl x509 -noout -dates -in server.crt

# Просмотр размера ключа
openssl rsa -in server.key -text -noout | grep "Private-Key"
```

---

## 📞 Контакты и поддержка

Если возникли проблемы:
1. Проверьте логи: `/var/log/net_port/`
2. Используйте openssl для диагностики
3. Убедитесь что сертификаты в формате PEM
4. Проверьте права доступа к файлам
