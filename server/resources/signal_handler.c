#include <signal.h>

#include "signal_handler.h"
#include "db.h"
#include "db_proc.h"

void signal_init(void)
{
    signal(SIGINT, sigHandler);
    signal(SIGTERM, sigHandler);
    signal(SIGPIPE, sigHandler);
#if defined _WIN32 || defined __CYGWIN__
#else
    signal(SIGALRM, sigHandler);
#endif
}

void sigHandler(int sigNum)
{
    if (sigNum == SIGINT) {
        logMsg(LOG_ERR, "stopped...");
        exit_nicely(get_db_connection());
    }
    else if (sigNum == SIGTERM) {
        logMsg(LOG_ERR, "SIGTERM stopped...");
        exit_nicely(get_db_connection());
    }
#if defined _WIN32 || defined __CYGWIN__
#else
    else if (sigNum == SIGALRM) {
    }
#endif
    else if (sigNum == SIGPIPE) {
        logMsg(LOG_ERR, "SIGPIPE...");
    }
}

