#include "db_func.h"
#include "db.h"

#include <libpq-fe.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <string.h>
#include <time.h>

#include "logMsg.h"

static PGconn* conn = NULL;
static PGresult  *result;

int32_t get_user_server_ports(int user_id, proxy_server_t** servers, uint16_t *servers_count)
{
    char str[128];
    uint16_t nFields, qntuples; // Столбцов/строк

    snprintf(str, sizeof(str), "select input_port,output_port from servers where user_id=%d", user_id);
    logMsg(LOG_DEBUG, str);

    result = PQexec(get_db_connection(), str);
    if (PQresultStatus(result) != PGRES_TUPLES_OK)
    {
        logMsg(LOG_ERR, "failed: %s======================================== \n\n\n", PQerrorMessage(get_db_connection()));
        PQclear(result);
        return -1;
    }

    // получаем кол-во полей выборки
    nFields = PQnfields(result);
    logMsg(LOG_DEBUG, "fields = %d", nFields);
    if (!nFields)
    {
        PQclear(result);
        return -1;
    }

    for (uint16_t i = 0; i < nFields; i++) // выводим названия полей (столбцов)
        logMsg(LOG_DEBUG, "%-15s", PQfname(result, i));

    // получаем количество строк (по сути количество устройств)
    qntuples = PQntuples(result);
    logMsg(LOG_DEBUG, "qntuples = %d\n", qntuples);
    if (!qntuples)
    {
        logMsg(LOG_ERR, "NO PORTS!");
        PQclear(result);
        return -1;
    }

    *servers_count = qntuples;

    // выделяем память под список устройств
    *servers = (proxy_server_t*)malloc(qntuples * sizeof(proxy_server_t));
    if(!*servers)
    {
        logMsg(LOG_ERR, "Memory allocation failed ======================================== \n\n\n");
        PQclear(result);
        return -1;
    }

    memset(*servers, 0, qntuples * sizeof(proxy_server_t));

    for (uint16_t i = 0; i < qntuples; i++) {
        (*servers)[i].id = i;
        logMsg(LOG_DEBUG, "id__ = %d", (*servers)[i].id);

        for (uint16_t j = 0; j < nFields; j++) {
            if (!strcmp(PQfname(result, j), "input_port"))
            {
                (*servers)[i].input_port = strtol(PQgetvalue(result, i, j), NULL, 10);
                logMsg(LOG_DEBUG, "input_port__ = %d", (*servers)[i].input_port);
            }
            if (!strcmp(PQfname(result, j), "output_port"))
            {
                (*servers)[i].output_port = strtol(PQgetvalue(result, i, j), NULL, 10);
                logMsg(LOG_DEBUG, "output_port__ = %d", (*servers)[i].output_port);
            }
        }
    }

    PQclear(result);
    return 0;
}
