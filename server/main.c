/******************************************************************************
*
*   Copyright (C)
*
******************************************************************************/

#include <stdio.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>

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
    bool no_db_mode = false;
    uint16_t cli_input_port = 0;
    uint16_t cli_output_port = 0;
    bool cli_enable_ssl = false;

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
        printf("  --no-db           Run without DB; set ports via --input-port and --output-port\n");
        printf("  --input-port <n>  Input port to listen on (used with --no-db)\n");
        printf("  --output-port <n> Output port to listen on (used with --no-db)\n");
        printf("  --enable-ssl      Enable SSL for the CLI-provided server (used with --no-db)\n");
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
        logMsg(LOG_DEBUG, "Processing arg %d: '%s'", i, argv[i]);

        if (strstr(argv[i], VERBOSE_KEY) != NULL) {
            int verbose_level;
            s = argv[i] + sizeof(VERBOSE_KEY) - 1;
            sscanf(s, "%d", &verbose_level);
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
        else if (strcmp(argv[i], PORT_KEY) == 0)
        {
            if (argv[i+1] != NULL) {
                DB_conn_data.port = argv[i+1];
                i++;
            }
        }
        else if (strstr(argv[i], USER_ID) != NULL)
        {
            if (argv[i+1] != NULL)
            {
                sscanf(argv[i+1], "%d", &user_id);
                i++;
                logMsg(LOG_INFO, "Set user file: %d", user_id);
            }
        }
        else if (strstr(argv[i], "--cert") != NULL)
        {
            if (argv[i+1] != NULL) {
                cert_file = argv[i+1];
                i++;
                logMsg(LOG_INFO, "Set cerificate file: %s", cert_file);
            }
        }
        else if (strstr(argv[i], "--key") != NULL)
        {
            if (argv[i+1] != NULL) {
                key_file = argv[i+1];
                i++;
                logMsg(LOG_INFO, "Set key file: %s", key_file);
            }
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
        else if (strcmp(argv[i], "--no-db") == 0)
        {
            no_db_mode = true;
            logMsg(LOG_INFO, "Set no database mode");
        }
        else if (strcmp(argv[i], "--input-port") == 0)
        {
            if (argv[i+1] != NULL) {
                int p = 0;
                sscanf(argv[i+1], "%d", &p);
                if (p > 0 && p <= 65535) {
                    cli_input_port = (uint16_t)p;
                    logMsg(LOG_INFO, "Set cli_input_port to %d", cli_input_port);
                } else {
                    logMsg(LOG_EMERG, "Invalid input port value: %d", p);
                    exit(-1);
                }
                i++;
            } else {
                logMsg(LOG_EMERG, "Missing value for --input-port");
                exit(-1);
            }
        }
        else if (strcmp(argv[i], "--output-port") == 0)
        {
            if (argv[i+1] != NULL) {
                int p = 0;
                sscanf(argv[i+1], "%d", &p);
                if (p > 0 && p <= 65535) {
                    cli_output_port = (uint16_t)p;
                    logMsg(LOG_INFO, "Set cli_output_port to %d", cli_output_port);
                } else {
                    logMsg(LOG_EMERG, "Invalid output port value: %d", p);
                    exit(-1);
                }
                i++;
            } else {
                logMsg(LOG_EMERG, "Missing value for --output-port");
                exit(-1);
            }
        }
        else if (strstr(argv[i], "--enable-ssl") != NULL)
        {
            cli_enable_ssl = true;
            logMsg(LOG_INFO, "Set enable SSL mode");
        }
    }

    char log[128];
    sprintf(log, "logs/module_net_port_server_u%d.log", user_id);
    logMsgOpen(log);
    logMsg(LOG_DEBUG, "Start logger...");

    if (!no_db_mode) {
        db_init(DB_conn_data.ip, DB_conn_data.port);
        servers_init(user_id, cert_file, key_file);
    } else {
        if (cli_input_port == 0 || cli_output_port == 0) {
            logMsg(LOG_EMERG, "--no-db mode requires --input-port and --output-port to be set\n");
            exit(-1);
        }
        servers_init_no_db(cert_file, key_file, cli_input_port, cli_output_port, cli_enable_ssl);
    }
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
            if (!no_db_mode) {
                exit_nicely(get_db_connection());
            } else {
                exit(0);
            }
            return 0;
        }

        msleep(10);
    }

    return 0;
}
