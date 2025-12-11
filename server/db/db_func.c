#include "db_func.h"
#include "db.h"

#include <libpq-fe.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <string.h>

#include "logMsg.h"

static PGconn* conn = NULL;
static PGresult  *result;

int32_t get_user_server_ports(int user_id, proxy_server_t** servers, uint16_t *servers_count)
{
    char str[128];
    uint16_t nFields, qntuples; // Столбцов/строк

    // Проверяем наличие поля enable_ssl в таблице servers
    const char* checkFieldQuery = "SELECT column_name FROM information_schema.columns WHERE table_name='servers' AND column_name='enable_ssl'";
    PGresult* checkResult = PQexec(get_db_connection(), checkFieldQuery);
    bool hasSSLField = (PQntuples(checkResult) > 0);
    PQclear(checkResult);

    // Если поле отсутствует - добавляем его
    if (!hasSSLField) {
        const char* addFieldQuery = "ALTER TABLE servers ADD COLUMN enable_ssl BOOLEAN DEFAULT FALSE";
        PGresult* addResult = PQexec(get_db_connection(), addFieldQuery);
        if (PQresultStatus(addResult) != PGRES_COMMAND_OK) {
            logMsg(LOG_ERR, "Failed to add enable_ssl column: %s", PQerrorMessage(get_db_connection()));
        }
        PQclear(addResult);
    }

    snprintf(str, sizeof(str), "select input_port,output_port,enable,enable_ssl from servers where user_id=%d", user_id);
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
        (*servers)[i].enable = true;

        for (uint16_t j = 0; j < nFields; j++) {
            const char* fieldName = PQfname(result, j);
            const char* fieldValue = PQgetvalue(result, i, j);

            if (!strcmp(fieldName, "input_port")) {
                (*servers)[i].input_port = strtol(fieldValue, NULL, 10);
                logMsg(LOG_DEBUG, "input_port__ = %d", (*servers)[i].input_port);
            } else if (!strcmp(fieldName, "output_port")) {
                (*servers)[i].output_port = strtol(fieldValue, NULL, 10);
                logMsg(LOG_DEBUG, "output_port__ = %d", (*servers)[i].output_port);
            } else if (!strcmp(fieldName, "enable")) {
                (*servers)[i].enable = (strcmp(fieldValue, "f") != 0);
                logMsg(LOG_DEBUG, "enable = %d", (*servers)[i].enable);
            } else if (!strcmp(fieldName, "enable_ssl")) {
                (*servers)[i].enable_ssl = (strcmp(fieldValue, "t") == 0);
                logMsg(LOG_DEBUG, "enable_ssl = %d", (*servers)[i].enable_ssl);
            }
        }
    }

    PQclear(result);
    return 0;
}
