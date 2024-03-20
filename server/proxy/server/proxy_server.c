#include "proxy_server.h"

#include <fcntl.h>
#include <sys/time.h>

#include "db.h"
#include "logMsg.h"
#include "db_proc.h"

#include "db_func.h"

static proxy_server_t* servers;
static uint16_t servers_count;

static int32_t count_open_crypt_session = 0;
static proxy_servers_settings_t proxy_settings;

int init_input_socket(proxy_server_t * server, int direction);
int server_input_init(proxy_server_t * server);
void server_input_start(proxy_server_t * server);
bool server_input_is_running(proxy_server_t * server);
void input_server_stop(proxy_server_t * server);
void input_server_wait_stop(proxy_server_t * server);

int
servers_init()
{
    int32_t res = get_user_server_ports(1, &servers, &servers_count);

    if(res < 0) {
        logMsg(LOG_ERR, "Error reading switcher servers\n");
        exit_nicely(get_db_connection());
        return -1;
    }

    memset(proxy_settings.local_address, 0, sizeof(proxy_settings.local_address));
    strncpy(proxy_settings.local_address, "127.0.0.1", 16); // по умолчанию только локальные подключения

    for(int i = 0; i < servers_count; i++) {
        if(server_input_init(&servers[i]) < 0) {
            servers[i].is_input_enabled = false;
        } else {
            servers[i].is_input_enabled = true;
        }
    }

    return res;
}

int
switcher_servers_start()
{
    int count = 0;

    for(int i = 0; i < servers_count; i++)
    {
        if(!servers[i].isEnabled) continue;

        server_input_start(&servers[i]);
        if (!server_input_is_running(&servers[i]))
        {
            logMsg(LOG_ERR, "Starting server failed!\n");

            servers[i].isEnabled = false;
            continue;
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

  for(int i = 0; i < servers_count; i++)
  {
    if(!servers[i].isEnabled) continue;

    input_server_stop(&servers[i]);
    count++;
  }

  for(int i = 0; i < servers_count; i++)
  {
    if(!servers[i].isEnabled) continue;

    input_server_wait_stop(&servers[i]);
  }

  // ждем пока не закроются все криптосессии
  while (getCount_Open_Crypt_Session() > 0)
    Thread_sleep(1);

  logMsg(LOG_INFO, "%d servers stopped\n", count);

  return 0;
}

int
init_input_socket(proxy_server_t * server, int direction)
{
    int ret = 1;

    SOCKET * Socket = (direction == INPUT_SOCKET ? &server->input : &server->output);

    if (0 > (*(Socket) = socket(AF_INET, SOCK_STREAM, 0)))
    {
        logMsg(LOG_ERR, "socket() error\n");
        return -2;
    }

    if (0 > setsockopt(*(Socket), SOL_SOCKET, SO_REUSEADDR, &ret, sizeof(ret))) {
        return -2;
    }

    memset(&server->input_addr, 0, sizeof(server->input_addr));
    memset(&server->output_addr, 0, sizeof(server->output_addr));

    if(direction == INPUT_SOCKET) {

        in_addr_t connection_address = INADDR_ANY;

        // подключение только локальное - наружу не смотрим
        //connection_address = inet_addr(proxy_settings.local_address);
        //logMsg(LOG_INFO, "Port only local connection -> local address %s input_port %d\n", proxy_settings.local_address, server->input_port);

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
    } else {
        server->output_addr.sin_family = AF_INET;
        server->output_addr.sin_addr.s_addr = inet_addr("127.0.0.1");
        server->output_addr.sin_port = htons(server->input_port + 10000);
    }

    return 0;
}

int
server_input_init(proxy_server_t * server)
{
    server->stopRunning = false;
    server->isRunning = false;
    server->isStarting = false;

    return init_input_socket(server, INPUT_SOCKET);
}

void*
connection_handler (void* parameter)
{
    proxy_server_thread_data_t * thread_data = parameter;
    int len_epdu;
    int len_apdu;
    int done_input_connection = 0;
    int done_output_connection = 0;
    void * seance_data = NULL;

    logMsg(LOG_INFO, "Start new connection_handler on input_port %d\n", thread_data->data.input_port);

    if(init_input_socket(&thread_data->data, OUTPUT_SOCKET) < 0) {
      logMsg(LOG_ERR, "init_input_socket error\n");
      done_output_connection = 1;
    }

    if (0 > connect(thread_data->data.output, (struct sockaddr *) &thread_data->data.output_addr,
                    sizeof(thread_data->data.output_addr)))
    {
        logMsg(LOG_ERR, "Another server connect error\n");
        done_output_connection = 1;
    } else {
        logMsg(LOG_INFO, "Connect another server\n");

        int flags = fcntl(thread_data->data.output , F_GETFL, 0);
        if(fcntl(thread_data->data.output, F_SETFL, flags|O_NONBLOCK) < 0) {
            logMsg(LOG_ERR, "connect fcntl error\n");
            done_output_connection = 1;
        }
    }

    while (!done_input_connection && !done_output_connection) {
        fd_set read_set;
        FD_ZERO(&read_set);
        FD_SET(thread_data->local, &read_set);
        FD_SET(thread_data->data.output, &read_set);

        if(servers[thread_data->data.id].stopRunning)
        {
            logMsg(LOG_DEBUG,"Start disconnect on input_port %d\n", thread_data->data.input_port);
            done_output_connection = 1;
            break;
        }

        struct timeval timeout;
        timeout.tv_sec = 5;
        timeout.tv_usec = 0;

        int max = thread_data->local > thread_data->data.output ? thread_data->local + 1 : thread_data->data.output + 1;
        int select_res = select(max, &read_set, NULL, NULL, &timeout);

        if(select_res == -1) {
            break;
        } else if(select_res == 0) {
            continue;
        }

        if(FD_ISSET(thread_data->local, &read_set)) {
            len_epdu = recv(thread_data->local, (char *) thread_data->receive_epdu, sizeof(thread_data->receive_epdu),
                            0);
            logMsg(LOG_INFO, "Receive input lenght: %d\n", len_epdu);

            if (len_epdu <= 0) {
                if (EAGAIN != errno) {
                    logMsg(LOG_ERR, "Input recv() error:: %d\n", len_epdu);
                    break;
                }
                continue;
            }

            while (len_epdu > 0) {
                logMsg(LOG_INFO, "receive_crypt_data len_apdu:: %d\n", len_apdu);

                int remaining = len_apdu;
                int sent = 0;
                int success = 0;

                do {
                    int result = send(thread_data->data.output,
                                    (const char *)&thread_data->receive_apdu[sent],
                                    len_apdu - sent, MSG_NOSIGNAL | MSG_DONTWAIT);

                    logMsg(LOG_INFO, "Send data result %d\n", result);

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
                            select_res = select((SOCKET)(thread_data->data.output + 1), NULL, &fds, NULL, &tv);

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

                if(!success)
                {
                    logMsg(LOG_ERR, "send error\n");
                    done_output_connection = 1;
                    break;
                }
            }
        }

        if(FD_ISSET(thread_data->data.output, &read_set)) {
            len_apdu = recv(thread_data->data.output, (char *) thread_data->sendBuff, sizeof(thread_data->sendBuff), 0);
            if(len_apdu == 0) continue;

            logMsg(LOG_INFO, "Receive data from another server: lenght %d\n", len_apdu);

            if (len_apdu < 0) {
                if (EAGAIN != errno) {
                    logMsg(LOG_ERR, "Output recv() error:: %d\n", len_apdu);
                    done_output_connection = 1;
                    break;
                }
                continue;
            }

            logMsg(LOG_INFO, "send_crypt_data result %d\n", len_epdu);

            if (0 > len_epdu)
            {
                logMsg(LOG_ERR, "send error:: %d\n", WSAGetLastError());
                done_input_connection = 1;
                break;
            }
        }

        Thread_sleep(10);
    }

    logMsg(LOG_INFO,"Disconnect on input_port %d\n", thread_data->data.input_port);

    close(thread_data->data.output);
    close(thread_data->local);

    free(thread_data);

    count_open_crypt_session--;

    return 0;
}

void*
serverInputThread (void* parameter)
{
    proxy_server_t * server = parameter;

    if(!server->isEnabled) return 0;

    server->isRunning = true;
    server->isStarting = false;

    SOCKET socket_local;

    while (server->stopRunning == false) {

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
#ifdef _WIN32
            if (INVALID_SOCKET != (socket_local = accept(server->input, (struct sockaddr*)NULL, NULL)))
#else
            if (0 <= (socket_local = accept(server->input, (struct sockaddr *) NULL, NULL)))
#endif
            {
                int flags = fcntl(socket_local, F_GETFL, 0);
                if(fcntl(socket_local, F_SETFL, flags|O_NONBLOCK) < 0) {
                    logMsg(LOG_DEBUG, "accept fcntl ERROR\n");
                    close(socket_local);
                    continue;
                }

                logMsg(LOG_INFO, "Connection accepted on input_port %d\n", server->input_port);

                proxy_server_thread_data_t *connections_data;
                connections_data = (proxy_server_thread_data_t *) malloc(sizeof(proxy_server_thread_data_t));

                if(connections_data != NULL) {
                    logMsg(LOG_DEBUG, "Malloc connections data\n");
                    memset(connections_data, 0, sizeof(proxy_server_thread_data_t));

                    connections_data->local = socket_local;
                    memcpy(&connections_data->data, server, sizeof(proxy_server_t));

                    logMsg(LOG_DEBUG, "Start thread create\n");

                    Thread thread = Thread_create(connection_handler, (void *) connections_data, true);

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

        Thread_sleep(10);
    }

    close(server->input);

    //int value = 1;
    //setsockopt(&server->input,SOL_SOCKET,SO_REUSEADDR,&value,sizeof(int));

    logMsg(LOG_INFO,"Exit server id = %d on input_port = %d ...\n", server->id, server->input_port);

    server->isRunning = false;

    return 0;
}

void
server_input_start(proxy_server_t * server)
{
    if (server->is_input_running == false) {

        server->is_input_starting = true;
        server->stop_input_running = false;

        server->listeningInputThread = Thread_create(serverInputThread, (void *) server, false);

        Thread_start(server->listeningInputThread);

        while (server->is_input_starting)
            Thread_sleep(1);
    }
}

void input_server_stop(proxy_server_t * server)
{
  if (server->isRunning == true) {
    server->stopRunning = true;
  }
}

void
input_server_wait_stop(proxy_server_t * server)
{
  if (server->isRunning == true) {
    while (server->isRunning)
      Thread_sleep(1);
  }
}

bool
server_input_is_running(proxy_server_t * server)
{
    return server->is_input_running;
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