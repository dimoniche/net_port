#include "proxy_server.h"

#include <fcntl.h>
#include <sys/time.h>
#include <stdlib.h>
#include <semaphore.h>
#include <openssl/ssl.h>
#include <openssl/err.h>

#include "db.h"
#include "logMsg.h"
#include "db_proc.h"

#include "db_func.h"
#include "time_counter.h"
#include "device_manager.h"

#define MAX_DYNAMIC_SERVER_RUNTIMES 256

typedef struct dynamic_server_runtime_s {
    char device_id[DEVICE_ID_MAX_LEN + 1];
    uint16_t input_port;
    uint16_t tunnel_port;
    int server_index;
    proxy_server_thread_data_t *connections_data;
    bool active;
} dynamic_server_runtime_t;

// Глобальное определение переменной количества потоков
int COUNT_SOCKET_THREAD = 25;

static proxy_server_t* servers;
static uint16_t servers_count;
static int32_t count_open_crypt_session = 0;
static proxy_servers_settings_t proxy_settings;
static dynamic_server_runtime_t g_dynamic_runtimes[MAX_DYNAMIC_SERVER_RUNTIMES];
static pthread_mutex_t g_dynamic_runtimes_mutex = PTHREAD_MUTEX_INITIALIZER;

static void init_proxy_bind_address(void)
{
    memset(proxy_settings.local_address, 0, sizeof(proxy_settings.local_address));

    const char *bind_addr = getenv("NET_PORT_BIND_ADDRESS");
    if (bind_addr && bind_addr[0]) {
        strncpy(proxy_settings.local_address, bind_addr, sizeof(proxy_settings.local_address) - 1);
        proxy_settings.local_address[sizeof(proxy_settings.local_address) - 1] = '\0';
    } else {
        strncpy(proxy_settings.local_address, "127.0.0.1", sizeof(proxy_settings.local_address) - 1);
    }

    logMsg(LOG_INFO, "Proxy bind address: %s\n", proxy_settings.local_address);
}

// Семафор для защиты доступа к статистике серверов
sem_t statistics_semaphore;

// Функция для поиска индекса сервера в массиве по его ID
int find_server_index_by_id(uint16_t server_id) {
    for (int i = 0; i < servers_count; i++) {
        if (servers[i].id == server_id) {
            return i;
        }
    }
    return -1; // Сервер с таким ID не найден
}

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
int get_free_input_socket(proxy_server_thread_data_t * data);
int get_input_socket_with_output(proxy_server_thread_data_t * data);
int get_free_output_socket(proxy_server_thread_data_t * data);
static int start_server_listening_threads(proxy_server_t *server, proxy_server_thread_data_t **runtime_out);
static void register_dynamic_server_runtime(const char *device_id, uint16_t input_port,
                                            uint16_t tunnel_port, int server_index,
                                            proxy_server_thread_data_t *connections_data);
static void stop_dynamic_server_runtime(proxy_server_thread_data_t *connections_data, int server_index,
                                        const char *device_id);
static void apply_dynamic_server_ssl_config(proxy_server_t *server, bool enable_input_ssl,
                                            bool enable_tunnel_ssl);
static int start_dynamic_server_at_index(int index, const char *device_id,
                                         uint16_t input_port, uint16_t tunnel_port,
                                         bool enable_input_ssl, bool enable_tunnel_ssl);
static bool dynamic_runtime_ssl_matches(const proxy_server_t *runtime, bool enable_input_ssl,
                                        bool enable_tunnel_ssl);

// Функция для периодического сохранения статистики
void* statistics_saver_thread(void* arg) {
    // Выполняем очистку устаревших данных при первом запуске
    cleanup_old_statistics(proxy_settings.statistics_retention_period);
    
    while(1) {
        Thread_sleep(60000); // Сохраняем статистику каждую минуту
        
        for(int i = 0; i < servers_count; i++) {
            if(servers[i].enable) {
                save_server_statistics(&servers[i]);
            }
        }
        
        // Выполняем очистку устаревших данных раз в час (каждые 60 итераций)
        static int cleanup_counter = 0;
        cleanup_counter++;
        if (cleanup_counter >= 60) {
            cleanup_old_statistics(proxy_settings.statistics_retention_period);
            cleanup_counter = 0;
        }
    }
    return NULL;
}

int
servers_init(uint32_t user_id, const char* cert_file, const char* key_file, time_t statistics_retention_period)
{
    int32_t res = get_user_server_ports(user_id, &servers, &servers_count);

    if(res < 0) {
        logMsg(LOG_ERR, "Error reading switcher servers\n");
        exit_nicely(get_db_connection());
        return -1;
    }

    if (servers_count == 0) {
        logMsg(LOG_INFO, "Starting without legacy switcher servers (device management mode)\n");
    }

    init_proxy_bind_address();
    proxy_settings.statistics_retention_period = statistics_retention_period;

    // Инициализация семафора для защиты статистики
    if (sem_init(&statistics_semaphore, 0, 1) != 0) {
        logMsg(LOG_ERR, "Failed to initialize statistics semaphore\n");
        exit_nicely(get_db_connection());
        return -1;
    }

    // Инициализация OpenSSL перед созданием SSL контекстов
    init_openssl();

    for(int i = 0; i < servers_count; i++)
    {

        if(!servers[i].enable) continue;

        // Сохраняем пути к сертификатам для каждого сервера
        if (cert_file) {
            strncpy(servers[i].cert_file, cert_file, sizeof(servers[i].cert_file) - 1);
            servers[i].cert_file[sizeof(servers[i].cert_file) - 1] = '\0';
        } else {
            servers[i].cert_file[0] = '\0';
        }
        
        if (key_file) {
            strncpy(servers[i].key_file, key_file, sizeof(servers[i].key_file) - 1);
            servers[i].key_file[sizeof(servers[i].key_file) - 1] = '\0';
        } else {
            servers[i].key_file[0] = '\0';
        }

        // Инициализация SSL если нужно
        init_ssl_context(&servers[i]);
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

// Инициализация одного сервера без использования БД (используется для режимов --no-db)
int servers_init_no_db(const char* cert_file, const char* key_file, uint16_t input_port, uint16_t output_port, bool enable_output_ssl, bool enable_input_ssl, time_t statistics_retention_period) {
    // Инициализируем OpenSSL перед созданием SSL контекстов
    init_openssl();

    // Освободим предыдущие контексты при повторном вызове
    if (servers) {
        for (int i = 0; i < servers_count; i++) {
            cleanup_ssl_context(&servers[i]);
        }
        free(servers);
        servers = NULL;
        servers_count = 0;
    }

    servers_count = 1;
    servers = (proxy_server_t*) malloc(sizeof(proxy_server_t) * servers_count);
    if (!servers) {
        logMsg(LOG_ERR, "Failed to allocate memory for servers (no-db mode)\n");
        return -1;
    }

    memset(servers, 0, sizeof(proxy_server_t) * servers_count);

    // Инициализация семафора для защиты статистики
    if (sem_init(&statistics_semaphore, 0, 1) != 0) {
        logMsg(LOG_ERR, "Failed to initialize statistics semaphore\n");
        free(servers);
        servers = NULL;
        servers_count = 0;
        return -1;
    }
    
    proxy_settings.statistics_retention_period = statistics_retention_period;
    init_proxy_bind_address();

    servers[0].id = 0;
    servers[0].enable = true;
    servers[0].input_port = input_port;
    servers[0].output_port = output_port;
    servers[0].is_input_enabled = true;
    servers[0].is_output_enabled = true;
    servers[0].enable_output_ssl = enable_output_ssl;
    servers[0].enable_input_ssl = enable_input_ssl;

    // Инициализируем статистику
    servers[0].statistics.bytes_received = 0;
    servers[0].statistics.bytes_sent = 0;
    servers[0].statistics.connections_count = 0;
    servers[0].statistics.last_update = time(NULL);

    if (cert_file) {
        strncpy(servers[0].cert_file, cert_file, sizeof(servers[0].cert_file)-1);
        servers[0].cert_file[sizeof(servers[0].cert_file)-1] = '\0';
    }
    if (key_file) {
        strncpy(servers[0].key_file, key_file, sizeof(servers[0].key_file)-1);
        servers[0].key_file[sizeof(servers[0].key_file)-1] = '\0';
    }

    // Инициализируем SSL контекст если требуется
    init_ssl_context(&servers[0]);

    // Инициализация сокетов
    if (server_input_init(&servers[0]) < 0) {
        servers[0].is_input_enabled = false;
    } else {
        servers[0].is_input_enabled = true;
    }
    if (server_output_init(&servers[0]) < 0) {
        servers[0].is_output_enabled = false;
    } else {
        servers[0].is_output_enabled = true;
    }

    logMsg(LOG_INFO, "Initialized single server without DB: input_port=%d output_port=%d enable_output_ssl=%d enable_input_ssl=%d\n",
           input_port, output_port, enable_output_ssl, enable_input_ssl);

    return 0;
}

int
server_input_init(proxy_server_t * server)
{
    server->stop_input_running = false;
    server->is_input_running = false;
    server->is_input_starting = false;

    return init_input_socket(server);
}

int
server_output_init(proxy_server_t * server)
{
    server->stop_output_running = false;
    server->is_output_running = false;
    server->is_output_starting = false;

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
            
            // Выделяем память для массива local_sockets
            connections_data->local_sockets = (proxy_server_local_socket_data_t *) malloc(COUNT_SOCKET_THREAD * sizeof(proxy_server_local_socket_data_t));
            if(connections_data->local_sockets == NULL) {
                logMsg(LOG_ERR, "Failed to allocate memory for local_sockets\n");
                free(connections_data);
                continue;
            }
            memset(connections_data->local_sockets, 0, COUNT_SOCKET_THREAD * sizeof(proxy_server_local_socket_data_t));
            
            // Копируем данные сервера, кроме SSL контекста
            memcpy(&connections_data->data, &servers[i], sizeof(proxy_server_t));
            
            // Восстанавливаем указатель на оригинальный SSL контекст
            connections_data->data.ssl_ctx = servers[i].ssl_ctx;

            server = &connections_data->data;
        } else {
            continue;
        }

        if(!server->enable) continue;

        // инициализируем настройки сервера в каждый поток
        for(int i = 0; i < COUNT_SOCKET_THREAD; i++) {
            connections_data->local_sockets[i].data = &connections_data->data;

            connections_data->local_sockets[i].is_input_connected = false;
            connections_data->local_sockets[i].is_output_connected = false;
            connections_data->local_sockets[i].close_output_socket = false;
        }

        if(server->is_input_enabled)
        {
            server_input_start(connections_data);
            if (!server_input_is_running(server))
            {
                logMsg(LOG_ERR, "Starting input server failed!\n");

                server->is_input_enabled = false;
                if(connections_data->local_sockets) free(connections_data->local_sockets);
                free(connections_data);
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
                if(connections_data->local_sockets) free(connections_data->local_sockets);
                free(connections_data);
                continue;
            }
        }
        count++;
    }

    logMsg(LOG_DEBUG, "%d servers started!\n", count);

    return 0;
}

// Очистка SSL контекста при остановке сервера
void cleanup_ssl_context(proxy_server_t *server) {
    if (server->ssl_ctx) {
        SSL_CTX_free(server->ssl_ctx);
        server->ssl_ctx = NULL;
    }
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

  // Очистка SSL контекстов для всех серверов
  for(int i = 0; i < servers_count; i++)
  {
      cleanup_ssl_context(&servers[i]);
  }

  // Очистка OpenSSL
  cleanup_openssl();

  // Уничтожаем семафор
  sem_destroy(&statistics_semaphore);

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
    if (!server->is_dynamic_port && proxy_settings.local_address[0] != '\0') {
        in_addr_t addr = inet_addr(proxy_settings.local_address);
        if (addr != INADDR_NONE) {
            connection_address = addr;
        }
    }

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
    if (!server->is_dynamic_port && proxy_settings.local_address[0] != '\0') {
        in_addr_t addr = inet_addr(proxy_settings.local_address);
        if (addr != INADDR_NONE) {
            connection_address = addr;
        }
    }

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
    proxy_server_local_socket_data_t * thread_data = parameter;
    int len_epdu;
    int done_output_connection = 0;
    void * seance_data = NULL;

    thread_data->is_input_connected = true;

    logMsg(LOG_INFO, "Start new connection_input_handler on input_port %d\n", thread_data->data->input_port);

    // Инициализация SSL если нужно
    if (thread_data->data->enable_input_ssl) {
        if (!thread_data->data->ssl_ctx) {
            logMsg(LOG_ERR, "SSL context is not initialized on input_port %d\n", thread_data->data->input_port);
            close(thread_data->input_local);
            thread_data->is_input_connected = false;
            return 0;
        }
        thread_data->ssl_input = SSL_new(thread_data->data->ssl_ctx);
        if (!thread_data->ssl_input) {
            logMsg(LOG_ERR, "Failed to create SSL object on input_port %d\n", thread_data->data->input_port);
            // Выводим детальную информацию об ошибке OpenSSL
            unsigned long ssl_err;
            while ((ssl_err = ERR_get_error()) != 0) {
                char err_buf[256];
                ERR_error_string_n(ssl_err, err_buf, sizeof(err_buf));
                logMsg(LOG_ERR, "SSL error: %s\n", err_buf);
            }
            close(thread_data->input_local);
            thread_data->is_input_connected = false;
            return 0;
        }

        SSL_set_fd(thread_data->ssl_input, thread_data->input_local);

        /*
         * Ensure the socket is blocking during the TLS handshake.
         * The accept() earlier sets the accepted socket to non-blocking which
         * can cause SSL_accept() to return with WANT_READ/WANT_WRITE and be
         * treated as a fatal error here. Temporarily clear O_NONBLOCK, perform
         * the handshake, then restore the original flags (including non-blocking).
         */
        int sock_flags = fcntl(thread_data->input_local, F_GETFL, 0);
        if (sock_flags >= 0) {
            fcntl(thread_data->input_local, F_SETFL, sock_flags & ~O_NONBLOCK);
        }

        int ssl_ret = SSL_accept(thread_data->ssl_input);

        /* restore original flags (re-enable non-blocking if it was set) */
        if (sock_flags >= 0) {
            fcntl(thread_data->input_local, F_SETFL, sock_flags);
        }

        if (ssl_ret != 1) {
            logMsg(LOG_ERR, "SSL handshake failed on input_port %d with result %d\n", thread_data->data->input_port, ssl_ret);

            // Получаем код ошибки SSL
            int ssl_err = SSL_get_error(thread_data->ssl_input, ssl_ret);
            logMsg(LOG_ERR, "SSL accept error code: %d\n", ssl_err);

            /* Log detailed OpenSSL errors */
            unsigned long err;
            while ((err = ERR_get_error()) != 0) {
                char err_str[256];
                ERR_error_string_n(err, err_str, sizeof(err_str));
                logMsg(LOG_ERR, "SSL error: %s\n", err_str);
            }

            // Освобождаем SSL объект и закрываем сокет
            if (thread_data->ssl_input) {
                SSL_free(thread_data->ssl_input);
                thread_data->ssl_input = NULL;
            }
            if (thread_data->input_local != -1) {
                close(thread_data->input_local);
                thread_data->input_local = -1;
            }
            thread_data->is_input_connected = false;
            return 0;
        }
        logMsg(LOG_INFO, "SSL connection established on input_port %d\n", thread_data->data->input_port);
    }

    // Обновляем статистику - увеличиваем количество соединений
    if (!thread_data->data->is_dynamic_port) {
        thread_data->data->statistics.connections_count++;

        // Защищаем доступ к статистике семафором
        sem_wait(&statistics_semaphore);
        {
            int stats_server_index = find_server_index_by_id(thread_data->data->id);
            if (stats_server_index >= 0) {
                memcpy(&servers[stats_server_index].statistics, &thread_data->data->statistics, sizeof(proxy_server_statistics_t));
            }
        }
        sem_post(&statistics_semaphore);
    }

    while (!done_output_connection) {
        fd_set read_set;
        FD_ZERO(&read_set);
        FD_SET(thread_data->input_local, &read_set);

        /*if(get_time_counter() - last_exchange_time > RESTART_CONNECTION_TIMEOUT) {
            logMsg(LOG_DEBUG,"Start timeout disconnect on input_port %d\n", thread_data->data->input_port);
            done_output_connection = 1;
            break;
        }*/

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
            if (thread_data->data->enable_input_ssl) {
                len_epdu = SSL_read(thread_data->ssl_input, (char *) thread_data->input_buf, sizeof(thread_data->input_buf));

                if (len_epdu <= 0) {
                    int ssl_err = SSL_get_error(thread_data->ssl_input, len_epdu);
                    if (ssl_err == SSL_ERROR_WANT_READ || ssl_err == SSL_ERROR_WANT_WRITE) {
                        /* Non-blocking socket wants more data; skip this cycle */
                        Thread_sleep(1);
                        continue;
                    } else if (ssl_err == SSL_ERROR_ZERO_RETURN) {
                        logMsg(LOG_INFO, "Input SSL connection closed\n");
                        break;
                    } else {
                        logMsg(LOG_ERR, "Input SSL error %d\n", ssl_err);
                        // Добавляем более детальную информацию об ошибке
                        logMsg(LOG_ERR, "SSL_read returned %d, SSL_get_error returned %d\n", len_epdu, ssl_err);
                        unsigned long e;
                        while ((e = ERR_get_error()) != 0) {
                            char err_str[256];
                            ERR_error_string_n(e, err_str, sizeof(err_str));
                            logMsg(LOG_ERR, "SSL error: %s\n", err_str);
                        }
                        // Освобождаем SSL объект и закрываем сокет, завершаем соединение
                        if (thread_data->ssl_input) {
                            SSL_free(thread_data->ssl_input);
                            thread_data->ssl_input = NULL;
                        }
                        if (thread_data->input_local != -1) {
                            close(thread_data->input_local);
                            thread_data->input_local = -1;
                        }
                        break;
                    }
                }
            } else {
                len_epdu = recv(thread_data->input_local, (char *) thread_data->input_buf, sizeof(thread_data->input_buf), 0);

                if (len_epdu <= 0) {
                    if(len_epdu == 0) {
                        logMsg(LOG_INFO, "Input recv() connection closed\n");
                    } else {
                      logMsg(LOG_ERR, "Input recv() error:: %d\n", WSAGetLastError());
                    }
                    break;
                }
            }

            logMsg(LOG_INFO, "Receive data from input port %d: lenght %d\n",thread_data->data->input_port, len_epdu);

            // Обновляем статистику - байты получены
            update_server_statistics(servers, thread_data->data, len_epdu, 0);

            int remaining = len_epdu;
            int sent = 0;
            int success = 0;

            last_exchange_time = get_time_counter();

            while(thread_data->close_output_socket) {
                Thread_sleep(10);

                if(get_time_counter() - last_exchange_time > 120) {

                    logMsg(LOG_INFO, "Restart Input thread if output no started\n");
                    done_output_connection = 1;
                    break;
                }
            }

            while(!thread_data->is_output_connected) {
                Thread_sleep(10);

                if(get_time_counter() - last_exchange_time > 120) {

                    logMsg(LOG_INFO, "Restart Input thread if output no started\n");
                    done_output_connection = 1;
                    break;
                }
            }

            do {
                int result;
                if (thread_data->data->enable_output_ssl) {
                    if (!thread_data->ssl_output) {
                        logMsg(LOG_ERR, "SSL output object is NULL on port %d\n", thread_data->data->output_port);
                        break;
                    }
                    result = SSL_write(thread_data->ssl_output, (const char *)&thread_data->input_buf[sent], len_epdu - sent);
                    
                    if (result <= 0) {
                        int ssl_err = SSL_get_error(thread_data->ssl_output, result);
                        if (ssl_err != SSL_ERROR_WANT_READ && ssl_err != SSL_ERROR_WANT_WRITE) {
                            logMsg(LOG_ERR, "SSL write error %d on output port %d\n", ssl_err, thread_data->data->output_port);
                            // Добавляем более детальную информацию об ошибке
                            logMsg(LOG_ERR, "SSL_write returned %d, SSL_get_error returned %d\n", result, ssl_err);
                            unsigned long e;
                            while ((e = ERR_get_error()) != 0) {
                                char err_str[256];
                                ERR_error_string_n(e, err_str, sizeof(err_str));
                                logMsg(LOG_ERR, "SSL error: %s\n", err_str);
                            }
                            // Освобождаем SSL объект
                            if (thread_data->ssl_output) {
                                SSL_free(thread_data->ssl_output);
                                thread_data->ssl_output = NULL;
                            }
                        }
                    }
                } else {
                    result = send(thread_data->output_local,
                                (const char *)&thread_data->input_buf[sent],
                                len_epdu - sent, MSG_NOSIGNAL | MSG_DONTWAIT);
                }

                logMsg(LOG_INFO, "Send output data to port %d result %d\n", thread_data->data->output_port, result);

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
                    logMsg(LOG_INFO, "Send data to output_port %d WSAGetLastError %d\n", thread_data->data->output_port, err);
                    if (err == EAGAIN)
                    {
                        struct timeval tv = {};
                        fd_set fds = {};

                        tv.tv_sec = 1;
                        FD_ZERO(&fds);
                        FD_SET(thread_data->output_local, &fds);
                        select_res = select((SOCKET)(thread_data->output_local + 1), NULL, &fds, NULL, &tv);

                        if(select_res == -1) {
                            logMsg(LOG_ERR, "Send to output:: select error:: %d", WSAGetLastError());
                            break;
                        }

                        logMsg(LOG_INFO, "Send to output:: wait");
                        if(!thread_data->is_output_connected) break;
                    }
                    else
                    {
                        logMsg(LOG_INFO, "Send to output:: send error:: %d", WSAGetLastError());
                        break;
                    }
                }
            } while (remaining > 0);

            if(!success)
            {
                logMsg(LOG_ERR, "send output error\n");
            }
        }

        Thread_sleep(1);
    }

    // сообщим о закрытии клиенту
    // Освобождаем SSL объект если он был создан
    if (thread_data->ssl_input) {
        SSL_free(thread_data->ssl_input);
        thread_data->ssl_input = NULL;
    }

    if (thread_data->input_local != -1) {
        close(thread_data->input_local);
        thread_data->input_local = -1;
    }
    thread_data->close_output_socket = true;

    thread_data->is_input_connected = false;

    // Обновляем статистику - уменьшаем количество соединений
    if (!thread_data->data->is_dynamic_port) {
        thread_data->data->statistics.connections_count--;

        // Защищаем доступ к статистике семафором
        sem_wait(&statistics_semaphore);
        {
            int stats_server_index = find_server_index_by_id(thread_data->data->id);
            if (stats_server_index >= 0) {
                memcpy(&servers[stats_server_index].statistics, &thread_data->data->statistics, sizeof(proxy_server_statistics_t));
            }
        }
        sem_post(&statistics_semaphore);
    }

    logMsg(LOG_INFO,"Disconnect on input_port %d\n", thread_data->data->input_port);

    return 0;
}

void*
connection_output_handler (void* parameter)
{
    proxy_server_local_socket_data_t * thread_data = parameter;
    int len_epdu;
    int done_output_connection = 0;
    void * seance_data = NULL;

    thread_data->is_output_connected = true;
    logMsg(LOG_INFO, "Start new connection_output_handler on output_port %d\n", thread_data->data->output_port);
     
    // Инициализация SSL если нужно
    if (thread_data->data->enable_output_ssl) {
        if (!thread_data->data->ssl_ctx) {
            logMsg(LOG_ERR, "SSL context is not initialized on output_port %d\n", thread_data->data->output_port);
            close(thread_data->output_local);
            thread_data->is_output_connected = false;
            return 0;
        }
        thread_data->ssl_output = SSL_new(thread_data->data->ssl_ctx);
        if (!thread_data->ssl_output) {
            logMsg(LOG_ERR, "Failed to create SSL object on output_port %d\n", thread_data->data->output_port);
            // Выводим детальную информацию об ошибке OpenSSL
            unsigned long ssl_err;
            while ((ssl_err = ERR_get_error()) != 0) {
                char err_buf[256];
                ERR_error_string_n(ssl_err, err_buf, sizeof(err_buf));
                logMsg(LOG_ERR, "SSL error: %s\n", err_buf);
            }
            close(thread_data->output_local);
            thread_data->is_output_connected = false;
            return 0;
        }
        
        SSL_set_fd(thread_data->ssl_output, thread_data->output_local);

        /*
         * Ensure the socket is blocking during the TLS handshake.
         * The accept() earlier sets the accepted socket to non-blocking which
         * can cause SSL_accept() to return with WANT_READ/WANT_WRITE and be
         * treated as a fatal error here. Temporarily clear O_NONBLOCK, perform
         * the handshake, then restore the original flags (including non-blocking).
         */
        int sock_flags = fcntl(thread_data->output_local, F_GETFL, 0);
        if (sock_flags >= 0) {
            fcntl(thread_data->output_local, F_SETFL, sock_flags & ~O_NONBLOCK);
        }

        int ssl_ret = SSL_accept(thread_data->ssl_output);

        /* restore original flags (re-enable non-blocking if it was set) */
        if (sock_flags >= 0) {
            fcntl(thread_data->output_local, F_SETFL, sock_flags);
        }

        if (ssl_ret != 1) {
            logMsg(LOG_ERR, "SSL handshake failed on output_port %d with result %d\n", thread_data->data->output_port, ssl_ret);

            // Получаем код ошибки SSL
            int ssl_err = SSL_get_error(thread_data->ssl_output, ssl_ret);
            logMsg(LOG_ERR, "SSL accept error code: %d\n", ssl_err);

            /* Log detailed OpenSSL errors */
            unsigned long err;
            while ((err = ERR_get_error()) != 0) {
                char err_str[256];
                ERR_error_string_n(err, err_str, sizeof(err_str));
                logMsg(LOG_ERR, "SSL error: %s\n", err_str);
            }

            // Освобождаем SSL объект и закрываем сокет
            if (thread_data->ssl_output) {
                SSL_free(thread_data->ssl_output);
                thread_data->ssl_output = NULL;
            }
            if (thread_data->output_local != -1) {
                close(thread_data->output_local);
                thread_data->output_local = -1;
            }
            thread_data->is_output_connected = false;
            return 0;
        }
        logMsg(LOG_INFO, "SSL connection established on output_port %d\n", thread_data->data->output_port);
    }

    while (!done_output_connection) {
        fd_set read_set;
        FD_ZERO(&read_set);
        FD_SET(thread_data->output_local, &read_set);

        if(thread_data->close_output_socket)
        {
            logMsg(LOG_DEBUG,"Start disconnect on output_port %d\n", thread_data->data->output_port);
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
            if (thread_data->data->enable_output_ssl) {
                len_epdu = SSL_read(thread_data->ssl_output, (char *) thread_data->output_buf, sizeof(thread_data->output_buf));

                if (len_epdu <= 0) {
                    int ssl_err = SSL_get_error(thread_data->ssl_output, len_epdu);
                    if (ssl_err == SSL_ERROR_WANT_READ || ssl_err == SSL_ERROR_WANT_WRITE) {
                        /* Non-blocking socket wants more data; skip this cycle */
                        Thread_sleep(1);
                        continue;
                    } else if (ssl_err == SSL_ERROR_ZERO_RETURN) {
                        logMsg(LOG_INFO, "Output SSL connection closed\n");
                        break;
                    } else {
                        logMsg(LOG_ERR, "Output SSL error %d\n", ssl_err);
                        // Добавляем более детальную информацию об ошибке
                        logMsg(LOG_ERR, "SSL_read returned %d, SSL_get_error returned %d\n", len_epdu, ssl_err);
                        unsigned long e;
                        while ((e = ERR_get_error()) != 0) {
                            char err_str[256];
                            ERR_error_string_n(e, err_str, sizeof(err_str));
                            logMsg(LOG_ERR, "SSL error: %s\n", err_str);
                        }
                        // Освобождаем SSL объект и закрываем сокет, завершаем соединение
                        if (thread_data->ssl_output) {
                            SSL_free(thread_data->ssl_output);
                            thread_data->ssl_output = NULL;
                        }
                        if (thread_data->output_local != -1) {
                            close(thread_data->output_local);
                            thread_data->output_local = -1;
                        }
                        break;
                    }
                }
            } else {
                len_epdu = recv(thread_data->output_local, (char *) thread_data->output_buf, sizeof(thread_data->output_buf),
                                0);

                logMsg(LOG_INFO, "Receive data from output port %d: lenght %d\n",thread_data->data->output_port, len_epdu);

                if (len_epdu <= 0) {
                    if(len_epdu == 0) {
                        logMsg(LOG_INFO, "Output recv() connection closed\n");
                    } else {
                      logMsg(LOG_ERR, "Output recv() error:: %d\n", WSAGetLastError());
                    }
                    break;
                }
            }

            // Обновляем статистику - байты получены
            update_server_statistics(servers, thread_data->data, 0, len_epdu);

            int remaining = len_epdu;
            int sent = 0;
            int success = 0;

            while(!thread_data->is_input_connected) {
                Thread_sleep(10);

                if(thread_data->close_output_socket) {
                    done_output_connection = 1;
                    break;
                }
            }

            do {
                int result;
                if (thread_data->data->enable_input_ssl) {
                    if (!thread_data->ssl_input) {
                        logMsg(LOG_ERR, "SSL input object is NULL on port %d\n", thread_data->data->input_port);
                        break;
                    }
                    result = SSL_write(thread_data->ssl_input, (const char *)&thread_data->output_buf[sent], len_epdu - sent);
                    
                    if (result <= 0) {
                        int ssl_err = SSL_get_error(thread_data->ssl_input, result);
                        if (ssl_err != SSL_ERROR_WANT_READ && ssl_err != SSL_ERROR_WANT_WRITE) {
                            logMsg(LOG_ERR, "SSL write error %d on input port %d\n", ssl_err, thread_data->data->input_port);
                            // Добавляем более детальную информацию об ошибке
                            logMsg(LOG_ERR, "SSL_write returned %d, SSL_get_error returned %d\n", result, ssl_err);
                            unsigned long e;
                            while ((e = ERR_get_error()) != 0) {
                                char err_str[256];
                                ERR_error_string_n(e, err_str, sizeof(err_str));
                                logMsg(LOG_ERR, "SSL error: %s\n", err_str);
                            }
                            // Освобождаем SSL объект
                            if (thread_data->ssl_input) {
                                SSL_free(thread_data->ssl_input);
                                thread_data->ssl_input = NULL;
                            }
                        }
                    }
                } else {
                    result = send(thread_data->input_local,
                                (const char *)&thread_data->output_buf[sent],
                                len_epdu - sent, MSG_NOSIGNAL | MSG_DONTWAIT);
                }

                //logMsg(LOG_INFO, "Send data to port %d result %d\n", thread_data->data->input_port, result);

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
                    //logMsg(LOG_INFO, "Send data to input_port %d WSAGetLastError %d\n", thread_data->data->input_port, err);
                    if (err == EAGAIN)
                    {
                        struct timeval tv = {};
                        fd_set fds = {};

                        tv.tv_sec = 1;
                        FD_ZERO(&fds);
                        FD_SET(thread_data->input_local, &fds);
                        select_res = select((SOCKET)(thread_data->input_local + 1), NULL, &fds, NULL, &tv);

                        if(select_res == -1) {
                            logMsg(LOG_ERR, "Send:: input select error:: %d", WSAGetLastError());
                            break;
                        }

                        //logMsg(LOG_INFO, "Send:: wait\n");
                        Thread_sleep(1);
                        if(!thread_data->is_input_connected) break;
                        if(thread_data->close_output_socket) break;
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
    
    // Освобождаем SSL объект если он был создан
    if (thread_data->ssl_output) {
        SSL_free(thread_data->ssl_output);
        thread_data->ssl_output = NULL;
    }
     
    if (thread_data->output_local != -1) {
        close(thread_data->output_local);
        thread_data->output_local = -1;
    }

    thread_data->is_output_connected = false;
    thread_data->close_output_socket = false;

    logMsg(LOG_INFO,"Disconnect on output_port %d\n", thread_data->data->output_port);

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

                int current_free_socket_input = get_input_socket_with_output(connections_data);

                if(current_free_socket_input == -1) {
                    logMsg(LOG_INFO, "Not output socket - close input");
                    close(socket_local);
                    continue;
                }

                if(connections_data != NULL) {

                    // локальный входящий сокет для нового потока
                    connections_data->local_sockets[current_free_socket_input].input_local = socket_local;
                  
                    logMsg(LOG_DEBUG, "Start thread input socket create\n");
     
                    Thread thread = Thread_create(connection_input_handler, (void *) &connections_data->local_sockets[current_free_socket_input], true);
     
                    if (thread != NULL) {
                        Thread_start(thread);
                        logMsg(LOG_DEBUG, "Handler assigned\n");
                    } else {
                        logMsg(LOG_DEBUG, "Thread not create\n");
                        close(socket_local);
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

    SOCKET socket_local;

    while (server->stop_output_running == false) {
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

                int current_free_socket_output = get_free_output_socket(connections_data);

                if(current_free_socket_output == -1) {
                    logMsg(LOG_INFO, "Count output connection is full - close it\n");
                    close(socket_local);
                    continue;
                }

                if(connections_data != NULL) {

                    // локальный исходящий сокет для нового потока
                    connections_data->local_sockets[current_free_socket_output].output_local = socket_local;

                    logMsg(LOG_DEBUG, "Start output thread create\n");

                    Thread thread = Thread_create(connection_output_handler, (void *) &connections_data->local_sockets[current_free_socket_output], true);

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

    close(server->output);

    logMsg(LOG_INFO,"Exit server id = %d on output_port = %d ...\n", server->id, server->output_port);

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

int get_free_input_socket(proxy_server_thread_data_t * data)
{
    // Начинаем поиск со случайного смещения
    int start_index = rand() % COUNT_SOCKET_THREAD;
    
    for(int i = 0; i < COUNT_SOCKET_THREAD; i++) {
        int index = (start_index + i) % COUNT_SOCKET_THREAD;
        if(!data->local_sockets[index].is_input_connected) {
            return index;
        }
    }

    return -1;
}

int get_input_socket_with_output(proxy_server_thread_data_t *data)
{
    for (int i = 0; i < COUNT_SOCKET_THREAD; i++) {
        if (data->local_sockets[i].is_output_connected &&
            !data->local_sockets[i].is_input_connected) {
            return i;
        }
    }

    return -1;
}

int get_free_output_socket(proxy_server_thread_data_t * data)
{
    for(int i = 0; i < COUNT_SOCKET_THREAD; i++) {
        if(!data->local_sockets[i].is_output_connected) {
            return i;
        }
    }

    return -1;
}

// Инициализация SSL контекста при старте
void init_ssl_context(proxy_server_t *server) {
    // Проверяем, что пути к сертификату и ключу указаны, если SSL включен
    if ((server->enable_output_ssl || server->enable_input_ssl) &&
        (!server->cert_file[0] || !server->key_file[0])) {
        logMsg(LOG_ERR, "SSL enabled but certificate or key file not specified\n");
        server->enable_output_ssl = false;
        server->enable_input_ssl = false;
        return;
    }

    if (server->enable_output_ssl || server->enable_input_ssl) {
        logMsg(LOG_INFO, "Initializing SSL context with cert file: %s, key file: %s\n", server->cert_file, server->key_file);
        server->ssl_ctx = create_server_ssl_context(server->cert_file, server->key_file);
        if (!server->ssl_ctx) {
            logMsg(LOG_ERR, "Failed to initialize SSL context\n");
            server->enable_output_ssl = false;
            server->enable_input_ssl = false;
            return;
        }
        logMsg(LOG_INFO, "SSL context initialized\n");
    }
}

// Инициализация OpenSSL
void init_openssl() {
    // Проверяем результат инициализации OpenSSL
    if (SSL_library_init() != 1) {
        logMsg(LOG_ERR, "Failed to initialize OpenSSL library\n");
        exit(EXIT_FAILURE);
    }
    
    SSL_load_error_strings();
    OpenSSL_add_ssl_algorithms();
}

// Очистка ресурсов OpenSSL
void cleanup_openssl() {
    // Очищаем ошибки OpenSSL
    ERR_free_strings();
    
    // В современных версиях OpenSSL EVP_cleanup() не обязательна,
    // но оставляем для совместимости
    EVP_cleanup();
}

// Создание SSL контекста для сервера
SSL_CTX *create_server_ssl_context(const char *cert_file, const char *key_file) {
    if (!cert_file || !key_file || !cert_file[0] || !key_file[0]) {
        logMsg(LOG_ERR, "Certificate or key file path is empty\n");
        return NULL;
    }
    
    const SSL_METHOD *method = TLS_server_method();
    SSL_CTX *ctx = SSL_CTX_new(method);
    if (!ctx) {
        logMsg(LOG_ERR, "Unable to create SSL context\n");
        // Выводим детальную информацию об ошибке OpenSSL
        unsigned long ssl_err;
        while ((ssl_err = ERR_get_error()) != 0) {
            char err_buf[256];
            ERR_error_string_n(ssl_err, err_buf, sizeof(err_buf));
            logMsg(LOG_ERR, "SSL error: %s\n", err_buf);
        }
        return NULL;
    }
    
    // Логируем создание SSL контекста
    logMsg(LOG_INFO, "Server SSL context created\n");

    // Настройка контекста
    SSL_CTX_set_options(ctx, SSL_OP_NO_SSLv2 | SSL_OP_NO_SSLv3 | SSL_OP_NO_COMPRESSION);
    
    // Отключаем требование сертификата от клиента
    SSL_CTX_set_verify(ctx, SSL_VERIFY_NONE, NULL);
    
    if (SSL_CTX_use_certificate_file(ctx, cert_file, SSL_FILETYPE_PEM) <= 0) {
        logMsg(LOG_ERR, "Failed to load server certificate from %s\n", cert_file);
        // Выводим детальную информацию об ошибке OpenSSL
        unsigned long ssl_err;
        while ((ssl_err = ERR_get_error()) != 0) {
            char err_buf[256];
            ERR_error_string_n(ssl_err, err_buf, sizeof(err_buf));
            logMsg(LOG_ERR, "SSL error: %s\n", err_buf);
        }
        SSL_CTX_free(ctx);
        return NULL;
    }
    
    if (SSL_CTX_use_PrivateKey_file(ctx, key_file, SSL_FILETYPE_PEM) <= 0) {
        logMsg(LOG_ERR, "Failed to load server private key from %s\n", key_file);
        // Выводим детальную информацию об ошибке OpenSSL
        unsigned long ssl_err;
        while ((ssl_err = ERR_get_error()) != 0) {
            char err_buf[256];
            ERR_error_string_n(ssl_err, err_buf, sizeof(err_buf));
            logMsg(LOG_ERR, "SSL error: %s\n", err_buf);
        }
        SSL_CTX_free(ctx);
        return NULL;
    }
    
    // Проверяем, что приватный ключ соответствует сертификату
    if (!SSL_CTX_check_private_key(ctx)) {
        logMsg(LOG_ERR, "Private key does not match the certificate\n");
        // Выводим детальную информацию об ошибке OpenSSL
        unsigned long ssl_err;
        while ((ssl_err = ERR_get_error()) != 0) {
            char err_buf[256];
            ERR_error_string_n(ssl_err, err_buf, sizeof(err_buf));
            logMsg(LOG_ERR, "SSL error: %s\n", err_buf);
        }
        SSL_CTX_free(ctx);
        return NULL;
    }

    return ctx;
}

static int start_server_listening_threads(proxy_server_t *server, proxy_server_thread_data_t **runtime_out)
{
    proxy_server_thread_data_t *connections_data;

    connections_data = (proxy_server_thread_data_t *) malloc(sizeof(proxy_server_thread_data_t));
    if (!connections_data) {
        return -1;
    }

    memset(connections_data, 0, sizeof(proxy_server_thread_data_t));
    connections_data->local_sockets = (proxy_server_local_socket_data_t *) malloc(
        COUNT_SOCKET_THREAD * sizeof(proxy_server_local_socket_data_t));
    if (!connections_data->local_sockets) {
        free(connections_data);
        return -1;
    }

    memset(connections_data->local_sockets, 0,
           COUNT_SOCKET_THREAD * sizeof(proxy_server_local_socket_data_t));
    memcpy(&connections_data->data, server, sizeof(proxy_server_t));
    connections_data->data.ssl_ctx = server->ssl_ctx;
    proxy_server_t *runtime = &connections_data->data;

    for (int i = 0; i < COUNT_SOCKET_THREAD; i++) {
        connections_data->local_sockets[i].data = runtime;
        connections_data->local_sockets[i].is_input_connected = false;
        connections_data->local_sockets[i].is_output_connected = false;
        connections_data->local_sockets[i].close_output_socket = false;
    }

    if (runtime->is_input_enabled) {
        server_input_start(connections_data);
        if (!server_input_is_running(runtime)) {
            logMsg(LOG_ERR, "Failed to start input listener for dynamic server\n");
            free(connections_data->local_sockets);
            free(connections_data);
            return -1;
        }
    }

    if (runtime->is_output_enabled) {
        server_output_start(connections_data);
        if (!server_output_is_running(runtime)) {
            logMsg(LOG_ERR, "Failed to start output listener for dynamic server\n");
            free(connections_data->local_sockets);
            free(connections_data);
            return -1;
        }
    }

    server->is_input_running = runtime->is_input_running;
    server->is_output_running = runtime->is_output_running;

    if (runtime_out) {
        *runtime_out = connections_data;
    }

    return 0;
}

static void register_dynamic_server_runtime(const char *device_id, uint16_t input_port,
                                            uint16_t tunnel_port, int server_index,
                                            proxy_server_thread_data_t *connections_data)
{
    pthread_mutex_lock(&g_dynamic_runtimes_mutex);

    for (int i = 0; i < MAX_DYNAMIC_SERVER_RUNTIMES; i++) {
        if (g_dynamic_runtimes[i].active) {
            continue;
        }

        strncpy(g_dynamic_runtimes[i].device_id, device_id, DEVICE_ID_MAX_LEN);
        g_dynamic_runtimes[i].device_id[DEVICE_ID_MAX_LEN] = '\0';
        g_dynamic_runtimes[i].input_port = input_port;
        g_dynamic_runtimes[i].tunnel_port = tunnel_port;
        g_dynamic_runtimes[i].server_index = server_index;
        g_dynamic_runtimes[i].connections_data = connections_data;
        g_dynamic_runtimes[i].active = true;

        for (int j = 0; j < MAX_DYNAMIC_SERVER_RUNTIMES; j++) {
            if (j == i || !g_dynamic_runtimes[j].active) {
                continue;
            }
            if (g_dynamic_runtimes[j].server_index == server_index &&
                strcmp(g_dynamic_runtimes[j].device_id, device_id) != 0) {
                logMsg(LOG_WARNING,
                       "Clearing stale runtime registry for %s on slot %d (now used by %s)\n",
                       g_dynamic_runtimes[j].device_id, server_index, device_id);
                g_dynamic_runtimes[j].active = false;
                g_dynamic_runtimes[j].connections_data = NULL;
            }
        }

        pthread_mutex_unlock(&g_dynamic_runtimes_mutex);
        return;
    }

    pthread_mutex_unlock(&g_dynamic_runtimes_mutex);
    logMsg(LOG_WARNING, "Dynamic server runtime registry is full\n");
}

static void wait_for_runtime_threads(proxy_server_t *runtime)
{
    if (!runtime) {
        return;
    }

    int waited_ms = 0;
    while ((runtime->is_input_running || runtime->is_output_running) && waited_ms < 10000) {
        usleep(10000);
        waited_ms += 10;
    }
}

static void stop_dynamic_server_runtime(proxy_server_thread_data_t *connections_data, int server_index,
                                        const char *device_id)
{
    (void)server_index;

    if (!connections_data) {
        return;
    }

    proxy_server_t *runtime = &connections_data->data;
    if (device_id && device_id[0] != '\0' &&
        runtime->device_id[0] != '\0' &&
        strcmp(runtime->device_id, device_id) != 0) {
        logMsg(LOG_WARNING,
               "Refusing to stop runtime for device %s (runtime device=%s)\n",
               device_id, runtime->device_id);
        return;
    }

    runtime->stop_input_running = true;
    runtime->stop_output_running = true;
    runtime->enable = false;

    for (int i = 0; i < COUNT_SOCKET_THREAD; i++) {
        proxy_server_local_socket_data_t *sock = &connections_data->local_sockets[i];
        sock->close_output_socket = true;

        if (sock->input_local >= 0) {
            shutdown(sock->input_local, SHUT_RDWR);
            close(sock->input_local);
            sock->input_local = -1;
        }

        if (sock->output_local >= 0) {
            shutdown(sock->output_local, SHUT_RDWR);
            close(sock->output_local);
            sock->output_local = -1;
        }
    }

    if (runtime->input >= 0) {
        shutdown(runtime->input, SHUT_RDWR);
        close(runtime->input);
        runtime->input = -1;
    }

    if (runtime->output >= 0) {
        shutdown(runtime->output, SHUT_RDWR);
        close(runtime->output);
        runtime->output = -1;
    }

    wait_for_runtime_threads(runtime);
    cleanup_ssl_context(runtime);
}

static void apply_dynamic_server_ssl_config(proxy_server_t *server, bool enable_input_ssl,
                                            bool enable_tunnel_ssl)
{
    if (!server) {
        return;
    }

    if (!enable_input_ssl && !enable_tunnel_ssl) {
        return;
    }

    if (!device_manager_ssl_certs_configured()) {
        logMsg(LOG_WARNING,
               "Device %s requested TLS but server cert/key are not configured\n",
               server->device_id);
        return;
    }

    if (device_manager_get_ssl_cert_paths(server->cert_file, sizeof(server->cert_file),
                                          server->key_file, sizeof(server->key_file)) != 0) {
        return;
    }

    if (enable_input_ssl) {
        server->enable_input_ssl = true;
    }
    if (enable_tunnel_ssl) {
        server->enable_output_ssl = true;
    }

    init_ssl_context(server);
    logMsg(LOG_INFO,
           "Dynamic server SSL: device=%s input_ssl=%d tunnel_ssl=%d cert=%s\n",
           server->device_id,
           server->enable_input_ssl,
           server->enable_output_ssl,
           server->cert_file);
}

static bool dynamic_runtime_ssl_matches(const proxy_server_t *runtime, bool enable_input_ssl,
                                        bool enable_tunnel_ssl)
{
    if (!runtime) {
        return false;
    }

    return runtime->enable_input_ssl == enable_input_ssl &&
           runtime->enable_output_ssl == enable_tunnel_ssl;
}

static void stop_dynamic_runtimes_for_device(const char *device_id, uint16_t input_port, uint16_t tunnel_port)
{
    pthread_mutex_lock(&g_dynamic_runtimes_mutex);

    for (int i = 0; i < MAX_DYNAMIC_SERVER_RUNTIMES; i++) {
        if (!g_dynamic_runtimes[i].connections_data) {
            continue;
        }

        bool match = false;
        if (device_id && device_id[0] != '\0') {
            if (strcmp(g_dynamic_runtimes[i].device_id, device_id) != 0) {
                continue;
            }
            if (input_port != 0 && tunnel_port != 0) {
                match = (g_dynamic_runtimes[i].input_port == input_port &&
                         g_dynamic_runtimes[i].tunnel_port == tunnel_port);
            } else {
                match = true;
            }
        } else if (input_port != 0 && tunnel_port != 0) {
            match = (g_dynamic_runtimes[i].input_port == input_port &&
                     g_dynamic_runtimes[i].tunnel_port == tunnel_port);
        }
        if (!match) {
            continue;
        }

        if (g_dynamic_runtimes[i].server_index >= 0 &&
            g_dynamic_runtimes[i].server_index < servers_count &&
            servers[g_dynamic_runtimes[i].server_index].device_id[0] != '\0' &&
            strcmp(servers[g_dynamic_runtimes[i].server_index].device_id,
                   g_dynamic_runtimes[i].device_id) != 0) {
            logMsg(LOG_WARNING,
                   "Ignoring runtime registry mismatch for %s on slot %d (slot device=%s)\n",
                   g_dynamic_runtimes[i].device_id,
                   g_dynamic_runtimes[i].server_index,
                   servers[g_dynamic_runtimes[i].server_index].device_id);
            continue;
        }

        stop_dynamic_server_runtime(g_dynamic_runtimes[i].connections_data,
                                    g_dynamic_runtimes[i].server_index,
                                    g_dynamic_runtimes[i].device_id);
        g_dynamic_runtimes[i].active = false;
        g_dynamic_runtimes[i].connections_data = NULL;
    }

    pthread_mutex_unlock(&g_dynamic_runtimes_mutex);
}

int stop_dynamic_server_for_device(const char *device_id, uint16_t input_port, uint16_t tunnel_port)
{
    if (!device_id) {
        return -1;
    }

    stop_dynamic_runtimes_for_device(device_id, input_port, tunnel_port);
    logMsg(LOG_INFO, "Stopped dynamic server for device %s\n", device_id);
    return 0;
}

static void cleanup_dynamic_server_slot(int index);
static int find_healthy_dynamic_server(uint16_t input_port, uint16_t tunnel_port,
                                       bool enable_input_ssl, bool enable_tunnel_ssl);

static void cleanup_dynamic_server_slot(int index)
{
    char device_id[DEVICE_ID_MAX_LEN + 1] = {0};
    uint16_t input_port = 0;
    uint16_t tunnel_port = 0;

    if (index >= 0 && index < servers_count) {
        input_port = servers[index].input_port;
        tunnel_port = servers[index].output_port;
        strncpy(device_id, servers[index].device_id, DEVICE_ID_MAX_LEN);
    }

    if (device_id[0] != '\0') {
        stop_dynamic_runtimes_for_device(device_id, input_port, tunnel_port);
    }

    if (device_id[0] == '\0') {
        return;
    }

    pthread_mutex_lock(&g_dynamic_runtimes_mutex);
    for (int i = 0; i < MAX_DYNAMIC_SERVER_RUNTIMES; i++) {
        if (g_dynamic_runtimes[i].server_index != index || !g_dynamic_runtimes[i].connections_data) {
            continue;
        }
        if (device_id[0] != '\0' &&
            strcmp(g_dynamic_runtimes[i].device_id, device_id) != 0) {
            continue;
        }

        stop_dynamic_server_runtime(g_dynamic_runtimes[i].connections_data, index,
                                    g_dynamic_runtimes[i].device_id);
        g_dynamic_runtimes[i].active = false;
        g_dynamic_runtimes[i].connections_data = NULL;
    }
    pthread_mutex_unlock(&g_dynamic_runtimes_mutex);

    if (index < 0 || index >= servers_count) {
        return;
    }

    proxy_server_t *server = &servers[index];
    server->stop_input_running = true;
    server->stop_output_running = true;
    server->enable = false;

    if (server->input >= 0) {
        shutdown(server->input, SHUT_RDWR);
        close(server->input);
        server->input = -1;
    }
    if (server->output >= 0) {
        shutdown(server->output, SHUT_RDWR);
        close(server->output);
        server->output = -1;
    }

    wait_for_runtime_threads(server);
    cleanup_ssl_context(server);
}

static bool is_runtime_listener_active(const proxy_server_t *runtime, uint16_t port, bool is_tunnel)
{
    if (!runtime) {
        return false;
    }

    int fd = is_tunnel ? runtime->output : runtime->input;
    bool running = is_tunnel ? runtime->is_output_running : runtime->is_input_running;
    uint16_t bound_port = is_tunnel ? runtime->output_port : runtime->input_port;

    if (!runtime->enable || !running || fd < 0 || bound_port != port) {
        return false;
    }

    int accept_conn = 0;
    socklen_t accept_len = sizeof(accept_conn);
    if (getsockopt(fd, SOL_SOCKET, SO_ACCEPTCONN, &accept_conn, &accept_len) != 0 || accept_conn == 0) {
        return false;
    }

    return true;
}

static int find_healthy_dynamic_server(uint16_t input_port, uint16_t tunnel_port,
                                       bool enable_input_ssl, bool enable_tunnel_ssl)
{
    pthread_mutex_lock(&g_dynamic_runtimes_mutex);

    for (int i = 0; i < MAX_DYNAMIC_SERVER_RUNTIMES; i++) {
        if (!g_dynamic_runtimes[i].active) {
            continue;
        }
        if (g_dynamic_runtimes[i].input_port != input_port ||
            g_dynamic_runtimes[i].tunnel_port != tunnel_port) {
            continue;
        }

        proxy_server_thread_data_t *connections_data = g_dynamic_runtimes[i].connections_data;
        if (!connections_data) {
            continue;
        }

        proxy_server_t *runtime = &connections_data->data;
        if (runtime->enable &&
            runtime->is_input_running &&
            runtime->is_output_running &&
            runtime->input >= 0 &&
            runtime->output >= 0 &&
            dynamic_runtime_ssl_matches(runtime, enable_input_ssl, enable_tunnel_ssl) &&
            is_runtime_listener_active(runtime, input_port, false) &&
            is_runtime_listener_active(runtime, tunnel_port, true)) {
            int server_index = g_dynamic_runtimes[i].server_index;
            pthread_mutex_unlock(&g_dynamic_runtimes_mutex);
            return server_index;
        }
    }

    pthread_mutex_unlock(&g_dynamic_runtimes_mutex);
    return -1;
}

static int start_dynamic_server_at_index(int index, const char *device_id,
                                         uint16_t input_port, uint16_t tunnel_port,
                                         bool enable_input_ssl, bool enable_tunnel_ssl)
{
    if (index < 0 || index >= servers_count || !device_id) {
        return -1;
    }

    cleanup_dynamic_server_slot(index);

    proxy_server_t *server = &servers[index];

    memset(server, 0, sizeof(*server));
    server->id = 0;
    server->enable = true;
    server->input_port = input_port;
    server->output_port = tunnel_port;
    server->is_input_enabled = true;
    server->is_output_enabled = true;
    server->enable_output_ssl = false;
    server->enable_input_ssl = false;
    server->is_dynamic_port = true;
    strncpy(server->device_id, device_id, DEVICE_ID_MAX_LEN);
    server->device_id[DEVICE_ID_MAX_LEN] = '\0';
    server->statistics.last_update = time(NULL);

    apply_dynamic_server_ssl_config(server, enable_input_ssl, enable_tunnel_ssl);

    if (server_input_init(server) < 0) {
        server->is_input_enabled = false;
        server->enable = false;
        logMsg(LOG_ERR, "Failed to init input socket for device %s on port %u\n",
               device_id, input_port);
        cleanup_ssl_context(server);
        return -1;
    }

    if (server_output_init(server) < 0) {
        server->is_output_enabled = false;
        server->enable = false;
        logMsg(LOG_ERR, "Failed to init output socket for device %s on port %u\n",
               device_id, tunnel_port);
        if (server->input >= 0) {
            close(server->input);
            server->input = -1;
        }
        cleanup_ssl_context(server);
        return -1;
    }

    proxy_server_thread_data_t *runtime_data = NULL;
    if (start_server_listening_threads(server, &runtime_data) != 0) {
        server->enable = false;
        if (server->input >= 0) {
            close(server->input);
            server->input = -1;
        }
        if (server->output >= 0) {
            close(server->output);
            server->output = -1;
        }
        return -1;
    }

    register_dynamic_server_runtime(device_id, input_port, tunnel_port, index, runtime_data);
    if (!is_runtime_listener_active(&runtime_data->data, input_port, false) ||
        !is_runtime_listener_active(&runtime_data->data, tunnel_port, true)) {
        logMsg(LOG_ERR, "Dynamic server ports not accepting for device %s: input=%u tunnel=%u\n",
               device_id, input_port, tunnel_port);
        stop_dynamic_server_runtime(runtime_data, index, device_id);
        return -1;
    }
    logMsg(LOG_INFO, "Dynamic server started for device %s: input=%u tunnel=%u (slot=%d)\n",
           device_id, input_port, tunnel_port, index);
    return index;
}

static int find_stopped_dynamic_server(const char *device_id, uint16_t input_port, uint16_t tunnel_port)
{
    for (int i = 0; i < servers_count; i++) {
        if (!servers[i].is_dynamic_port || servers[i].enable) {
            continue;
        }
        if (strcmp(servers[i].device_id, device_id) == 0) {
            return i;
        }
    }

    for (int i = 0; i < servers_count; i++) {
        if (!servers[i].is_dynamic_port || servers[i].enable) {
            continue;
        }
        if (servers[i].input_port == input_port && servers[i].output_port == tunnel_port) {
            return i;
        }
    }

    return -1;
}

int create_dynamic_server_for_device(const char *device_id, uint16_t input_port,
                                     uint16_t tunnel_port, const device_info_t *device_info)
{
    bool enable_input_ssl = false;
    bool enable_tunnel_ssl = false;

    if (!device_id || input_port == 0 || tunnel_port == 0) {
        return -1;
    }

    if (device_info) {
        enable_input_ssl = device_info->enable_input_ssl && device_manager_ssl_certs_configured();
        enable_tunnel_ssl = device_info->enable_tunnel_ssl && device_manager_ssl_certs_configured();
    }

    proxy_server_t *new_servers = realloc(servers, (servers_count + 1) * sizeof(proxy_server_t));
    if (!new_servers) {
        logMsg(LOG_ERR, "Failed to allocate memory for dynamic server\n");
        return -1;
    }

    servers = new_servers;
    int index = servers_count;
    servers_count++;

    memset(&servers[index], 0, sizeof(proxy_server_t));
    int started = start_dynamic_server_at_index(index, device_id, input_port, tunnel_port,
                                                enable_input_ssl, enable_tunnel_ssl);
    if (started < 0) {
        servers_count--;
    }
    return started;
}

int ensure_dynamic_server_for_device(const char *device_id, uint16_t input_port, uint16_t tunnel_port,
                                     const device_info_t *device_info)
{
    device_info_t loaded_info;
    const device_info_t *info = device_info;
    bool enable_input_ssl = false;
    bool enable_tunnel_ssl = false;

    if (!device_id || input_port == 0 || tunnel_port == 0) {
        return -1;
    }

    if (!info) {
        if (device_manager_load_device_by_id(device_id, &loaded_info) == 0) {
            info = &loaded_info;
        }
    }

    if (info) {
        enable_input_ssl = info->enable_input_ssl && device_manager_ssl_certs_configured();
        enable_tunnel_ssl = info->enable_tunnel_ssl && device_manager_ssl_certs_configured();
    }

    int healthy_index = find_healthy_dynamic_server(input_port, tunnel_port,
                                                    enable_input_ssl, enable_tunnel_ssl);
    if (healthy_index >= 0) {
        logMsg(LOG_DEBUG, "Reusing healthy dynamic server for device %s on input=%u tunnel=%u\n",
               device_id, input_port, tunnel_port);
        return healthy_index;
    }

    stop_dynamic_runtimes_for_device(device_id, input_port, tunnel_port);

    int stopped_index = find_stopped_dynamic_server(device_id, input_port, tunnel_port);
    if (stopped_index >= 0) {
        logMsg(LOG_INFO, "Restarting stopped dynamic server slot %d for device %s\n",
               stopped_index, device_id);
        int restarted = start_dynamic_server_at_index(stopped_index, device_id, input_port, tunnel_port,
                                                      enable_input_ssl, enable_tunnel_ssl);
        if (restarted >= 0) {
            return restarted;
        }
    }

    logMsg(LOG_INFO, "Creating dynamic server for device %s: input=%u tunnel=%u\n",
           device_id, input_port, tunnel_port);
    return create_dynamic_server_for_device(device_id, input_port, tunnel_port, info);
}
