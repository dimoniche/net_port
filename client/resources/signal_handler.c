#include <signal.h>

#include "signal_handler.h"
#include "logMsg.h"
#include "proxy_client.h"

void signal_init(void)
{
    signal(SIGINT, sigHandler);
    signal(SIGTERM, sigHandler);
    signal(SIGPIPE, sigHandler);
    signal(SIGALRM, sigHandler);
}

void sigHandler(int sigNum)
{
    if (sigNum == SIGINT || sigNum == SIGTERM) {
        proxy_server_thread_data_t *settings = get_client_settings();
        if (settings) {
            settings->graceful_shutdown = true;
        }
        global_graceful_shutdown = 1;
    }
    /* SIGPIPE and SIGALRM: ignore or handle without non-async-safe calls */
}

