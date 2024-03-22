#include "proxy_client.h"

#include <fcntl.h>
#include <sys/time.h>

#include "logMsg.h"

static proxy_servers_settings_t proxy_settings;
static proxy_server_thread_data_t threads_data;

int init_sockets();

void server_input_start();
void server_output_start();

bool server_input_is_running(proxy_server_t * server);
void input_server_stop(proxy_server_t * server);
void input_server_wait_stop(proxy_server_t * server);

proxy_server_t* get_client_settings()
{
    return &threads_data.data;
}

int
servers_init()
{
    int32_t res = 0;

    if(res < 0) {
        logMsg(LOG_ERR, "Error reading switcher servers\n");
        return -1;
    }

    memset(proxy_settings.local_address, 0, sizeof(proxy_settings.local_address));
    strncpy(proxy_settings.local_address, "127.0.0.1", 16); // по умолчанию только локальные подключения

    init_sockets();

    return res;
}

int
switcher_servers_start()
{
    server_input_start();

    logMsg(LOG_DEBUG, "Clients started!\n");

    return 0;
}

int
switcher_servers_stop()
{
  return 0;
}

int
init_sockets()
{
    int ret = 1;

    SOCKET * socket_in = &threads_data.data.input;
    SOCKET * socket_out = &threads_data.data.output;

    if (0 > (*(socket_in) = socket(AF_INET, SOCK_STREAM, 0)))
    {
        logMsg(LOG_ERR, "socket() input error\n");
        return -2;
    }

    if (0 > setsockopt(*(socket_in), SOL_SOCKET, SO_REUSEADDR, &ret, sizeof(ret))) {
        logMsg(LOG_ERR, "setsockopt() input error\n");
        return -2;
    }

    if (0 > (*(socket_out) = socket(AF_INET, SOCK_STREAM, 0)))
    {
        logMsg(LOG_ERR, "socket() output error\n");
        return -2;
    }

    if (0 > setsockopt(*(socket_out), SOL_SOCKET, SO_REUSEADDR, &ret, sizeof(ret))) {
        logMsg(LOG_ERR, "setsockopt() output error\n");
        return -2;
    }

    memset(&threads_data.data.input_addr, 0, sizeof(threads_data.data.input_addr));
    memset(&threads_data.data.output_addr, 0, sizeof(threads_data.data.output_addr));

    threads_data.data.input_addr.sin_family = AF_INET;
    threads_data.data.input_addr.sin_addr.s_addr = inet_addr(threads_data.data.input_address);
    threads_data.data.input_addr.sin_port = htons(threads_data.data.input_port);

    threads_data.data.output_addr.sin_family = AF_INET;
    threads_data.data.output_addr.sin_addr.s_addr = inet_addr(threads_data.data.output_address);
    threads_data.data.output_addr.sin_port = htons(threads_data.data.output_port);

    return 0;
}

void*
server_input_thread (void* parameter)
{
    int len_apdu;

    if (0 > connect(threads_data.data.input, (struct sockaddr *) &threads_data.data.input_addr,
                    sizeof(threads_data.data.input_addr)))
    {
        logMsg(LOG_ERR, "Input server connect error\n");
    } else {
        logMsg(LOG_INFO, "Connect input server\n");

        int flags = fcntl(threads_data.data.input , F_GETFL, 0);
        if(fcntl(threads_data.data.input, F_SETFL, flags|O_NONBLOCK) < 0) {
            logMsg(LOG_ERR, "connect fcntl error\n");
        }
    }

    threads_data.data.is_running_input = true;
    threads_data.data.is_starting_input = false;

    while (threads_data.data.stop_running_input == false) {

        fd_set read_set;
        FD_ZERO(&read_set);
        FD_SET(threads_data.data.input, &read_set);

        struct timeval timeout;
        timeout.tv_sec = 1;
        timeout.tv_usec = 0;

        int select_res = select(threads_data.data.input + 1, &read_set, NULL, NULL, &timeout);
        if(select_res == -1) {
            break;
        } else if(select_res == 0) {
            continue;
        }

        if(FD_ISSET(threads_data.data.input, &read_set)) {

            server_output_start();

            len_apdu = recv(threads_data.data.input, (char *) threads_data.receive_input, sizeof(threads_data.receive_input), 0);
            if(len_apdu == 0) continue;

            logMsg(LOG_INFO, "Receive data from input port %d: lenght %d\n",threads_data.data.input_port, len_apdu);

            if (len_apdu < 0) {
                if (EAGAIN != errno) {
                    logMsg(LOG_ERR, "Output input recv() error:: %d\n", len_apdu);
                    break;
                }
                continue;
            }

            int remaining = len_apdu;
            int sent = 0;
            int success = 0;

            do {
                int result = send(threads_data.data.output,
                                (const char *)&threads_data.receive_input[sent],
                                len_apdu - sent, MSG_NOSIGNAL | MSG_DONTWAIT);

                logMsg(LOG_INFO, "Send data to port %d result %d\n", threads_data.data.output_port, result);

                if (result != -1)
                {
                    sent += result;
                    remaining -= result;
                    if (remaining <= 0)
                    {
                        success = 1;
                        break;
                    }
                }
                else
                {
                    int err = WSAGetLastError();
                    if (err == EAGAIN)
                    {
                        struct timeval tv = {};
                        fd_set fds = {};

                        tv.tv_sec = 1;
                        FD_ZERO(&fds);
                        FD_SET(0, &fds);
                        select_res = select((SOCKET)(threads_data.data.output + 1), NULL, &fds, NULL, &tv);

                        if(select_res == -1) {
                            logMsg(LOG_ERR, "Send:: select error:: %d\n", WSAGetLastError());
                            break;
                        }

                        logMsg(LOG_INFO, "Send:: wait\n");
                    }
                    else
                    {
                        logMsg(LOG_INFO, "Send:: send error:: %d\n", WSAGetLastError());
                        break;
                    }
                }
            } while (remaining > 0);
        }

        Thread_sleep(10);
    }

    close(threads_data.data.input);

    logMsg(LOG_INFO,"Exit server id = %d on port = %d ...\n", threads_data.data.id, threads_data.data.input_port);

    threads_data.data.is_running_input = false;

    return 0;
}

void*
server_output_thread (void* parameter)
{
    int len_apdu;

    if (0 > connect(threads_data.data.output, (struct sockaddr *) &threads_data.data.output_addr,
                    sizeof(threads_data.data.output_addr)))
    {
        logMsg(LOG_ERR, "Output server connect error\n");
    } else {
        logMsg(LOG_INFO, "Connect output server\n");

        int flags = fcntl(threads_data.data.output , F_GETFL, 0);
        if(fcntl(threads_data.data.output, F_SETFL, flags|O_NONBLOCK) < 0) {
            logMsg(LOG_ERR, "connect fcntl error\n");
        }
    }

    threads_data.data.is_running_output = true;
    threads_data.data.is_starting_output = false;

    while (threads_data.data.stop_running_output == false) {

        fd_set read_set;
        FD_ZERO(&read_set);
        FD_SET(threads_data.data.output, &read_set);

        struct timeval timeout;
        timeout.tv_sec = 1;
        timeout.tv_usec = 0;

        int select_res = select(threads_data.data.output + 1, &read_set, NULL, NULL, &timeout);
        if(select_res == -1) {
            break;
        } else if(select_res == 0) {
            continue;
        }

        if(FD_ISSET(threads_data.data.output, &read_set)) {
            len_apdu = recv(threads_data.data.output, (char *) threads_data.receive_output, sizeof(threads_data.receive_output), 0);
            if(len_apdu == 0) continue;

            logMsg(LOG_INFO, "Receive data from output port %d: lenght %d\n",threads_data.data.output_port, len_apdu);

            if (len_apdu < 0) {
                if (EAGAIN != errno) {
                    logMsg(LOG_ERR, "Output recv() error:: %d\n", len_apdu);
                    break;
                }
                continue;
            }

            int remaining = len_apdu;
            int sent = 0;
            int success = 0;

            do {
                int result = send(threads_data.data.input,
                                (const char *)&threads_data.receive_output[sent],
                                len_apdu - sent, MSG_NOSIGNAL | MSG_DONTWAIT);

                logMsg(LOG_INFO, "Send data to port %d result %d\n", threads_data.data.input_port, result);

                if (result != -1)
                {
                    sent += result;
                    remaining -= result;
                    if (remaining <= 0)
                    {
                        success = 1;
                        break;
                    }
                }
                else
                {
                    int err = WSAGetLastError();
                    if (err == EAGAIN)
                    {
                        struct timeval tv = {};
                        fd_set fds = {};

                        tv.tv_sec = 1;
                        FD_ZERO(&fds);
                        FD_SET(0, &fds);
                        select_res = select((SOCKET)(threads_data.data.input + 1), NULL, &fds, NULL, &tv);

                        if(select_res == -1) {
                            logMsg(LOG_ERR, "Send:: select error:: %d\n", WSAGetLastError());
                            break;
                        }

                        logMsg(LOG_INFO, "Send:: wait\n");
                    }
                    else
                    {
                        logMsg(LOG_INFO, "Send:: send error:: %d\n", WSAGetLastError());
                        break;
                    }
                }
            } while (remaining > 0);
        }

        Thread_sleep(10);
    }

    close(threads_data.data.input);

    logMsg(LOG_INFO,"Exit server id = %d on port = %d ...\n", threads_data.data.id, threads_data.data.output_port);

    threads_data.data.is_running_output = false;

    return 0;
}

void
server_input_start()
{
    if (threads_data.data.is_running_input == false) {

        threads_data.data.is_starting_input = true;
        threads_data.data.stop_running_input = false;

        threads_data.data.input_thread = Thread_create(server_input_thread, (void *) &threads_data.data, false);

        Thread_start(threads_data.data.input_thread);

        while (threads_data.data.is_starting_input)
            Thread_sleep(1);
    }
}

void
server_output_start()
{
    if (threads_data.data.is_running_output == false) {

        threads_data.data.is_starting_input = true;
        threads_data.data.stop_running_input = false;

        threads_data.data.input_thread = Thread_create(server_output_thread, (void *) &threads_data.data, false);

        Thread_start(threads_data.data.input_thread);

        while (threads_data.data.is_starting_output)
            Thread_sleep(1);
    }
}

void input_server_stop(proxy_server_t * server)
{
  if (server->is_running_input == true) {
    server->stop_running_input = true;
  }
}

void
input_server_wait_stop(proxy_server_t * server)
{
  if (server->is_running_input == true) {
    while (server->is_running_input)
      Thread_sleep(1);
  }
}

bool
server_input_is_running(proxy_server_t * server)
{
    return server->is_running_input;
}
