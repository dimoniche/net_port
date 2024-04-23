/******************************************************************************
*
*   Copyright (C)
*
******************************************************************************/

#include <stdio.h>
#include <stdarg.h>
#include <stdint.h>
#include <libgen.h>

#include "logMsg.h"
#include "signal_handler.h"
#include "settings.h"
#include "time_utils.h"
#include "proxy_client.h"
#include "hal_time.h"
#include "time_counter.h"

static uint64_t last_monotonic_time;

static char *progname;

static void print_usage(void)
{
    fprintf(stderr, "%s - net_port service proxy utilities.\n", progname);
    fprintf(stderr, "Version %s.\n", VERSION);
    fprintf(stderr, "\nUsage: %s [options]\n", progname);
    fprintf(stderr, "Options:\n");
    fprintf(stderr, "         -h,--help         - show this help\n");
    fprintf(stderr, "         --host_in         - net_port service address\n");
    fprintf(stderr, "         -p_in             - net_port service port\n");
    fprintf(stderr, "         --host_out        - user device service address \n");
    fprintf(stderr, "         -p_out            - user device service port\n");
    fprintf(stderr, "\n");
    fprintf(stderr, "\nExamples:\n");
    fprintf(stderr, "%s --host_in 82.146.44.140 -p_in 6000 --host_out 127.0.0.1 -p_out 22\n", progname);
    fprintf(stderr, "\n");
}

int main(int argc, char** argv) {

    logMsgInit();
    logMsgOpen("logs/module_net_port.log");
    logMsg(LOG_DEBUG, "Start logger (on folder logs/module_net_port.log) ...");

    signal_init();

    proxy_server_t* settings = get_client_settings();

    sprintf(settings->input_address,"82.146.44.140");
    sprintf(settings->output_address,"127.0.0.1");
    settings->output_port = 22;

    bool show_help = true;

    progname = basename(argv[0]);

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
        if (strstr(argv[i], HOST_KEY_IN) != NULL)
        {
            if (argv[i+1] != NULL)
            {
                sscanf(argv[i+1], "%s", settings->input_address);
            }
        }
        if (strstr(argv[i], HOST_KEY_OUT) != NULL)
        {
            if (argv[i+1] != NULL)
            {
                sscanf(argv[i+1], "%s", settings->output_address);
            }  
        }
        if (strstr(argv[i], PORT_KEY_IN) != NULL)
        {
            if (argv[i+1] != NULL)
            {
                sscanf(argv[i+1], "%d", &settings->input_port);
                show_help = false;
            }
        }
        if (strstr(argv[i], PORT_KEY_OUT) != NULL)
        {
            if (argv[i+1] != NULL)
            {
                sscanf(argv[i+1], "%d", &settings->output_port);
            }  
        }
        if (strstr(argv[i], HELP_KEY_FULL) != NULL
        || strstr(argv[i], HELP_KEY) != NULL)
        {
            show_help = true;
        }
    }

    if(show_help) {
        print_usage();
        return 0;
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

        msleep(10);
    }

    return 0;
}
