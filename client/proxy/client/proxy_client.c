#include "proxy_client.h"

#include <fcntl.h>
#include <sys/time.h>
#include <stdlib.h>
#include <string.h>

#include "logMsg.h"
#include "time_counter.h"

static proxy_server_thread_data_t threads_data;

int init_input_sockets(proxy_server_connection_t *conn);
int init_output_sockets(proxy_server_connection_t *conn);

void server_input_start(int conn_index);
void server_output_start(int conn_index);

bool server_input_is_running(proxy_server_connection_t *conn);
void input_server_stop(proxy_server_connection_t *conn);
void input_server_wait_stop(proxy_server_connection_t *conn);

proxy_server_thread_data_t* get_client_settings()
{
    return &threads_data;
}

int
switcher_servers_start()
{
    // Инициализация массива подключений
    threads_data.connections = (proxy_server_connection_t *)malloc(threads_data.connections_count * sizeof(proxy_server_connection_t));
    if (!threads_data.connections) {
        logMsg(LOG_ERR, "Failed to allocate memory for connections\n");
        return -1;
    }

    memset(threads_data.connections, 0, threads_data.connections_count * sizeof(proxy_server_connection_t));

    // Запуск всех input потоков
    for (int i = 0; i < threads_data.connections_count; i++) {
        threads_data.connections[i].id = i;
        server_input_start(i);
    }

    logMsg(LOG_DEBUG, "Clients started! Connections: %d\n", threads_data.connections_count);

    return 0;
}

int
init_input_sockets(proxy_server_connection_t *conn)
{
    int ret = 1;

    if ((conn->input = socket(AF_INET, SOCK_STREAM, 0)) < 0)
    {
        logMsg(LOG_ERR, "socket() input error for connection %d\n", conn->id);
        return -2;
    }

    if (setsockopt(conn->input, SOL_SOCKET, SO_REUSEADDR, &ret, sizeof(ret)) < 0) {
        logMsg(LOG_ERR, "setsockopt() input error for connection %d\n", conn->id);
        return -2;
    }

    int optval = 1;
    if(setsockopt(conn->input, SOL_SOCKET, SO_KEEPALIVE, &optval, sizeof(optval)) < 0) {
        logMsg(LOG_ERR, "setsockopt() input error for connection %d\n", conn->id);
        return -2;
    }

    memset(&conn->input_addr, 0, sizeof(conn->input_addr));

    conn->input_addr.sin_family = AF_INET;
    conn->input_addr.sin_addr.s_addr = inet_addr(threads_data.input_address);
    conn->input_addr.sin_port = htons(threads_data.input_port);

    return 0;
}

int
init_output_sockets(proxy_server_connection_t *conn)
{
    int ret = 1;

    if ((conn->output = socket(AF_INET, SOCK_STREAM, 0)) < 0)
    {
        logMsg(LOG_ERR, "socket() output error for connection %d\n", conn->id);
        return -2;
    }

    if (setsockopt(conn->output, SOL_SOCKET, SO_REUSEADDR, &ret, sizeof(ret)) < 0) {
        logMsg(LOG_ERR, "setsockopt() output error for connection %d\n", conn->id);
        return -2;
    }

    memset(&conn->output_addr, 0, sizeof(conn->output_addr));

    conn->output_addr.sin_family = AF_INET;
    conn->output_addr.sin_addr.s_addr = inet_addr(threads_data.output_address);
    conn->output_addr.sin_port = htons(threads_data.output_port);

    return 0;
}

void*
server_input_thread (void* parameter)
{
    int conn_index = *(int*)parameter;
    proxy_server_connection_t *conn = &threads_data.connections[conn_index];
    free(parameter);
    
    restart_input_thread:;

    int len_apdu;
    conn->last_exchange_time = get_time_counter();

    logMsg(LOG_INFO, "Restart input server for connection %d\n", conn->id);

    init_input_sockets(conn);

    if (connect(conn->input, (struct sockaddr *) &conn->input_addr,
                sizeof(conn->input_addr)) < 0)
    {
        logMsg(LOG_ERR, "Input server connect error for connection %d\n", conn->id);
    } else {
        logMsg(LOG_INFO, "Connect input server for connection %d\n", conn->id);

        int flags = fcntl(conn->input , F_GETFL, 0);
        if(fcntl(conn->input, F_SETFL, flags|O_NONBLOCK) < 0) {
            logMsg(LOG_ERR, "connect fcntl error for connection %d\n", conn->id);
        }
    }

    conn->is_running_input = true;
    conn->is_starting_input = false;

    while (conn->stop_running_input == false) {

        fd_set read_set;
        FD_ZERO(&read_set);
        FD_SET(conn->input, &read_set);

        if(get_time_counter() - conn->last_exchange_time > threads_data.timeout_seconds) {
            // останавливаем внутренний порт
            conn->stop_running_output = true;
            close(conn->input);

            logMsg(LOG_INFO, "Timeout Input thread for connection %d", conn->id);

            while(conn->is_running_output) {
                Thread_sleep(10);
            }

            logMsg(LOG_INFO, "Restart by timeout Input thread for connection %d\n", conn->id);
            goto restart_input_thread;
        }

        struct timeval timeout;
        timeout.tv_sec = 1;
        timeout.tv_usec = 0;

        int select_res = select(conn->input + 1, &read_set, NULL, NULL, &timeout);

        if(select_res == -1) {
            break;
        } else if(select_res == 0) {
            continue;
        }

        if(FD_ISSET(conn->input, &read_set)) {

            if(conn->stop_running_input) break;

            len_apdu = recv(conn->input, (char *) conn->receive_input, sizeof(conn->receive_input), 0);

            logMsg(LOG_INFO, "Receive data from input port %d: length %d for connection %d\n", threads_data.input_port, len_apdu, conn->id);

            if (len_apdu <= 0) {
                if(len_apdu == 0) {
                    logMsg(LOG_INFO, "Input recv() connection closed for connection %d\n", conn->id);
                } else {
                  logMsg(LOG_ERR, "Input recv() error:: %d for connection %d\n", errno, conn->id);
                }

                // останавливаем внутренний порт
                conn->stop_running_output = true;
                close(conn->input);

                while(conn->is_running_output) {
                    Thread_sleep(10);
                }

                logMsg(LOG_INFO, "Restart Input thread for connection %d\n", conn->id);
                goto restart_input_thread;
            }

            server_output_start(conn_index);

            int remaining = len_apdu;
            int sent = 0;

            conn->last_exchange_time = get_time_counter();

            while(!conn->is_running_output) {
                Thread_sleep(10);

                if(get_time_counter() - conn->last_exchange_time > 120) {

                    logMsg(LOG_INFO, "Restart Input thread if output no started for connection %d\n", conn->id);
                    goto restart_input_thread;
                }
            }

            do {
                int result = send(conn->output,
                                (const char *)&conn->receive_input[sent],
                                len_apdu - sent, MSG_NOSIGNAL | MSG_DONTWAIT);

                logMsg(LOG_INFO, "Send data to output_port %d result %d for connection %d\n", threads_data.output_port, result, conn->id);

                if (result != -1)
                {
                    sent += result;
                    remaining -= result;
                    if (remaining <= 0)
                    {
                        break;
                    }
                }
                else
                {
                    int err = errno;
                    logMsg(LOG_INFO, "Send data to output_port %d errno %d for connection %d\n", threads_data.output_port, err, conn->id);
                    if (err == EAGAIN)
                    {
                        struct timeval tv = {};
                        fd_set fds = {};

                        tv.tv_sec = 1;
                        FD_ZERO(&fds);
                        FD_SET(conn->output, &fds);
                        select_res = select(conn->output + 1, NULL, &fds, NULL, &tv);

                        if(select_res == -1) {
                            logMsg(LOG_ERR, "Send:: select error:: %d for connection %d\n", errno, conn->id);
                            break;
                        }

                        logMsg(LOG_INFO, "Send:: wait for connection %d\n", conn->id);
                        if(!conn->is_running_output) break;
                    }
                    else
                    {
                        logMsg(LOG_INFO, "Send:: send error:: %d for connection %d\n", errno, conn->id);
                        break;
                    }
                }
            } while (conn->is_running_output);
        }

        Thread_sleep(10);
    }

    close(conn->input);

    logMsg(LOG_INFO,"Exit input server id = %d on port = %d ...\n", conn->id, threads_data.input_port);

    if(conn->stop_running_input == false) goto restart_input_thread;

    conn->is_running_input = false;

    return 0;
}

void*
server_output_thread (void* parameter)
{
    int conn_index = *(int*)parameter;
    proxy_server_connection_t *conn = &threads_data.connections[conn_index];
    free(parameter);
    
    int len_apdu;
    uint64_t last_exchange_time = get_time_counter();

    logMsg(LOG_INFO, "Start output server for connection %d\n", conn->id);

    init_output_sockets(conn);

    if (connect(conn->output, (struct sockaddr *) &conn->output_addr,
                sizeof(conn->output_addr)) < 0)
    {
        logMsg(LOG_ERR, "Output server connect error for connection %d\n", conn->id);
    } else {
        logMsg(LOG_INFO, "Connect output server for connection %d\n", conn->id);

        int flags = fcntl(conn->output , F_GETFL, 0);
        if(fcntl(conn->output, F_SETFL, flags|O_NONBLOCK) < 0) {
            logMsg(LOG_ERR, "connect fcntl error for connection %d\n", conn->id);
        }
    }

    conn->is_running_output = true;
    conn->is_starting_output = false;

    while (conn->stop_running_output == false) {

        fd_set read_set;
        FD_ZERO(&read_set);
        FD_SET(conn->output, &read_set);

        // Проверка таймаута бездействия
        if(get_time_counter() - last_exchange_time > threads_data.timeout_seconds) {
            logMsg(LOG_INFO, "Timeout Output thread for connection %d - no data exchange\n", conn->id);
            break;
        }

        struct timeval timeout;
        timeout.tv_sec = 1;
        timeout.tv_usec = 0;

        int select_res = select(conn->output + 1, &read_set, NULL, NULL, &timeout);
        if(select_res == -1) {
            break;
        } else if(select_res == 0) {
            Thread_sleep(1);
            continue;
        }

        if(FD_ISSET(conn->output, &read_set)) {
            if(conn->stop_running_output) break;

            len_apdu = recv(conn->output, (char *) conn->receive_output, sizeof(conn->receive_output), 0);

            logMsg(LOG_INFO, "Receive data from output port %d: length %d for connection %d\n", threads_data.output_port, len_apdu, conn->id);

            if (len_apdu <= 0) {
                if(len_apdu == 0) {
                    logMsg(LOG_INFO, "Output recv() connection closed for connection %d\n", conn->id);
                } else {
                  logMsg(LOG_ERR, "Output recv() error:: %d for connection %d\n", errno, conn->id);
                }
                break;
            }

            // Обновляем время последнего обмена
            last_exchange_time = get_time_counter();

            int remaining = len_apdu;
            int sent = 0;

            if(conn->stop_running_output) break;

            while(!conn->is_running_input) {
                Thread_sleep(10);
            }

            do {
                int result = send(conn->input,
                                (const char *)&conn->receive_output[sent],
                                len_apdu - sent, MSG_NOSIGNAL | MSG_DONTWAIT);

                logMsg(LOG_INFO, "Send data to input_port %d result %d for connection %d\n", threads_data.input_port, result, conn->id);

                if (result != -1)
                {
                    sent += result;
                    remaining -= result;
                    if (remaining <= 0)
                    {
                        break;
                    }
                }
                else
                {
                    int err = errno;
                    logMsg(LOG_INFO, "Send data to input_port %d errno %d for connection %d\n", threads_data.input_port, err, conn->id);
                    if (err == EAGAIN)
                    {
                        struct timeval tv = {};
                        fd_set fds = {};

                        tv.tv_sec = 1;
                        FD_ZERO(&fds);
                        FD_SET(conn->input, &fds);
                        select_res = select(conn->input + 1, NULL, &fds, NULL, &tv);

                        if(select_res == -1) {
                            logMsg(LOG_ERR, "Send:: select error:: %d for connection %d\n", errno, conn->id);
                            break;
                        }

                        logMsg(LOG_INFO, "Send:: wait for connection %d\n", conn->id);
                        if(!conn->is_running_input) break;
                    }
                    else
                    {
                        logMsg(LOG_INFO, "Send:: send error:: %d for connection %d\n", errno, conn->id);
                        break;
                    }
                }
            } while (conn->is_running_input);
        }

        Thread_sleep(10);
    }

    close(conn->output);

    logMsg(LOG_INFO,"Exit output server id = %d on port = %d ...\n", conn->id, threads_data.output_port);

    conn->is_running_output = false;
    conn->stop_running_output = false;

    return 0;
}

void
server_input_start(int conn_index)
{
    proxy_server_connection_t *conn = &threads_data.connections[conn_index];
    
    if (conn->is_running_input == false) {

        conn->is_starting_input = true;
        conn->stop_running_input = false;

        // Создаем копию индекса для передачи в поток
        int *param = malloc(sizeof(int));
        *param = conn_index;
        
        conn->input_thread = Thread_create(server_input_thread, (void *) param, false);

        Thread_start(conn->input_thread);

        while (conn->is_starting_input)
            Thread_sleep(1);
    }
}

void
server_output_start(int conn_index)
{
    proxy_server_connection_t *conn = &threads_data.connections[conn_index];
    
    if (conn->is_running_output == false) {

        conn->is_starting_output = true;
        conn->stop_running_output = false;

        // Создаем копию индекса для передачи в поток
        int *param = malloc(sizeof(int));
        *param = conn_index;
        
        conn->output_thread = Thread_create(server_output_thread, (void *) param, false);

        Thread_start(conn->output_thread);

        while (conn->is_starting_output)
            Thread_sleep(1);
    }
}

void input_server_stop(proxy_server_connection_t *conn)
{
  if (conn->is_running_input == true) {
    conn->stop_running_input = true;
  }
}

void
input_server_wait_stop(proxy_server_connection_t *conn)
{
  if (conn->is_running_input == true) {
    while (conn->is_running_input)
      Thread_sleep(1);
  }
}

bool
server_input_is_running(proxy_server_connection_t *conn)
{
    return conn->is_running_input;
}
