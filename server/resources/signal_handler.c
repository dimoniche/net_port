#include <signal.h>
#include <stdbool.h>

#include "signal_handler.h"
#include "db.h"
#include "db_proc.h"
#include "proxy_server.h"

static volatile bool stop_requested = false;

void signal_init(void)
{
    signal(SIGINT, sigHandler);
    signal(SIGTERM, sigHandler);
    signal(SIGPIPE, sigHandler);
    signal(SIGALRM, sigHandler);
}

bool is_stop_requested() {
    return stop_requested;
}

void sigHandler(int sigNum)
{
    if (sigNum == SIGINT) {
        logMsg(LOG_ERR, "SIGINT received, stopping server...");
        stop_requested = true;
    }
    else if (sigNum == SIGTERM) {
        logMsg(LOG_ERR, "SIGTERM received, stopping server...");
        stop_requested = true;
    }
    else if (sigNum == SIGALRM) {
    }
    else if (sigNum == SIGPIPE) {
        logMsg(LOG_ERR, "SIGPIPE...");
    }
}

