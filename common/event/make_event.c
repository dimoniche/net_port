//
// Created by chistyakov_ds on 06.04.2023.
//

#include "make_event.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "logMsg.h"
#include "db_ref_tables.h"

int make_event_description_string(char *pDescription, int max_description_len, int source, int event)
{
    char timestamp[32];

    time_t T = time(NULL);
    struct tm tm_now = {0};

    if(localtime_r(&T,&tm_now) == NULL) {

      memset(&tm_now, 0, sizeof (tm_now));
      tm_now.tm_mday = 1;
      tm_now.tm_year = 123;
    }

    logMsg(LOG_DEBUG, "System Date is: %02d/%02d/%04d\n", tm_now.tm_mday,tm_now.tm_mon + 1, tm_now.tm_year + 1900);
    logMsg(LOG_DEBUG, "System Time is: %02d:%02d:%02d\n", tm_now.tm_hour,tm_now.tm_min, tm_now.tm_sec);

    char *src_name = dbRefTableGetParamName("list_reg_source", source);
    char *event_name = dbRefTableGetParamName("list_reg_event", event);

    if (src_name == NULL)
        src_name = "Unknown source";

    if (event_name == NULL)
        event_name = "Unknown event";

    logMsg(LOG_DEBUG, "src: %s event: %s", src_name, event_name);

    snprintf(timestamp, sizeof(timestamp), "%02d-%02d-%02d %02d:%02d:%02d",
             tm_now.tm_year + 1900, tm_now.tm_mon + 1, tm_now.tm_mday,
             tm_now.tm_hour, tm_now.tm_min, tm_now.tm_sec);

    snprintf(pDescription, max_description_len,
             "'event: %d; source: %d; timestamp: %s; comment: %s: %s at %s'",
             event, source, timestamp, src_name, event_name, timestamp);

    logMsg(LOG_DEBUG, "description: %s", pDescription);

    return 0;
}
