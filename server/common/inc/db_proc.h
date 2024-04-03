//
// Created by chistyakov_ds on 19.09.2022.
//

#ifndef CRYPT_SWITCHER_DB_PROC_H
#define CRYPT_SWITCHER_DB_PROC_H

#include <libpq-fe.h>
#include <stdlib.h>

#include "logMsg.h"
#include "db.h"

static void exit_nicely(PGconn *conn)
{
    logMsg(LOG_INFO, "Exit \n");

    PQfinish(conn);
    exit(1);
}

static int dbCheckResult(PGresult* res, ExecStatusType  stat)
{
    ExecStatusType read_s = PQresultStatus(res);
    if (read_s != stat)
    {
        logMsg(LOG_ERR, "Stat = %d failed: %s \n\n\n", read_s, PQerrorMessage(get_db_connection()));
        PQclear(res);
        exit_nicely(get_db_connection());
    }
    return 0;
}

//check without exiting
static int dbCheckResultNonBreaking(PGresult* res, ExecStatusType  stat)
{
    ExecStatusType read_s = PQresultStatus(res);
    if (read_s != stat)
    {
        logMsg(LOG_ERR, "Stat = %d failed: %s======================================== \n\n\n", read_s, PQerrorMessage(get_db_connection()));
        return -1;
    }
    return 0;
}

#endif //CRYPT_SWITCHER_DB_PROC_H
