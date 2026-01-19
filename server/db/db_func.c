#include "db_func.h"
#include "db.h"

#include <libpq-fe.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <string.h>
#include <time.h>
#include <semaphore.h>

#include "logMsg.h"
#include "proxy_server.h"

static PGconn* conn = NULL;
static PGresult  *result;

// Функция для загрузки последней статистики сервера из БД
int load_server_statistics(proxy_server_t *server) {
    char query[256];
    
    // Формируем запрос на получение последней статистики для сервера
    snprintf(query, sizeof(query), "SELECT bytes_received, bytes_sent FROM statistic WHERE server_id = %d ORDER BY timestamp DESC LIMIT 1", server->id);
    
    logMsg(LOG_DEBUG, "Executing query: %s", query);
    
    PGresult *res = PQexec(get_db_connection(), query);
    if (PQresultStatus(res) != PGRES_TUPLES_OK) {
        logMsg(LOG_ERR, "Failed to load statistics: %s", PQerrorMessage(get_db_connection()));
        PQclear(res);
        return -1;
    }
    
    int rows = PQntuples(res);
    if (rows > 0) {
        // Если есть сохраненная статистика, загружаем ее
        const char* bytes_received_str = PQgetvalue(res, 0, 0);
        const char* bytes_sent_str = PQgetvalue(res, 0, 1);
        
        server->statistics.bytes_received = strtoull(bytes_received_str, NULL, 10);
        server->statistics.bytes_sent = strtoull(bytes_sent_str, NULL, 10);
        server->statistics.connections_count = 0; // Начинаем с 0 активных соединений
        server->statistics.last_update = time(NULL);
        
        logMsg(LOG_INFO, "Loaded statistics for server %d: received=%lu, sent=%lu",
               server->id,
               (unsigned long)server->statistics.bytes_received,
               (unsigned long)server->statistics.bytes_sent);
    } else {
        // Если нет сохраненной статистики, инициализируем с нуля
        server->statistics.bytes_received = 0;
        server->statistics.bytes_sent = 0;
        server->statistics.connections_count = 0;
        server->statistics.last_update = time(NULL);
        
        logMsg(LOG_INFO, "No previous statistics found for server %d, initialized to zero", server->id);
    }
    
    PQclear(res);
    return 0;
}

int32_t get_user_server_ports(int user_id, proxy_server_t** servers, uint16_t *servers_count)
{
    char str[128];
    uint16_t nFields, qntuples; // Столбцов/строк

    snprintf(str, sizeof(str), "select id,input_port,output_port,enable,enable_ssl,enable_input_ssl from servers where user_id=%d order by id", user_id);
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
        (*servers)[i].enable = true;

        for (uint16_t j = 0; j < nFields; j++) {
            const char* fieldName = PQfname(result, j);
            const char* fieldValue = PQgetvalue(result, i, j);

            if (!strcmp(fieldName, "id")) {
                (*servers)[i].id = strtol(fieldValue, NULL, 10);
                logMsg(LOG_DEBUG, "id__ = %d", (*servers)[i].id);
            } else if (!strcmp(fieldName, "input_port")) {
                (*servers)[i].input_port = strtol(fieldValue, NULL, 10);
                logMsg(LOG_DEBUG, "input_port__ = %d", (*servers)[i].input_port);
            } else if (!strcmp(fieldName, "output_port")) {
                (*servers)[i].output_port = strtol(fieldValue, NULL, 10);
                logMsg(LOG_DEBUG, "output_port__ = %d", (*servers)[i].output_port);
            } else if (!strcmp(fieldName, "enable")) {
                (*servers)[i].enable = (strcmp(fieldValue, "f") != 0);
                logMsg(LOG_DEBUG, "enable = %d", (*servers)[i].enable);
            } else if (!strcmp(fieldName, "enable_ssl")) {
                (*servers)[i].enable_output_ssl = (strcmp(fieldValue, "t") == 0);
                logMsg(LOG_DEBUG, "enable_output_ssl = %d", (*servers)[i].enable_output_ssl);
            } else if (!strcmp(fieldName, "enable_input_ssl")) {
                (*servers)[i].enable_input_ssl = (strcmp(fieldValue, "t") == 0);
                logMsg(LOG_DEBUG, "enable_input_ssl = %d", (*servers)[i].enable_input_ssl);
            }
        }

        // Загружаем предыдущую статистику из базы данных
        load_server_statistics(&(*servers)[i]);
    }

    PQclear(result);
    return 0;
}

int save_server_statistics(proxy_server_t *server)
{
    char query[512];
    
    // Формируем запрос на вставку статистики
    snprintf(query, sizeof(query), "INSERT INTO statistic (server_id, bytes_received, bytes_sent, connections_count) VALUES (%d, %lu, %lu, %d)",
             server->id, 
             (unsigned long)server->statistics.bytes_received,
             (unsigned long)server->statistics.bytes_sent,
             server->statistics.connections_count);
    
    logMsg(LOG_DEBUG, "Executing query: %s", query);
    
    PGresult *res = PQexec(get_db_connection(), query);
    if (PQresultStatus(res) != PGRES_COMMAND_OK) {
        logMsg(LOG_ERR, "Failed to save statistics: %s", PQerrorMessage(get_db_connection()));
        PQclear(res);
        return -1;
    }
    
    PQclear(res);
    return 0;
}

int update_server_statistics(proxy_server_t* servers, proxy_server_t *server, uint64_t bytes_received, uint64_t bytes_sent)
{
    // Обновляем статистику в памяти
    server->statistics.bytes_received += bytes_received;
    server->statistics.bytes_sent += bytes_sent;

    // Обновляем время последнего обновления
    server->statistics.last_update = time(NULL);

    // Защищаем доступ к статистике семафором
    sem_wait(&statistics_semaphore);

    // копируем статистику
    memcpy(&servers[server->id].statistics, &server->statistics, sizeof(proxy_server_statistics_t));

    // Освобождаем семафор
    sem_post(&statistics_semaphore);

    // Логируем обновление статистики
    logMsg(LOG_DEBUG, "Updated statistics for server %d: received=%lu, sent=%lu, connections=%d",
           server->id,
           (unsigned long)server->statistics.bytes_received,
           (unsigned long)server->statistics.bytes_sent,
           server->statistics.connections_count);

    return 0;
}
