#include "proxy_server.h"

#include <fcntl.h>
#include <sys/time.h>

#include "db.h"
#include "logMsg.h"
#include "db_proc.h"

#include "db_func.h"
#include "time_counter.h"

static proxy_server_t* servers;
static uint16_t servers_count;

static int32_t count_open_crypt_session = 0;
static proxy_servers_settings_t proxy_settings;

int init_input_socket(proxy_server_t * server);
int init_output_socket(proxy_server_t * server);
int server_input_init(proxy_server_t * server);
int server_output_init(proxy_server_t * server);
void server_input_start(proxy_server_thread_data_t *connections_data);
void server_output_start(proxy_server_thread_data_t *connections_data);
bool server_input_is_running(proxy_server_t * server);
bool server_output_is_running(proxy_server_t * server);
void input_server_stop(proxy_server_t * server);
void input_server_wait_stop(proxy_server_t * server);

int
servers_init(uint32_t user_id)
{
    int32_t res = get_user_server_ports(user_id, &servers, &servers_count);

    if(res < 0) {
        logMsg(LOG_ERR, "Error reading switcher servers\n");
        exit_nicely(get_db_connection());
        return -1;
    }

    memset(proxy_settings.local_address, 0, sizeof(proxy_settings.local_address));
    strncpy(proxy_settings.local_address, "127.0.0.1", 16); // по умолчанию только локальные подключения

    for(int i = 0; i < servers_count; i++) {

        if(!servers[i].enable) continue;
        
        if(server_input_init(&servers[i]) < 0) {
            servers[i].is_input_enabled = false;
        } else {
            servers[i].is_input_enabled = true;
        }
        if(server_output_init(&servers[i]) < 0) {
            servers[i].is_output_enabled = false;
        } else {
            servers[i].is_output_enabled = true;
        }
    }

    return res;
}

int
server_input_init(proxy_server_t * server)
{
    server->stop_input_running = false;
    server->is_input_running = false;
    server->is_input_starting = false;
    server->close_input_socket = false;
    server->is_input_connected = false;

    return init_input_socket(server);
}

int
server_output_init(proxy_server_t * server)
{
    server->stop_output_running = false;
    server->is_output_running = false;
    server->is_output_starting = false;
    server->close_output_socket = false;
    server->is_output_connected = false;

    return init_output_socket(server);
}

int
switcher_servers_start()
{
    int count = 0;

    for(int i = 0; i < servers_count; i++)
    {
        proxy_server_thread_data_t *connections_data;
        connections_data = (proxy_server_thread_data_t *) malloc(sizeof(proxy_server_thread_data_t));
        proxy_server_t * server;

        if(connections_data != NULL) {
            logMsg(LOG_DEBUG, "Malloc connections data\n");
            memset(connections_data, 0, sizeof(proxy_server_thread_data_t));
            memcpy(&connections_data->data, &servers[i], sizeof(proxy_server_t));

            server = &connections_data->data;
        } else {
            continue;
        }

        if(!server->enable) continue;
        
        if(server->is_input_enabled)
        {
            server_input_start(connections_data);
            if (!server_input_is_running(server))
            {
                logMsg(LOG_ERR, "Starting input server failed!\n");

                server->is_input_enabled = false;
                continue;
            }
        }
        if(server->is_output_enabled)
        {
            server_output_start(connections_data);
            if (!server_output_is_running(server))
            {
                logMsg(LOG_ERR, "Starting output server failed!\n");

                server->is_output_enabled = false;
                continue;
            }
        }
        count++;
    }

    logMsg(LOG_DEBUG, "%d servers started!\n", count);

    return 0;
}

int
switcher_servers_stop()
{
  int count = 0;

  /*for(int i = 0; i < servers_count; i++)
  {
    if(!servers[i].isEnabled) continue;

    input_server_stop(&servers[i]);
    count++;
  }

  for(int i = 0; i < servers_count; i++)
  {
    if(!servers[i].isEnabled) continue;

    input_server_wait_stop(&servers[i]);
  }*/

  // ждем пока не закроются все криптосессии
  while (getCount_Open_Crypt_Session() > 0)
    Thread_sleep(1);

  logMsg(LOG_INFO, "%d servers stopped\n", count);

  return 0;
}

int
init_input_socket(proxy_server_t * server)
{
    int ret = 1;

    SOCKET * Socket = &server->input;

    if (0 > (*(Socket) = socket(AF_INET, SOCK_STREAM, 0)))
    {
        logMsg(LOG_ERR, "socket() error\n");
        return -2;
    }

    if (0 > setsockopt(*(Socket), SOL_SOCKET, SO_REUSEADDR, &ret, sizeof(ret))) {
        return -2;
    }

    memset(&server->input_addr, 0, sizeof(server->input_addr));

    in_addr_t connection_address = INADDR_ANY;

    int flags = fcntl(*(Socket) , F_GETFL, 0);
    if(fcntl(*(Socket), F_SETFL, flags|O_NONBLOCK) < 0) {
        logMsg(LOG_ERR, "fcntl() error\n");
        return -2;
    }

    server->input_addr.sin_family = AF_INET;
    server->input_addr.sin_addr.s_addr = connection_address;
    server->input_addr.sin_port = htons(server->input_port);

    if (0 > bind(*(Socket),
                (struct sockaddr*)&server->input_addr,
                sizeof(server->input_addr)))
    {
        logMsg(LOG_ERR, "bind() input_port %d error\n", server->input_port);
        return -2;
    }

    if (0 > listen(*(Socket), 10))
    {
        logMsg(LOG_ERR, "listen() error\n");
        return -2;
    }

    return 0;
}

int
init_output_socket(proxy_server_t * server)
{
    int ret = 1;

    SOCKET * Socket = &server->output;

    if (0 > (*(Socket) = socket(AF_INET, SOCK_STREAM, 0)))
    {
        logMsg(LOG_ERR, "socket() error\n");
        return -2;
    }

    if (0 > setsockopt(*(Socket), SOL_SOCKET, SO_REUSEADDR, &ret, sizeof(ret))) {
        return -2;
    }

    memset(&server->output_addr, 0, sizeof(server->output_addr));

    in_addr_t connection_address = INADDR_ANY;

    int flags = fcntl(*(Socket) , F_GETFL, 0);
    if(fcntl(*(Socket), F_SETFL, flags|O_NONBLOCK) < 0) {
        logMsg(LOG_ERR, "fcntl() error\n");
        return -2;
    }

    server->output_addr.sin_family = AF_INET;
    server->output_addr.sin_addr.s_addr = connection_address;
    server->output_addr.sin_port = htons(server->output_port);

    if (0 > bind(*(Socket),
                (struct sockaddr*)&server->output_addr,
                sizeof(server->output_addr)))
    {
        logMsg(LOG_ERR, "bind() output_port %d error\n", server->output_port);
        return -2;
    }

    if (0 > listen(*(Socket), 10))
    {
        logMsg(LOG_ERR, "listen() error\n");
        return -2;
    }

    return 0;
}

void*
connection_input_handler (void* parameter)
{
    uint64_t last_exchange_time = get_time_counter();
    proxy_server_thread_data_t * thread_data = parameter;
    int len_epdu;
    int done_output_connection = 0;
    void * seance_data = NULL;

    thread_data->data.is_input_connected = true;

    logMsg(LOG_INFO, "Start new connection_input_handler on input_port %d\n", thread_data->data.input_port);

    while (!done_output_connection) {
        fd_set read_set;
        FD_ZERO(&read_set);
        FD_SET(thread_data->input_local, &read_set);

        if(get_time_counter() - last_exchange_time > 120) {
            logMsg(LOG_DEBUG,"Start timeout disconnect on input_port %d\n", thread_data->data.input_port);
            done_output_connection = 1;
            break;
        }

        if(thread_data->data.close_input_socket)
        {
            logMsg(LOG_DEBUG,"Start disconnect on input_port %d\n", thread_data->data.input_port);
            done_output_connection = 1;
            break;
        }

        struct timeval timeout;
        timeout.tv_sec = 1;
        timeout.tv_usec = 0;

        int max = thread_data->input_local + 1;
        int select_res = select(max, &read_set, NULL, NULL, &timeout);

        if(select_res == -1) {
            break;
        } else if(select_res == 0) {
            continue;
        }

        if(FD_ISSET(thread_data->input_local, &read_set)) {
            len_epdu = recv(thread_data->input_local, (char *) thread_data->input_buf, sizeof(thread_data->input_buf),
                            0);

            logMsg(LOG_INFO, "Receive data from input port %d: lenght %d\n",thread_data->data.input_port, len_epdu);

            if (len_epdu <= 0) {
                if(len_epdu == 0) {
                    logMsg(LOG_INFO, "Input recv() connection closed\n");
                } else {
                  logMsg(LOG_ERR, "Input recv() error:: %d\n", WSAGetLastError());
                }
                break;
            }

            int remaining = len_epdu;
            int sent = 0;
            int success = 0;

            last_exchange_time = get_time_counter();

            while(thread_data->data.close_output_socket) {
                Thread_sleep(10);

                if(get_time_counter() - last_exchange_time > 120) {

                    logMsg(LOG_INFO, "Restart Input thread if output no started\n");
                    done_output_connection = 1;
                    break;
                }
            }

            while(!thread_data->data.is_output_connected) {
                Thread_sleep(10);

                if(get_time_counter() - last_exchange_time > 120) {

                    logMsg(LOG_INFO, "Restart Input thread if output no started\n");
                    done_output_connection = 1;
                    break;
                }
            }

            do {
                int result = send(thread_data->output_local,
                                (const char *)&thread_data->input_buf[sent],
                                len_epdu - sent, MSG_NOSIGNAL | MSG_DONTWAIT);

                logMsg(LOG_INFO, "Send data to port %d result %d\n", thread_data->data.output_port, result);

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
                    logMsg(LOG_INFO, "Send data to output_port %d WSAGetLastError %d\n", thread_data->data.output_port, err);
                    if (err == EAGAIN)
                    {
                        struct timeval tv = {};
                        fd_set fds = {};

                        tv.tv_sec = 1;
                        FD_ZERO(&fds);
                        FD_SET(0, &fds);
                        select_res = select((SOCKET)(thread_data->output_local + 1), NULL, &fds, NULL, &tv);

                        if(select_res == -1) {
                            logMsg(LOG_ERR, "Send:: select error:: %d", WSAGetLastError());
                            break;
                        }

                        logMsg(LOG_INFO, "Send:: wait");
                        if(!thread_data->data.is_output_connected) break;
                        if(thread_data->data.close_input_socket) break;
                    }
                    else
                    {
                        logMsg(LOG_INFO, "Send:: send error:: %d", WSAGetLastError());
                        break;
                    }
                }
            } while (remaining > 0);

            if(!success)
            {
                logMsg(LOG_ERR, "send error\n");
            }
        }

        Thread_sleep(1);
    }

    // сообщим о закрытии клиенту
    close(thread_data->input_local);
    thread_data->data.close_output_socket = true;

    thread_data->data.is_input_connected = false;

    logMsg(LOG_INFO,"Disconnect on input_port %d\n", thread_data->data.input_port);

    return 0;
}

void*
connection_output_handler (void* parameter)
{
    proxy_server_thread_data_t * thread_data = parameter;
    int len_epdu;
    int done_output_connection = 0;
    void * seance_data = NULL;

    thread_data->data.is_output_connected = true;
    logMsg(LOG_INFO, "Start new connection_output_handler on output_port %d\n", thread_data->data.output_port);

    while (!done_output_connection) {
        fd_set read_set;
        FD_ZERO(&read_set);
        FD_SET(thread_data->output_local, &read_set);

        if(thread_data->data.close_output_socket)
        {
            logMsg(LOG_DEBUG,"Start disconnect on output_port %d\n", thread_data->data.output_port);
            done_output_connection = 1;
            break;
        }

        struct timeval timeout;
        timeout.tv_sec = 1;
        timeout.tv_usec = 0;

        int max = thread_data->output_local + 1;
        int select_res = select(max, &read_set, NULL, NULL, &timeout);

        if(select_res == -1) {
            break;
        } else if(select_res == 0) {
            continue;
        }

        if(FD_ISSET(thread_data->output_local, &read_set)) {
            len_epdu = recv(thread_data->output_local, (char *) thread_data->output_buf, sizeof(thread_data->output_buf),
                            0);

            logMsg(LOG_INFO, "Receive data from output port %d: lenght %d\n",thread_data->data.output_port, len_epdu);

            if (len_epdu <= 0) {
                if(len_epdu == 0) {
                    logMsg(LOG_INFO, "Output recv() connection closed\n");
                } else {
                  logMsg(LOG_ERR, "Output recv() error:: %d\n", WSAGetLastError());
                }
                break;
            }

            int remaining = len_epdu;
            int sent = 0;
            int success = 0;

            while(!thread_data->data.is_input_connected) {
                Thread_sleep(10);

                if(thread_data->data.close_output_socket) {
                    done_output_connection = 1;
                    break;
                }
            }

            do {
                int result = send(thread_data->input_local,
                                (const char *)&thread_data->output_buf[sent],
                                len_epdu - sent, MSG_NOSIGNAL | MSG_DONTWAIT);

                logMsg(LOG_INFO, "Send data to port %d result %d\n", thread_data->data.input_port, result);

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
                    logMsg(LOG_INFO, "Send data to input_port %d WSAGetLastError %d\n", thread_data->data.input_port, err);
                    if (err == EAGAIN)
                    {
                        struct timeval tv = {};
                        fd_set fds = {};

                        tv.tv_sec = 1;
                        FD_ZERO(&fds);
                        FD_SET(0, &fds);
                        select_res = select((SOCKET)(thread_data->input_local + 1), NULL, &fds, NULL, &tv);

                        if(select_res == -1) {
                            logMsg(LOG_ERR, "Send:: input select error:: %d", WSAGetLastError());
                            break;
                        }

                        logMsg(LOG_INFO, "Send:: wait\n");
                        if(!thread_data->data.is_input_connected) break;
                        if(thread_data->data.close_output_socket) break;
                    }
                    else
                    {
                        logMsg(LOG_INFO, "Send:: send input error:: %d", WSAGetLastError());
                        break;
                    }
                }
            } while (remaining > 0);

            if(!success)
            {
                logMsg(LOG_ERR, "send input error\n");
            }
        }

        Thread_sleep(1);
    }

    // сообщим о закрытии клиенту
    close(thread_data->output_local);

    thread_data->data.is_output_connected = false;
    thread_data->data.close_output_socket = false;

    logMsg(LOG_INFO,"Disconnect on output_port %d\n", thread_data->data.output_port);

    return 0;
}

void*
serverInputThread (void* parameter)
{
    proxy_server_thread_data_t *connections_data = parameter;
    proxy_server_t * server = &connections_data->data;

    if(!server->is_input_enabled) return 0;

    server->is_input_running = true;
    server->is_input_starting = false;
    server->is_input_connected = false;

    SOCKET socket_local;

    while (server->stop_input_running == false) {
        fd_set read_set;
        FD_ZERO(&read_set);
        FD_SET(server->input, &read_set);

        struct timeval timeout;
        timeout.tv_sec = 1;
        timeout.tv_usec = 0;

        int select_res = select(server->input + 1, &read_set, NULL, NULL, &timeout);
        if(select_res == -1) {
            break;
        } else if(select_res == 0) {
            continue;
        }

        if(FD_ISSET(server->input, &read_set)) {
            if (0 <= (socket_local = accept(server->input, (struct sockaddr *) NULL, NULL)))
            {
                int flags = fcntl(socket_local, F_GETFL, 0);
                if(fcntl(socket_local, F_SETFL, flags|O_NONBLOCK) < 0) {
                    logMsg(LOG_DEBUG, "accept fcntl ERROR\n");
                    close(socket_local);
                    continue;
                }

                logMsg(LOG_INFO, "Connection accepted on input_port %d\n", server->input_port);

                if(server->is_input_connected) {
                    logMsg(LOG_INFO, "Input connection is present - close it\n");
                    close(socket_local);
                    continue;
                }

                if(connections_data != NULL) {

                    connections_data->input_local = socket_local;
                
                    logMsg(LOG_DEBUG, "Start thread create\n");

                    Thread thread = Thread_create(connection_input_handler, (void *) connections_data, true);

                    if (thread != NULL) {
                        Thread_start(thread);
                        logMsg(LOG_DEBUG, "Handler assigned\n");
                    } else {
                        logMsg(LOG_DEBUG, "Thread not create\n");
                    }
                } else {
                    logMsg(LOG_DEBUG, "Malloc ERROR\n");
                    close(socket_local);
                }
            }
        }

        Thread_sleep(1);
    }

    close(server->input);

    logMsg(LOG_INFO,"Exit server id = %d on input_port = %d ...\n", server->id, server->input_port);

    server->is_input_running = false;

    free(parameter);

    return 0;
}

void*
serverOutputThread (void* parameter)
{
    proxy_server_thread_data_t *connections_data = parameter;
    proxy_server_t * server = &connections_data->data;

    if(!server->is_output_enabled) return 0;

    server->is_output_running = true;
    server->is_output_starting = false;
    server->is_output_connected = false;

    SOCKET socket_local;

    while (server->stop_output_running == false) {
        if(!server->is_output_connected) {

            fd_set read_set;
            FD_ZERO(&read_set);
            FD_SET(server->output, &read_set);

            struct timeval timeout;
            timeout.tv_sec = 1;
            timeout.tv_usec = 0;

            int select_res = select(server->output + 1, &read_set, NULL, NULL, &timeout);
            if(select_res == -1) {
                break;
            } else if(select_res == 0) {
                continue;
            }

            if(FD_ISSET(server->output, &read_set)) {
                if (0 <= (socket_local = accept(server->output, (struct sockaddr *) NULL, NULL)))
                {
                    int flags = fcntl(socket_local, F_GETFL, 0);
                    if(fcntl(socket_local, F_SETFL, flags|O_NONBLOCK) < 0) {
                        logMsg(LOG_DEBUG, "accept fcntl ERROR\n");
                        close(socket_local);
                        continue;
                    }

                    logMsg(LOG_INFO, "Connection accepted on output_port %d\n", server->output_port);

                    if(connections_data != NULL) {
                        connections_data->output_local = socket_local;

                        logMsg(LOG_DEBUG, "Start thread create\n");

                        Thread thread = Thread_create(connection_output_handler, (void *) connections_data, true);

                        if (thread != NULL) {
                            Thread_start(thread);
                            logMsg(LOG_DEBUG, "Handler assigned\n");
                        } else {
                            logMsg(LOG_DEBUG, "Thread not create\n");
                        }
                    } else {
                        logMsg(LOG_DEBUG, "Malloc ERROR\n");
                        close(socket_local);
                    }
                }
            }
        }

        Thread_sleep(1);
    }

    close(server->output);

    logMsg(LOG_INFO,"Exit server id = %d on input_port = %d ...\n", server->id, server->output_port);

    server->is_output_running = false;

    return 0;
}

void
server_input_start(proxy_server_thread_data_t *connections_data)
{
    proxy_server_t * server = &connections_data->data;

    if (server->is_input_running == false) {

        server->is_input_starting = true;
        server->stop_input_running = false;

        server->listeningInputThread = Thread_create(serverInputThread, (void *) connections_data, false);

        Thread_start(server->listeningInputThread);

        while (server->is_input_starting)
            Thread_sleep(1);
    }
}

void
server_output_start(proxy_server_thread_data_t *connections_data)
{
    proxy_server_t * server = &connections_data->data;

    if (server->is_output_running == false) {

        server->is_output_starting = true;
        server->stop_output_running = false;

        server->listeningOutputThread = Thread_create(serverOutputThread, (void *) connections_data, false);

        Thread_start(server->listeningOutputThread);

        while (server->is_output_starting)
            Thread_sleep(1);
    }
}

void input_server_stop(proxy_server_t * server)
{
  /*if (server->isRunning == true) {
    server->stopRunning = true;
  }*/
}

void
input_server_wait_stop(proxy_server_t * server)
{
  /*if (server->isRunning == true) {
    while (server->isRunning)
      Thread_sleep(1);
  }*/
}

bool
server_input_is_running(proxy_server_t * server)
{
    return server->is_input_running;
}

bool
server_output_is_running(proxy_server_t * server)
{
    return server->is_output_running;
}

int
getCountCryptServers()
{
   return servers_count;
}

uint32_t getCount_Open_Crypt_Session()
{
  return count_open_crypt_session;
}