# Архитектурная диаграмма системы динамического перенаправления портов

## Общая архитектура системы

```mermaid
graph TB
    subgraph "Внешняя сеть"
        EC1[Внешний клиент 1]
        EC2[Внешний клиент 2]
        EC3[Внешний клиент N]
    end
    
    subgraph "Сервер Net Port"
        subgraph "Фронтенд"
            WEB[Веб-интерфейс<br/>Feathers.js]
            API[REST API<br/>Порт: 3030]
        end
        
        subgraph "Бэкенд"
            CS[Control Server<br/>Порт: 8443 SSL]
            PS[Proxy Server<br/>Динамические порты 10000-60000]
            DB[(База данных<br/>PostgreSQL)]
        end
        
        WEB --> API
        API --> DB
        CS --> DB
        PS --> DB
    end
    
    subgraph "IoT устройства"
        D1[Устройство 1<br/>ID: device-001]
        D2[Устройство 2<br/>ID: device-002]
        D3[Устройство N<br/>ID: device-NNN]
    end
    
    EC1 -->|Порт 15001| PS
    EC2 -->|Порт 15002| PS
    EC3 -->|Порт 150XX| PS
    
    D1 -->|SSL:8443| CS
    D2 -->|SSL:8443| CS
    D3 -->|SSL:8443| CS
    
    PS -->|Туннель| D1
    PS -->|Туннель| D2
    PS -->|Туннель| D3
```

## Детальная схема потоков данных

```mermaid
flowchart TD
    Start[Клиент IoT подключается] --> Connect[Установка SSL соединения<br/>на порт 8443]
    Connect --> Auth[Отправка credentials<br/>device_id + auth_token]
    Auth --> Validate{Проверка в БД}
    Validate -->|Невалидные| Reject[Отказ в подключении]
    Validate -->|Валидные| Allocate[Выделение свободного порта]
    
    Allocate --> Register[Регистрация mapping в БД<br/>device_id → assigned_port]
    Register --> Response[Отправка ответа клиенту<br/>port + session_token]
    Response --> Heartbeat[Начало heartbeat<br/>каждые 30 секунд]
    
    Heartbeat --> Listen[Сервер слушает<br/>назначенный порт]
    
    subgraph "Внешнее подключение"
        ExtClient[Внешний клиент] --> ExtConnect[Подключение к assigned_port]
        ExtConnect --> Lookup[Поиск device_id по порту]
        Lookup --> Forward[Перенаправление к IoT устройству]
        Forward --> Tunnel[Установка туннеля]
    end
    
    Listen --> ExtConnect
    
    Tunnel --> Bidirectional[Двусторонний обмен данными]
    
    Bidirectional --> Monitor[Мониторинг трафика<br/>и статистика]
    Monitor --> Log[Логирование в БД]
```

## Компонентная архитектура сервера

```mermaid
graph LR
    subgraph "Модуль управления"
        AM[Auth Manager<br/>Аутентификация]
        PM[Port Manager<br/>Управление портами]
        SM[Session Manager<br/>Управление сессиями]
        HM[Heartbeat Manager<br/>Мониторинг]
    end
    
    subgraph "Модуль данных"
        DM[Database Manager<br/>Работа с БД]
        CM[Cache Manager<br/>Redis кэш]
        LM[Log Manager<br/>Логирование]
    end
    
    subgraph "Модуль прокси"
        TM[Tunnel Manager<br/>Туннелирование]
        BM[Buffer Manager<br/>Буферизация]
        EM[Encryption Manager<br/>Шифрование]
    end
    
    subgraph "Интерфейсы"
        CI[Control Interface<br/>Порт 8443]
        PI[Proxy Interface<br/>Порты 10000-60000]
        WI[Web Interface<br/>Порт 3030]
    end
    
    CI --> AM
    AM --> DM
    AM --> CM
    
    PI --> TM
    TM --> BM
    BM --> EM
    
    WI --> DM
    WI --> LM
    
    PM --> DM
    SM --> CM
    HM --> DM
    
    TM --> PM
    TM --> SM
```

## Схема состояний клиента IoT

```mermaid
stateDiagram-v2
    [*] --> Disconnected: Начальное состояние
    
    Disconnected --> Connecting: Инициировано подключение
    Connecting --> Authenticating: Установлено соединение
    Authenticating --> Registered: Успешная аутентификация
    Registered --> Active: Получен порт, heartbeat начат
    
    Active --> HeartbeatTimeout: Пропущен heartbeat
    HeartbeatTimeout --> Reconnecting: Попытка переподключения
    
    Reconnecting --> Registered: Успешное переподключение
    Reconnecting --> Disconnected: Неудачное переподключение
    
    Active --> DataTransfer: Внешнее подключение
    DataTransfer --> Active: Завершение передачи
    
    Active --> GracePeriod: Разрыв соединения
    GracePeriod --> Disconnected: Таймаут grace period
    
    note right of Active
        Состояние нормальной работы:
        - Порт назначен
        - Heartbeat активен
        - Готов к подключениям
    end note
    
    note right of DataTransfer
        Активная передача данных:
        - Туннель установлен
        - Данные передаются в обе стороны
        - Статистика обновляется
    end note
```

## Схема безопасности

```mermaid
graph TD
    subgraph "Уровни безопасности"
        L1[Уровень 1: Сетевой]
        L2[Уровень 2: Транспортный]
        L3[Уровень 3: Прикладной]
        L4[Уровень 4: Данные]
    end
    
    subgraph "Механизмы L1"
        FW[Фаервол<br/>iptables/nftables]
        IPS[IPS/IDS<br/>Suricata/Snort]
        RL[Rate Limiting<br/>nginx/iptables]
    end
    
    subgraph "Механизмы L2"
        TLS[TLS 1.2+<br/>Let's Encrypt]
        PFS[Perfect Forward Secrecy]
        CIPHER[Сильные шифры]
    end
    
    subgraph "Механизмы L3"
        AUTH[Аутентификация<br/>Token-based]
        ACL[Контроль доступа<br/>RBAC]
        AUDIT[Аудит действий]
    end
    
    subgraph "Механизмы L4"
        ENC[Шифрование данных<br/>end-to-end]
        VALID[Валидация данных]
        SANIT[Санобработка входных данных]
    end
    
    L1 --> FW
    L1 --> IPS
    L1 --> RL
    
    L2 --> TLS
    L2 --> PFS
    L2 --> CIPHER
    
    L3 --> AUTH
    L3 --> ACL
    L3 --> AUDIT
    
    L4 --> ENC
    L4 --> VALID
    L4 --> SANIT
```

## Схема масштабирования

```mermaid
graph TB
    subgraph "Кластер серверов"
        LB[Балансировщик нагрузки<br/>HAProxy/nginx]
        
        subgraph "Узел 1"
            S1[Сервер 1]
            S1DB[(Локальная БД)]
            S1C[(Redis кэш)]
        end
        
        subgraph "Узел 2"
            S2[Сервер 2]
            S2DB[(Локальная БД)]
            S2C[(Redis кэш)]
        end
        
        subgraph "Узел N"
            SN[Сервер N]
            SNDB[(Локальная БД)]
            SNC[(Redis кэш)]
        end
    end
    
    subgraph "Централизованные сервисы"
        CDB[(Главная БД<br/>PostgreSQL)]
        CC[(Распределенный кэш<br/>Redis Cluster)]
        MON[Мониторинг<br/>Prometheus/Grafana]
    end
    
    LB --> S1
    LB --> S2
    LB --> SN
    
    S1 --> CDB
    S2 --> CDB
    SN --> CDB
    
    S1 --> CC
    S2 --> CC
    SN --> CC
    
    S1 --> MON
    S2 --> MON
    SN --> MON
    
    S1DB -.-> CDB
    S2DB -.-> CDB
    SNDB -.-> CDB
    
    S1C -.-> CC
    S2C -.-> CC
    SNC -.-> CC
```

## Заключение

Предложенная архитектура обеспечивает:
1. **Масштабируемость**: Поддержка тысяч одновременных подключений
2. **Безопасность**: Многоуровневая защита на всех этапах
3. **Надёжность**: Автоматическое восстановление при сбоях
4. **Управляемость**: Централизованный контроль через веб-интерфейс
5. **Совместимость**: Интеграция с существующей инфраструктурой net_port