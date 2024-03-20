//
// Created by chistyakov_ds on 06.04.2023.
//

#include "db_ref_tables.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <libpq-fe.h>

#include "db.h"
#include "logMsg.h"
#include "db_proc.h"

#define MAX_PARAM_IN_REF_TABLE      256
#define MAX_REF_TABLES              16

typedef struct Local_RefTable_t
{
    char* name;
    int param_count;
    char* params[MAX_PARAM_IN_REF_TABLE];
} Local_RefTable_t;

static Local_RefTable_t *pReftable[MAX_REF_TABLES];
static int ref_table_cnt = 0;

#define MAX_STRING_SIZE     128

int dbRefTableImport(char* name)
{
    int ret_val = -1;
    Local_RefTable_t* ptr = calloc(1, sizeof(Local_RefTable_t));

    if (ptr == NULL) {
        return -1;
    }

    ptr->name = malloc(strlen(name) + 2);
    if (ptr->name == NULL) {
        free(ptr);
        return -1;
    }

    char str[128];
    snprintf(str, sizeof(str), "SELECT * FROM %s", name);//, i);
    logMsg(LOG_DEBUG, "str: %s", str);
    PGconn* conn = get_db_connection();
    if (conn == NULL) {
        free(ptr->name);
        free(ptr);
        return -1;
    }

    PGresult* res = PQexec(conn, str);
    dbCheckResult(res, PGRES_TUPLES_OK);

    int nFields = PQnfields(res);
    if (nFields != 2)
    {
        logMsg(LOG_ERR, "Wrong table format");

        free(ptr->name);
        free(ptr);
        return -1;
    }

    int qntuples = PQntuples(res);
    if (!qntuples)
    {
        PQclear(res);

        free(ptr->name);
        free(ptr);
        return -1;
    }

    char* param;
    unsigned int param_len;
    char* tmp;
    for (int i = 0; i < qntuples; i++)
    {
        long long int id = -1;
        for (int j = 0; j < nFields; j++)
        {
            if (!strcmp(PQfname(res, j), "id"))
            {
                id = strtoll(PQgetvalue(res, i, j), NULL, 10);
            }
            else
            {
                param = PQgetvalue(res, i, j);
                param_len = strlen(param) + 1;

                if (param_len > MAX_STRING_SIZE)
                {
                    logMsg(LOG_ERR, "Error string size");

                    PQclear(res);

                    free(ptr->name);
                    free(ptr);
                    return -1;
                }
                if (id < 0 || id > MAX_PARAM_IN_REF_TABLE)
                {
                    logMsg(LOG_ERR, "Error maximum parameters in table");

                    PQclear(res);

                    free(ptr->name);
                    free(ptr);
                    return -1;
                }
                tmp = malloc((size_t)MAX_STRING_SIZE);

                if(tmp == NULL) {

                    PQclear(res);

                    free(ptr->name);
                    free(ptr);
                    free(tmp);

                    return -1;
                }

                ptr->params[(id > 255) ? 255 : id] = tmp;
                strncpy(ptr->params[(id > 255) ? 255 : id], param, strlen(param) + 1);
                ptr->param_count++;
            }
        }
    }

    PQclear(res);

    strncpy(ptr->name, name, strlen(name) + 1);
    pReftable[ref_table_cnt] = ptr;
    ret_val = ref_table_cnt;
    ref_table_cnt++;
    return ret_val;
}

char* dbRefTableGetParamName(char* table_name, int index)
{
    int index_table = -1;
    for (int i = 0; i < ref_table_cnt; i++)
        if (!strcmp(pReftable[i]->name, table_name))
            index_table = i;

    if (index_table < 0)
        index_table = dbRefTableImport(table_name);

    if (index_table < 0)
        return NULL;

    return pReftable[index_table]->params[index];
}
