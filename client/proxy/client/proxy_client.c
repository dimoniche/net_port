#include "proxy_client.h"

#include <openssl/ssl.h>
#include <openssl/err.h>
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

// Инициализация SSL контекста при старте
void init_ssl_context() {
    if (threads_data.enable_ssl) {
        // Проверяем, что путь к CA сертификату указан
        if (!threads_data.ca_file[0]) {
            logMsg(LOG_ERR, "SSL enabled but CA file not specified\n");
            threads_data.enable_ssl = false;
            return;
        }
        
        logMsg(LOG_INFO, "Initializing SSL context with CA file: %s\n", threads_data.ca_file);
        threads_data.ssl_ctx = create_client_ssl_context(threads_data.ca_file);
        if (!threads_data.ssl_ctx) {
            logMsg(LOG_ERR, "Failed to initialize SSL context\n");
            exit(EXIT_FAILURE);
        }
        logMsg(LOG_INFO, "SSL context initialized\n");
    }
}

int
switcher_servers_start()
{
    // Инициализация SSL контекста если нужно
    init_ssl_context();

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
    free(parameter); // Освобождаем параметр потока сразу после использования
    
    restart_input_thread:
    // Reset socket descriptor before reconnecting
    conn->input = -1;
    Thread_sleep(100); // Small delay before reconnect attempt

    int len_apdu;
    conn->last_exchange_time = get_time_counter();

    logMsg(LOG_INFO, "Restart input server for connection %d\n", conn->id);

    // Reinitialize socket structures
    memset(&conn->input_addr, 0, sizeof(conn->input_addr));
    if (init_input_sockets(conn) != 0) {
        logMsg(LOG_ERR, "Failed to reinitialize input sockets for connection %d\n", conn->id);
        Thread_sleep(1000);
        goto restart_input_thread;
    }

    if (connect(conn->input, (struct sockaddr *) &conn->input_addr,
                sizeof(conn->input_addr)) < 0)
    {
        logMsg(LOG_ERR, "Input server connect error for connection %d\n", conn->id);
    } else {
        logMsg(LOG_INFO, "Connect input server for connection %d\n", conn->id);

        // Инициализация SSL соединения если включено
        if (threads_data.enable_ssl) {
            conn->ssl_input = SSL_new(threads_data.ssl_ctx);
            if (!conn->ssl_input) {
                logMsg(LOG_ERR, "Failed to create SSL object for connection %d\n", conn->id);
                ERR_print_errors_fp(stderr);
                close(conn->input);
                conn->input = -1;
                goto restart_input_thread;
            }
            SSL_set_fd(conn->ssl_input, conn->input);

            if (SSL_connect(conn->ssl_input) != 1) {
                logMsg(LOG_ERR, "SSL connection failed for connection %d\n", conn->id);
                
                // Логируем детальные ошибки SSL
                unsigned long err;
                while ((err = ERR_get_error()) != 0) {
                    char err_str[256];
                    ERR_error_string_n(err, err_str, sizeof(err_str));
                    logMsg(LOG_ERR, "SSL error: %s\n", err_str);
                }
                
                // Логируем информацию о сертификате
                X509* cert = SSL_get_peer_certificate(conn->ssl_input);
                if (cert) {
                    char* cert_str = X509_NAME_oneline(X509_get_subject_name(cert), 0, 0);
                    logMsg(LOG_ERR, "Peer certificate subject: %s\n", cert_str);
                    OPENSSL_free(cert_str);
                    X509_free(cert);
                } else {
                    logMsg(LOG_ERR, "No peer certificate\n");
                }
                
                SSL_free(conn->ssl_input);
                conn->ssl_input = NULL;
                close(conn->input);
                conn->input = -1;
                goto restart_input_thread;
            }

            logMsg(LOG_INFO, "SSL connection established for connection %d\n", conn->id);
        }

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
            // Плавное закрытие соединения по таймауту
            logMsg(LOG_INFO, "Inactivity timeout approaching for connection %d, initiating graceful shutdown", conn->id);
            
            // Останавливаем output поток
            conn->stop_running_output = true;
            
            // Даем время для graceful shutdown
            int shutdown_timeout = 5; // 5 секунд на корректное завершение
            uint64_t shutdown_start = get_time_counter();
            
            while(conn->is_running_output &&
                  (get_time_counter() - shutdown_start < shutdown_timeout)) {
                Thread_sleep(10);
            }
            
            // Закрываем сокет
            if (conn->input >= 0) {
                close(conn->input);
                conn->input = -1;
            }

            logMsg(LOG_INFO, "Timeout Input thread for connection %d", conn->id);

            // Ожидаем полной остановки output потока
            uint64_t wait_start = get_time_counter();
            while(conn->is_running_output &&
                  (get_time_counter() - wait_start < 30)) { // 30 секунд максимум
                Thread_sleep(10);
            }

            logMsg(LOG_INFO, "Restart by timeout Input thread for connection %d\n", conn->id);
            // Reset output socket before restarting
            if (conn->output >= 0) {
                close(conn->output);
                conn->output = -1;
            }
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

            if (threads_data.enable_ssl) {
                len_apdu = SSL_read(conn->ssl_input, (char *) conn->receive_input, sizeof(conn->receive_input));
            } else {
                len_apdu = recv(conn->input, (char *) conn->receive_input, sizeof(conn->receive_input), 0);
            }

            logMsg(LOG_INFO, "Receive data from input port %d: length %d for connection %d\n", threads_data.input_port, len_apdu, conn->id);

            if (len_apdu <= 0) {
                if(len_apdu == 0) {
                    logMsg(LOG_INFO, "Input recv() connection closed for connection %d\n", conn->id);
                } else {
                  logMsg(LOG_ERR, "Input recv() error:: %d for connection %d\n", errno, conn->id);
                }

                // останавливаем внутренний порт
                conn->stop_running_output = true;
                if (conn->input >= 0) {
                    close(conn->input);
                    conn->input = -1;
                }

                uint64_t wait_start = get_time_counter();
                while(conn->is_running_output &&
                      (get_time_counter() - wait_start < 30)) { // 30 секунд максимум
                    Thread_sleep(10);
                }

                logMsg(LOG_INFO, "Restart Input thread for connection %d\n", conn->id);
                goto restart_input_thread;
            }

            // Проверяем и запускаем output поток если он не активен
            if (!conn->is_running_output && !conn->is_starting_output) {
                server_output_start(conn_index);
            }

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
                int result;
                if (threads_data.enable_ssl) {
                    result = SSL_write(conn->ssl_input,
                                    (const char *)&conn->receive_input[sent],
                                    len_apdu - sent);
                } else {
                    result = send(conn->output,
                                (const char *)&conn->receive_input[sent],
                                len_apdu - sent, MSG_NOSIGNAL | MSG_DONTWAIT);
                }

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

    if (threads_data.enable_ssl && conn->ssl_input) {
        SSL_shutdown(conn->ssl_input);
        SSL_free(conn->ssl_input);
        conn->ssl_input = NULL;
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
    free(parameter); // Освобождаем параметр потока сразу после использования
    
    int len_apdu;
    uint64_t last_exchange_time = get_time_counter();

    logMsg(LOG_INFO, "Start output server for connection %d\n", conn->id);

    if (init_output_sockets(conn) != 0) {
        logMsg(LOG_ERR, "Output socket initialization failed for connection %d\n", conn->id);
        conn->is_running_output = false;
        return 0;
    }

    if (connect(conn->output, (struct sockaddr *) &conn->output_addr,
                sizeof(conn->output_addr)) < 0)
    {
        logMsg(LOG_ERR, "Output server connect error for connection %d: %s\n", conn->id, strerror(errno));
        close(conn->output);
        conn->output = -1;
        conn->is_running_output = false;
        return 0;
    }

    logMsg(LOG_INFO, "Connect output server for connection %d\n", conn->id);

    int flags = fcntl(conn->output , F_GETFL, 0);
    if(fcntl(conn->output, F_SETFL, flags|O_NONBLOCK) < 0) {
        logMsg(LOG_ERR, "connect fcntl error for connection %d: %s\n", conn->id, strerror(errno));
    }

    conn->is_running_output = true;
    conn->is_starting_output = false;

    while (conn->stop_running_output == false) {

        fd_set read_set;
        FD_ZERO(&read_set);
        FD_SET(conn->output, &read_set);

        // Проверка таймаута бездействия с graceful shutdown
        if(get_time_counter() - last_exchange_time > threads_data.timeout_seconds) {
            logMsg(LOG_INFO, "Inactivity timeout detected for connection %d, initiating graceful shutdown\n", conn->id);
            
            // Пытаемся корректно закрыть соединение
            if (conn->output >= 0) {
                shutdown(conn->output, SHUT_RDWR);
            }
            
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
        if (!param) {
            logMsg(LOG_ERR, "Failed to allocate memory for thread parameter (connection %d)\n", conn_index);
            conn->is_starting_input = false;
            return;
        }
        *param = conn_index;
        
        conn->input_thread = Thread_create(server_input_thread, (void *) param, true); // Создаем отсоединенный поток
        if (!conn->input_thread) {
            logMsg(LOG_ERR, "Failed to create input thread for connection %d\n", conn_index);
            free(param);
            conn->is_starting_input = false;
            return;
        }

        Thread_start(conn->input_thread);

        while (conn->is_starting_input)
            Thread_sleep(1);
    }
}

void
server_output_start(int conn_index)
{
    proxy_server_connection_t *conn = &threads_data.connections[conn_index];
    
    if (conn->is_running_output == false && conn->is_starting_output == false) {

        conn->is_starting_output = true;
        conn->stop_running_output = false;

        // Создаем копию индекса для передачи в поток
        int *param = malloc(sizeof(int));
        if (!param) {
            logMsg(LOG_ERR, "Failed to allocate memory for thread parameter (connection %d)\n", conn_index);
            conn->is_starting_output = false;
            return;
        }
        *param = conn_index;
        
        conn->output_thread = Thread_create(server_output_thread, (void *) param, true);
        if (!conn->output_thread) {
            logMsg(LOG_ERR, "Failed to create output thread for connection %d\n", conn_index);
            free(param);
            conn->is_starting_output = false;
            return;
        }

        Thread_start(conn->output_thread);

        // Ожидаем подтверждения запуска потока
        uint64_t wait_start = get_time_counter();
        while (conn->is_starting_output) {
            Thread_sleep(1);
            
            // Таймаут на запуск потока - 5 секунд
            if (get_time_counter() - wait_start > 5) {
                logMsg(LOG_ERR, "Timeout waiting for output thread start (connection %d)\n", conn_index);
                conn->is_starting_output = false;
                break;
            }
        }
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

void
switcher_servers_stop()
{
    proxy_server_thread_data_t* settings = get_client_settings();
    
    logMsg(LOG_INFO, "Initiating graceful shutdown of all connections...");
    
    for (int i = 0; i < settings->connections_count; i++) {
        proxy_server_connection_t *conn = &settings->connections[i];
        
        // Останавливаем input поток
        if (conn->is_running_input) {
            conn->stop_running_input = true;
        }
        
        // Останавливаем output поток
        if (conn->is_running_output) {
            conn->stop_running_output = true;
        }
    }

    // Освобождаем память соединений
    if (settings->connections) {
        // Сначала дожидаемся завершения и уничтожаем все потоки
        for (int i = 0; i < settings->connections_count; i++) {
            proxy_server_connection_t *conn = &settings->connections[i];
            
            if (conn->input_thread) {
                // Дожидаемся завершения потока
                while (conn->is_running_input) {
                    Thread_sleep(10);
                }
                Thread_destroy(conn->input_thread);
                conn->input_thread = NULL;
            }
            
            if (conn->output_thread) {
                // Дожидаемся завершения потока
                while (conn->is_running_output) {
                    Thread_sleep(10);
                }
                Thread_destroy(conn->output_thread);
                conn->output_thread = NULL;
            }
        }
        
        free(settings->connections);
        settings->connections = NULL;
        settings->connections_count = 0;
    }

    // Очистка SSL контекста
    if (settings->ssl_ctx) {
        SSL_CTX_free(settings->ssl_ctx);
        settings->ssl_ctx = NULL;
    }
}

void
switcher_servers_wait_stop()
{
    proxy_server_thread_data_t* settings = get_client_settings();
    
    logMsg(LOG_INFO, "Waiting for all connections to stop gracefully...");
    
    for (int i = 0; i < settings->connections_count; i++) {
        proxy_server_connection_t *conn = &settings->connections[i];
        
        // Ожидаем остановки input потока
        while (conn->is_running_input) {
            Thread_sleep(10);
        }
        
        // Ожидаем остановки output потока
        while (conn->is_running_output) {
            Thread_sleep(10);
        }
        
        logMsg(LOG_INFO, "Connection %d stopped gracefully", conn->id);
    }
    
    logMsg(LOG_INFO, "All connections stopped gracefully");
}

// Инициализация OpenSSL
void init_openssl() {
    SSL_load_error_strings();
    OpenSSL_add_ssl_algorithms();
}

// Очистка ресурсов OpenSSL
void cleanup_openssl() {
    EVP_cleanup();
}

// Создание SSL контекста для клиента
SSL_CTX *create_client_ssl_context(const char *ca_file) {
    if (!ca_file || !ca_file[0]) {
        logMsg(LOG_ERR, "CA file path is empty\n");
        return NULL;
    }
    
    const SSL_METHOD *method = TLS_client_method();
    SSL_CTX *ctx = SSL_CTX_new(method);
    if (!ctx) {
        logMsg(LOG_ERR, "Unable to create SSL context\n");
        return NULL;
    }
    
    // Логируем создание SSL контекста
    logMsg(LOG_INFO, "Client SSL context created\n");

    // Настройка контекста
    SSL_CTX_set_options(ctx, SSL_OP_NO_SSLv2 | SSL_OP_NO_SSLv3 | SSL_OP_NO_COMPRESSION);
    
    // Клиент проверяет сертификат сервера
    SSL_CTX_set_verify(ctx, SSL_VERIFY_PEER, NULL);
    
    // Загружаем CA-сертификат для проверки сертификата сервера
    if (SSL_CTX_load_verify_locations(ctx, ca_file, NULL) != 1) {
        logMsg(LOG_ERR, "Failed to load CA certificate from %s\n", ca_file);
        ERR_print_errors_fp(stderr);
        SSL_CTX_free(ctx);
        return NULL;
    }

    return ctx;
}
