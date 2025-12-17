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
    proxy_server_thread_data_t* settings = get_client_settings();
    
    if (sigNum == SIGINT) {
        logMsg(LOG_INFO, "SIGINT received, initiating graceful shutdown...");
        settings->graceful_shutdown = true;
        global_graceful_shutdown = 1;
    }
    else if (sigNum == SIGTERM) {
        logMsg(LOG_INFO, "SIGTERM received, initiating graceful shutdown...");
        settings->graceful_shutdown = true;
        global_graceful_shutdown = 1;
    }
    else if (sigNum == SIGALRM) {
        // Handle SIGALRM if needed
    }
    else if (sigNum == SIGPIPE) {
        logMsg(LOG_INFO, "SIGPIPE received...");
    }
}

