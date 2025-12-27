//
// Created by chistyakov_ds on 29.09.2022.
//

#ifndef CRYPT_SWITCHER_SWITCHER_H
#define CRYPT_SWITCHER_SWITCHER_H

#include <stdint.h>
#include <stdbool.h>
#include <semaphore.h>
#include <openssl/ssl.h>
#include <openssl/err.h>

#include "hal_thread.h"

#define SOCKET int
#include <memory.h>
#include <unistd.h>
#include <errno.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

#define Sleep(x) usleep(x*1000)
#define WSAGetLastError() errno

#define INPUT_SOCKET    0
#define OUTPUT_SOCKET   1

#define HTTP_SERVER_ENABLE

#define RESTART_CONNECTION_TIMEOUT      3600

// Структура для хранения статистики сервера
typedef struct proxy_server_statistics_s
{
    uint64_t bytes_received;      // Байт получено
    uint64_t bytes_sent;          // Байт отправлено
    uint32_t connections_count;   // Количество активных соединений
    time_t last_update;           // Время последнего обновления статистики
} proxy_server_statistics_t;

typedef struct proxy_servers_settings_s
{
  char local_address[32];

} proxy_servers_settings_t;

// настройки одного канала сервера
typedef struct proxy_server_s
{
    uint16_t id;

    bool enable;

    uint16_t input_port;
    SOCKET input;
    struct sockaddr_in input_addr;
    Thread listeningInputThread;

    bool is_input_enabled;
    bool is_input_starting;
    bool is_input_running;
    bool stop_input_running;

    uint16_t output_port;
    SOCKET output;
    struct sockaddr_in output_addr;
    Thread listeningOutputThread;

    bool is_output_enabled;
    bool is_output_starting;
    bool is_output_running;
    bool stop_output_running;

    bool enable_ssl; // Флаг включения SSL
    SSL_CTX *ssl_ctx; // SSL контекст для сервера
    char cert_file[256]; // Путь к сертификату сервера
    char key_file[256]; // Путь к приватному ключу сервера
    
    // Статистика сервера
    proxy_server_statistics_t statistics;

} proxy_server_t;

// количество одновременных подключений на одном сокете
extern int COUNT_SOCKET_THREAD;

// Семафор для защиты доступа к статистике серверов
extern sem_t statistics_semaphore;

// локальные сокеты и их буфера
typedef struct proxy_server_local_socket_data_s
{
    SOCKET input_local;
    SOCKET output_local;

    uint8_t input_buf[4096];
    uint8_t output_buf[4096];

    // есть подключение из вне пользователя
    bool is_input_connected;
    // есть подключение внутреннего устройства
    bool is_output_connected;
    // необходимость закрытия исходящего к клиенту сокета
    bool close_output_socket;

    SSL *ssl_output; // SSL объект для исходящего соединения

    // настроечные данные сервера
    proxy_server_t * data;

} proxy_server_local_socket_data_t;

typedef struct proxy_server_thread_data_s
{
    // данные сокетов
    proxy_server_local_socket_data_t *local_sockets;

    // настроечные данные одного ожидающего сервера
    proxy_server_t data;

} proxy_server_thread_data_t;

/**
 * \brief Инициализация прослушивателей портов
 *
 * \return -1 ошибка
 */
int servers_init(uint32_t user_id, const char* cert_file, const char* key_file);

/**
 * \brief Запуск прослушивателей портов
 *
 * \return -1 ошибка
 */
int switcher_servers_start();

// Инициализация серверов без использования БД (один сервер из аргументов)
int servers_init_no_db(const char* cert_file, const char* key_file, uint16_t input_port, uint16_t output_port, bool enable_ssl);

/**
 * \brief Остановка прослушивателей портов
 *
 * \return -1 ошибка
 */
  
// Функции для работы с OpenSSL
void init_ssl_context(proxy_server_t *server);
void init_openssl();
void cleanup_openssl();
SSL_CTX *create_server_ssl_context(const char *cert_file, const char *key_file);
// Освобождение SSL контекста для сервера
void cleanup_ssl_context(proxy_server_t *server);

// Функция для периодического сохранения статистики
void* statistics_saver_thread(void* arg);

int
switcher_servers_stop();

#endif //CRYPT_SWITCHER_SWITCHER_H
