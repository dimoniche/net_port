//
// Created by chistyakov_ds on 29.09.2022.
//

#ifndef CRYPT_SWITCHER_SWITCHER_H
#define CRYPT_SWITCHER_SWITCHER_H

#include <stdint.h>
#include <stdbool.h>

#include "hal_thread.h"

#ifdef _WIN32
#include <io.h>
#include <WinSock.h>
#else
#define SOCKET int
#include <stdlib.h>
#include <memory.h>
#include <unistd.h>
#include <errno.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

#define Sleep(x) usleep(x*1000)
#define WSAGetLastError() errno
#endif

#define INPUT_SOCKET    0
#define OUTPUT_SOCKET   1

#define HTTP_SERVER_ENABLE

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

    // текущий пустой входящий сокет
    int current_free_socket_input;
    // текущий пустой исходящий сокет
    int current_free_socket_output;

} proxy_server_t;

// количество одновременных подключений на одном сокете
#define COUNT_SOCKET_THREAD   5

// локальные сокеты и их буфера
typedef struct proxy_server_local_socket_data_s
{
    SOCKET input_local;
    SOCKET output_local;

    uint8_t input_buf[8192];
    uint8_t output_buf[8192];

    // есть подключение из вне пользователя
    bool is_input_connected;
    // есть подключение внутреннего устройства
    bool is_output_connected;
    // необходимость закрытия исходящего к клиенту сокета
    bool close_output_socket;

    // настроечные данные сервера
    proxy_server_t * data;

} proxy_server_local_socket_data_t;

typedef struct proxy_server_thread_data_s
{
    // данные сокетов
    proxy_server_local_socket_data_t local_sockets[COUNT_SOCKET_THREAD];

    // настроечные данные одного ожидающего сервера
    proxy_server_t data;

} proxy_server_thread_data_t;

/**
 * \brief Инициализация прослушивателей портов
 *
 * \return -1 ошибка
 */
int servers_init(uint32_t user_id);

/**
 * \brief Запуск прослушивателей портов
 *
 * \return -1 ошибка
 */
int switcher_servers_start();

/**
 * \brief Остановка прослушивателей портов
 *
 * \return -1 ошибка
 */
int
switcher_servers_stop();

#endif //CRYPT_SWITCHER_SWITCHER_H
