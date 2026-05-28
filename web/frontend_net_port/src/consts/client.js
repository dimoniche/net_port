/** Имя собранного бинарника клиента (должно совпадать с client/CMakeLists.txt SOFT_VERSION). */
export const CLIENT_BINARY_NAME = 'module_net_port_client-0.0.4';
export const CLIENT_VERSION_LABEL = '0.0.4';

/** Метаданные карточек скачивания (ключ — имя файла на сервере). */
export const CLIENT_DOWNLOAD_CATALOG = {
  [CLIENT_BINARY_NAME]: {
    id: 'linux-amd64',
    name: `Linux x86_64 — v${CLIENT_VERSION_LABEL}`,
    filename: CLIENT_BINARY_NAME,
    platform: 'Linux',
    architecture: 'x86_64',
    size: '~120 KB',
    color: 'success',
    description:
      'Клиент с регистрацией устройств (8443), heartbeat и динамических портов 6000–7000',
  },
  [`${CLIENT_BINARY_NAME}-armhf`]: {
    id: 'linux-armhf',
    name: `Linux ARM (armhf) — v${CLIENT_VERSION_LABEL}`,
    filename: `${CLIENT_BINARY_NAME}-armhf`,
    platform: 'Linux',
    architecture: 'armhf',
    size: '~120 KB',
    color: 'primary',
    description: 'Raspberry Pi и другие 32-bit ARM (arm-linux-gnueabihf)',
  },
  [`${CLIENT_BINARY_NAME}-aarch64`]: {
    id: 'linux-aarch64',
    name: `Linux ARM64 — v${CLIENT_VERSION_LABEL}`,
    filename: `${CLIENT_BINARY_NAME}-aarch64`,
    platform: 'Linux',
    architecture: 'aarch64',
    size: '~120 KB',
    color: 'secondary',
    description: 'Raspberry Pi 4/5, Orange Pi и другие 64-bit ARM',
  },
};
