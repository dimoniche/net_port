#include <libpq-fe.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <string.h>
#include <time.h>

#include "db.h"
#include "db_proc.h"
#include "logMsg.h"
//#include "settings.h"

//#define REMOTE_DATABASE     1

static PGconn* conn = NULL;
static PGresult  *result;
static bool isInited = false;

static time_t start_time_t = 0;
static int module_id = -1;

PGconn* get_db_connection(void)
{
    if (conn == NULL)
    {
        logMsg(LOG_ERR, "DB Not Inited!!!");
        exit(-1);
        return NULL;
    }
    return conn;
}

int16_t db_init(char* ip_addr, char* port)
{
    if (conn != NULL)
        return 0;

    if (ip_addr == NULL)
    {
        logMsg(LOG_ERR, "NO IP address host. Use --host key");
        exit(-1);
    }
    else
    {
        if (port == NULL)
            port = (char*)"5432";
    }

    logMsg(LOG_DEBUG, "Start db\n");
    logMsg(LOG_DEBUG, "host: %s", ip_addr);
    logMsg(LOG_DEBUG, "port: %s", port);

    char str[2048];
    snprintf(str, 128, "host=%s port=%s dbname=net_port user=postgres password=ghbdtnjvktn", ip_addr, port);
    conn = PQconnectdb(str);

    //Check to see that the backend connection was successfully made
    if ((PQstatus(conn) != CONNECTION_OK) || (conn == NULL))
    {
        logMsg(LOG_ERR, "Connection to database failed: %s", PQerrorMessage(conn));
        exit(-1);
        return -1;
    }

    logMsg(LOG_DEBUG, "baseInit");

    isInited = true;
    return 0;
}
