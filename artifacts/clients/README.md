# Клиенты для скачивания (дополнительные архитектуры)

Сюда попадают бинарники **после** кросс-сборки. При `docker build` они копируются в образ вместе с amd64-клиентом из CMake.

Версия бинарников задаётся файлом `VERSION` в корне репозитория (`./scripts/bump-version.sh`).

## Сборка (Docker, без multiarch на хосте)

```bash
chmod +x scripts/build-client-cross.sh

# Raspberry Pi / ARM 32-bit
./scripts/build-client-cross.sh armhf

# ARM64 (Pi 4/5, многие SBC)
./scripts/build-client-cross.sh aarch64

# Windows x64 (MinGW, legacy proxy)
./scripts/build-client-windows.sh
```

Результат:

- `module_net_port_client-0.0.4-armhf`
- `module_net_port_client-0.0.4-aarch64`
- `module_net_port_client-0.0.4.exe`

| Платформа | Как попадает в образ |
|-----------|----------------------|
| Linux amd64 | `cmake` в `Dockerfile` → `build/client/` |
| Windows x64 | MinGW-стадия в `Dockerfile` (автоматически) |
| ARM armhf / aarch64 | `./scripts/build-client-cross.sh` → `artifacts/clients/` перед `docker build` |

## Почему не `apt install libssl-dev:armhf` на Ubuntu 24/26?

В новых Ubuntu **armhf убран из основных репозиториев** — пакеты `:armhf` не находятся. Используйте **скрипт выше** (Debian bookworm в Docker) или Debian 12 на хосте:

```bash
# Только на Debian 12 / старом Ubuntu с armhf в репозиториях:
sudo dpkg --add-architecture armhf
sudo apt update
sudo apt install gcc-arm-linux-gnueabihf g++-arm-linux-gnueabihf \
  libssl-dev:armhf libjansson-dev:armhf
```

Затем:

```bash
mkdir -p build-armhf && cd build-armhf
cmake .. -DCMAKE_TOOLCHAIN_FILE=../client/cmake/toolchain-armhf.cmake -DCMAKE_BUILD_TYPE=Release
cmake --build . --target module_net_port_client-0.0.4 -j$(nproc)
cp client/module_net_port_client-0.0.4 ../artifacts/clients/module_net_port_client-0.0.4-armhf
```

## Образ приложения

```bash
./scripts/build-client-cross.sh armhf    # при необходимости
./scripts/build-client-windows.sh        # Windows .exe
docker build -t net_port:latest .
```

Скачивание: `https://<host>/files/build/<имя_файла>`
