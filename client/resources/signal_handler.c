#include <signal.h>

#include "signal_handler.h"
#include "logMsg.h"

void signal_init(void)
{
    signal(SIGINT, sigHandler);
    signal(SIGTERM, sigHandler);
    signal(SIGPIPE, sigHandler);
    signal(SIGALRM, sigHandler);
}

void sigHandler(int sigNum)
{
    if (sigNum == SIGINT) {
        logMsg(LOG_ERR, "stopped...");        
    }
    else if (sigNum == SIGTERM) {
        logMsg(LOG_ERR, "SIGTERM stopped...");
    }
    else if (sigNum == SIGALRM) {
    }
    else if (sigNum == SIGPIPE) {
        logMsg(LOG_ERR, "SIGPIPE...");
    }
}

