//
// Created by chistyakov_ds on 29.09.2022.
//

#ifndef NET_PORT_CLIENT_H
#define NET_PORT_CLIENT_H

#include <stdint.h>
#include <stdbool.h>

#include "hal_thread.h"

#include <stdlib.h>
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

#define RESTART_SOCKET_TIMEOUT      1200

typedef struct proxy_server_s
{
    uint16_t id;
    uint16_t port;

    Thread input_thread;
    Thread output_thread;

    bool is_starting_input;
    bool is_running_input;
    bool stop_running_input;

    char input_address[32];
    uint16_t input_port;
    struct sockaddr_in input_addr;
    SOCKET input;

    bool is_starting_output;
    bool is_running_output;
    bool stop_running_output;

    char output_address[32];
    uint16_t output_port;
    struct sockaddr_in output_addr;
    SOCKET output;
} proxy_server_t;

// данные одного подключения (входящее/исходящее)
typedef struct proxy_server_connected_socket_data_s {

    uint8_t receive_input[16384];
    uint8_t receive_output[16384];

    proxy_server_t * data;

} proxy_server_connected_socket_data_t;

typedef struct proxy_server_thread_data_s
{
    uint8_t receive_input[16384];
    uint8_t receive_output[16384];

    proxy_server_t data;

} proxy_server_thread_data_t;

proxy_server_t* get_client_settings();

/**
 * \brief
 *
 * \return -1 ошибка
 */
int switcher_servers_start();

#endif //NET_PORT_CLIENT_H
