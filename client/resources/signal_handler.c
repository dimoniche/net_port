#include <signal.h>
#include <stdlib.h>

#include "signal_handler.h"
#include "logMsg.h"

void signal_init(void)
{
    signal(SIGINT, sigHandler);
    signal(SIGTERM, sigHandler);
    signal(SIGPIPE, sigHandler);
    signal(SIGALRM, sigHandler);
}

void exit_nicely()
{
    exit(1);
}

void sigHandler(int sigNum)
{
    if (sigNum == SIGINT) {
        logMsg(LOG_ERR, "SIGINT stopped...");
        exit_nicely();
    }
    else if (sigNum == SIGTERM) {
        logMsg(LOG_ERR, "SIGTERM stopped...");
        exit_nicely();
    }
    else if (sigNum == SIGALRM) {
    }
    else if (sigNum == SIGPIPE) {
        logMsg(LOG_ERR, "SIGPIPE...");
    }
}

