/******************************************************************************
*
*   Copyright (C)
*
******************************************************************************/

#include <stdio.h>
#include <stdarg.h>
#include <stdint.h>

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
    logMsgOpen("../logs/module_net_port_server.log");
    logMsg(LOG_DEBUG, "Start logger...");

    signal_init();

    TDBConnectionData DB_conn_data = {(char*)"127.1", (char*)"5432"};

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
        if (strstr(argv[i], HOST_KEY) != NULL)
        {
            if (argv[i+1] != NULL)
                DB_conn_data.ip = argv[i+1];
        }
        if (strstr(argv[i], PORT_KEY) != NULL)
        {
            if (argv[i+1] != NULL)
                DB_conn_data.port = argv[i+1];
        }
    }

    db_init(DB_conn_data.ip, DB_conn_data.port);

    // запускаем все потоки после инициализации криптоинтерфейса
    servers_init();
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

        msleep(10);
    }

    return 0;
}
