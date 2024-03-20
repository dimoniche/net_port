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

typedef struct proxy_server_s
{
    uint16_t id;

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

} proxy_server_t;

typedef struct proxy_server_thread_data_s
{
    SOCKET input_local;
    SOCKET output_local;

    uint8_t input_buf[8192];
    uint8_t output_buf[8192];
    uint8_t sendBuff[8192];

    proxy_server_t data;

} proxy_server_thread_data_t;

/**
 * \brief Инициализация прослушивателей портов
 *
 * \return -1 ошибка
 */
int servers_init();

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

/**
 * \brief Количество криптоканалов
 *
 * \return количество каналов
 */
int getCountCryptServers();

/**
 * \brief Количество открытых криптографических сессий
 *
 * \return количество каналов
 */
uint32_t getCount_Open_Crypt_Session();

#endif //CRYPT_SWITCHER_SWITCHER_H
