//
// Created by chistyakov_ds on 29.09.2022.
//

#ifndef NET_PORT_CLIENT_H
#define NET_PORT_CLIENT_H

#include <stdint.h>
#include <stdbool.h>

#include "hal_thread.h"

#include <memory.h>
#include <unistd.h>
#include <errno.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

#define SOCKET int
#define Sleep(x) usleep(x*1000)
#define WSAGetLastError() errno

#define RESTART_SOCKET_TIMEOUT      3600

// данные одного подключения (входящее/исходящее)
typedef struct proxy_server_connection_s
{
    uint16_t id;
    
    Thread input_thread;
    Thread output_thread;

    bool is_starting_input;
    bool is_running_input;
    bool stop_running_input;

    SOCKET input;
    struct sockaddr_in input_addr;

    bool is_starting_output;
    bool is_running_output;
    bool stop_running_output;

    SOCKET output;
    struct sockaddr_in output_addr;

    uint8_t receive_input[16384];
    uint8_t receive_output[16384];

    uint64_t last_exchange_time;
} proxy_server_connection_t;

typedef struct proxy_server_thread_data_s
{
    proxy_server_connection_t *connections;
    int connections_count;
    int timeout_seconds;

    char input_address[32];
    uint16_t input_port;
    char output_address[32];
    uint16_t output_port;
    
    bool graceful_shutdown; // Флаг для graceful shutdown
} proxy_server_thread_data_t;

proxy_server_thread_data_t* get_client_settings();

/**
 * \brief
 *
 * \return -1 ошибка
 */
int switcher_servers_start();
void switcher_servers_stop();
void switcher_servers_wait_stop();

#endif //NET_PORT_CLIENT_H
