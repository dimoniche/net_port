# Windows-клиент Net Port

Консольный proxy-клиент для Windows (x64). Собирается кросс-компиляцией MinGW на Linux:

```bash
./scripts/build-client-windows.sh
```

Артефакт: `artifacts/clients/module_net_port_client-<версия>.exe` (версия из [`VERSION`](../VERSION)).

## Режимы

| Режим | Поддержка |
|-------|-----------|
| Legacy proxy (фиксированные порты) | Да |
| Регистрация устройств (8443, динамические порты) | Нет — используйте [Linux-клиент](../client/) |

## Пример запуска

```cmd
module_net_port_client-0.0.4.exe --host_in SERVER_IP -p_in 6000 --host_out 127.0.0.1 -p_out 22
```

## Сборка на Windows (Visual Studio)

Откройте `CMakeSettings.json` в Visual Studio или:

```bat
cmake -S . -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
```

## Сборка в Docker (рекомендуется для CI)

См. `scripts/cross-build-client-windows.Dockerfile` и `scripts/build-client-windows.sh`.
