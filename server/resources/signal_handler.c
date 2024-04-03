#include <signal.h>

#include "signal_handler.h"
#include "db.h"
#include "db_proc.h"

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
        logMsg(LOG_ERR, "SIGINT stopped...");
        exit_nicely(get_db_connection());
    }
    else if (sigNum == SIGTERM) {
        logMsg(LOG_ERR, "SIGTERM stopped...");
        exit_nicely(get_db_connection());
    }
    else if (sigNum == SIGALRM) {
    }
    else if (sigNum == SIGPIPE) {
        logMsg(LOG_ERR, "SIGPIPE...");
    }
}

