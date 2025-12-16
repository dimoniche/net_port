/******************************************************************************
*
*   Copyright (C)
*
******************************************************************************/

#include <stdio.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdlib.h>

#include "logMsg.h"
#include "db.h"
#include "db_proc.h"
#include "signal_handler.h"
#include "settings.h"
#include "time_utils.h"
#include "proxy_server.h"
#include "hal_time.h"
#include "time_counter.h"

static uint64_t last_monotonic_time;

int main(int argc, char** argv) {
    logMsg(LOG_DEBUG, "Start...");
    logMsgInit();

    signal_init();

    TDBConnectionData DB_conn_data = {(char*)"127.1", (char*)"5432"};

    uint32_t user_id = 0;

    char *cert_file = NULL;
    char *key_file = NULL;

    if (argc == 1 || (argc == 2 && (strcmp(argv[1], "--help") == 0 || strcmp(argv[1], "-h") == 0))) {
        printf("Net Port Server v%s\n\n", VERSION);
        printf("Usage: %s [OPTIONS]\n\n", argv[0]);
        printf("Options:\n");
        printf("  %s<level>        Set verbose level (1-%d, higher=more output)\n", VERBOSE_KEY, LOG_LAST_PRIORITY);
        printf("  %s <host>         Database host IP address\n", HOST_KEY);
        printf("  %s <port>         Database port number\n", PORT_KEY);
        printf("  %s <id>           User ID for logging\n", USER_ID);
        printf("  --cert <file>     Path to SSL certificate file\n");
        printf("  --key <file>      Path to SSL private key file\n");
        printf("  --threads <num>   Number of socket threads (1-1000)\n");
        printf("  -h, --help        Show this help message\n");
        printf("  -v, --version     Show version information\n");
        printf("\nExample:\n");
        printf("  %s %s5 %s 192.168.1.100 %s 5432 %s 100\n",
               argv[0], VERBOSE_KEY, HOST_KEY, PORT_KEY, USER_ID);
        exit(0);
    }

    if (argc == 2 && (strcmp(argv[1], "--version") == 0 || strcmp(argv[1], "-v") == 0)) {
        printf("Net Port Server v%s\n", VERSION);
        exit(0);
    }

    for (int i = 1; i < argc; i++) {
        char* s;
        int verbose_level;
        logMsg(LOG_DEBUG, "%s", argv[i]);

        if (strstr(argv[i], VERBOSE_KEY) != NULL) {
            s = argv[i] + sizeof(VERBOSE_KEY) - 1;
            sscanf(s, "%d", &verbose_level);
            logMsg(LOG_DEBUG, "verbose level %d", verbose_level);
            if ((verbose_level > 0) && (verbose_level <= LOG_LAST_PRIORITY)) {
                logMsgSetPriority(verbose_level);
                logMsg(LOG_INFO, "Set verbose level %d", verbose_level);
            } else {
                logMsg(LOG_EMERG, "Wrong verbose level %d, should be less then %d", verbose_level,
                       LOG_LAST_PRIORITY + 1);
                exit(-1);
            }
        }
        else if (strstr(argv[i], HOST_KEY) != NULL)
        {
            if (argv[i+1] != NULL)
                DB_conn_data.ip = argv[i+1];
        }
        else if (strstr(argv[i], PORT_KEY) != NULL)
        {
            if (argv[i+1] != NULL)
                DB_conn_data.port = argv[i+1];
        }
        else if (strstr(argv[i], USER_ID) != NULL)
        {
            if (argv[i+1] != NULL)
            {
                sscanf(argv[i+1], "%d", &user_id);
            }
            i++;
        }
        else if (strstr(argv[i], "--cert") != NULL)
        {
            if (argv[i+1] != NULL)
                cert_file = argv[i+1];
            i++;
        }
        else if (strstr(argv[i], "--key") != NULL)
        {
            if (argv[i+1] != NULL)
                key_file = argv[i+1];
            i++;
        }
        else if (strstr(argv[i], "--threads") != NULL || strstr(argv[i], "-t") != NULL)
        {
            if (argv[i+1] != NULL) {
                int thread_count;
                sscanf(argv[i+1], "%d", &thread_count);
                if (thread_count > 0 && thread_count <= 1000) {
                    COUNT_SOCKET_THREAD = thread_count;
                    logMsg(LOG_INFO, "Set socket threads count to %d", thread_count);
                } else {
                    logMsg(LOG_EMERG, "Invalid thread count %d (1-1000 allowed)", thread_count);
                    exit(-1);
                }
                i++;
            }
        }
    }

    char log[128];
    sprintf(log, "logs/module_net_port_server_u%d.log", user_id);
    logMsgOpen(log);
    logMsg(LOG_DEBUG, "Start logger...");

    db_init(DB_conn_data.ip, DB_conn_data.port);

    servers_init(user_id, cert_file, key_file);
    switcher_servers_start();

    while (1) {
        if(Hal_getMonotonicTimeInMs() - last_monotonic_time > 1000UL)
        {
            //fflush(stdout);

            if((get_time_counter() % 10) == 0) {
            }

            increment_time_counter();

            last_monotonic_time = Hal_getMonotonicTimeInMs();
        }

        // Проверяем, не запрошено ли завершение работы
        if (is_stop_requested()) {
            logMsg(LOG_INFO, "Stopping server...");
            switcher_servers_stop();
            logMsg(LOG_INFO, "Server stopped successfully");
            exit_nicely(get_db_connection());
            return 0;
        }

        msleep(10);
    }

    return 0;
}
