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

// Внешние переменные из proxy_server.c
extern proxy_server_t* servers;
extern uint16_t servers_count;

// Объявление функции поиска индекса сервера
int find_server_index_by_id(uint16_t server_id);

static PGconn* conn = NULL;
static PGresult  *result;

static uint64_t max_u64(uint64_t a, uint64_t b)
{
    return a > b ? a : b;
}

/* Caller must hold db_lock() when using *_unlocked helpers. */
static int fetch_peak_statistic_totals_unlocked(int server_id, uint64_t *bytes_received, uint64_t *bytes_sent)
{
    char query[256];
    PGresult *res;

    snprintf(query, sizeof(query),
             "SELECT COALESCE(MAX(bytes_received), 0), COALESCE(MAX(bytes_sent), 0) "
             "FROM statistic WHERE server_id = %d",
             server_id);

    res = PQexec(get_db_connection(), query);
    if (PQresultStatus(res) != PGRES_TUPLES_OK || PQntuples(res) == 0) {
        PQclear(res);
        return -1;
    }

    *bytes_received = strtoull(PQgetvalue(res, 0, 0), NULL, 10);
    *bytes_sent = strtoull(PQgetvalue(res, 0, 1), NULL, 10);
    PQclear(res);
    return 0;
}

static int fetch_persisted_server_totals_unlocked(int server_id, uint64_t *bytes_received, uint64_t *bytes_sent)
{
    char query[256];
    PGresult *res;

    snprintf(query, sizeof(query),
             "SELECT COALESCE(total_bytes_received, 0), COALESCE(total_bytes_sent, 0) "
             "FROM servers WHERE id = %d",
             server_id);

    res = PQexec(get_db_connection(), query);
    if (PQresultStatus(res) != PGRES_TUPLES_OK || PQntuples(res) == 0) {
        PQclear(res);
        return -1;
    }

    *bytes_received = strtoull(PQgetvalue(res, 0, 0), NULL, 10);
    *bytes_sent = strtoull(PQgetvalue(res, 0, 1), NULL, 10);
    PQclear(res);
    return 0;
}

static int persist_server_totals_unlocked(proxy_server_t *server)
{
    char query[512];
    PGresult *res;

    snprintf(query, sizeof(query),
             "UPDATE servers SET "
             "total_bytes_received = GREATEST(COALESCE(total_bytes_received, 0), %lu), "
             "total_bytes_sent = GREATEST(COALESCE(total_bytes_sent, 0), %lu) "
             "WHERE id = %d",
             (unsigned long)server->statistics.bytes_received,
             (unsigned long)server->statistics.bytes_sent,
             server->id);

    res = PQexec(get_db_connection(), query);
    if (PQresultStatus(res) != PGRES_COMMAND_OK) {
        logMsg(LOG_WARNING, "Failed to persist server totals for %d: %s",
               server->id, PQerrorMessage(get_db_connection()));
        PQclear(res);
        return -1;
    }

    PQclear(res);
    return 0;
}

static void sync_all_server_totals_from_statistics(void)
{
    PGresult *res;

    db_lock();
    res = PQexec(get_db_connection(),
        "UPDATE servers s SET "
        "total_bytes_received = GREATEST("
        "  COALESCE(s.total_bytes_received, 0),"
        "  COALESCE((SELECT MAX(st.bytes_received) FROM statistic st WHERE st.server_id = s.id), 0)"
        "),"
        "total_bytes_sent = GREATEST("
        "  COALESCE(s.total_bytes_sent, 0),"
        "  COALESCE((SELECT MAX(st.bytes_sent) FROM statistic st WHERE st.server_id = s.id), 0)"
        ")");
    if (PQresultStatus(res) != PGRES_COMMAND_OK) {
        logMsg(LOG_WARNING, "Failed to sync server totals before cleanup: %s",
               PQerrorMessage(get_db_connection()));
    }
    PQclear(res);
    db_unlock();
}

// Загрузка накопительной статистики сервера (не сбрасывается при перезапуске)
int load_server_statistics(proxy_server_t *server) {
    uint64_t persisted_received = 0;
    uint64_t persisted_sent = 0;
    uint64_t peak_received = 0;
    uint64_t peak_sent = 0;

    if (fetch_persisted_server_totals_unlocked(server->id, &persisted_received, &persisted_sent) != 0) {
        persisted_received = 0;
        persisted_sent = 0;
    }

    if (fetch_peak_statistic_totals_unlocked(server->id, &peak_received, &peak_sent) != 0) {
        peak_received = 0;
        peak_sent = 0;
    }

    server->statistics.bytes_received = max_u64(persisted_received, peak_received);
    server->statistics.bytes_sent = max_u64(persisted_sent, peak_sent);
    server->statistics.connections_count = 0;
    server->statistics.last_update = time(NULL);

    if (server->statistics.bytes_received > 0 || server->statistics.bytes_sent > 0) {
        persist_server_totals_unlocked(server);
        logMsg(LOG_INFO,
               "Loaded cumulative statistics for server %d: received=%lu, sent=%lu",
               server->id,
               (unsigned long)server->statistics.bytes_received,
               (unsigned long)server->statistics.bytes_sent);
    } else {
        logMsg(LOG_INFO, "No previous statistics found for server %d, initialized to zero", server->id);
    }

    return 0;
}

int32_t get_user_server_ports(int user_id, proxy_server_t** servers, uint16_t *servers_count)
{
    char str[128];
    uint16_t nFields, qntuples; // Столбцов/строк

    snprintf(str, sizeof(str), "select id,input_port,output_port,enable,enable_ssl,enable_input_ssl from servers where user_id=%d order by id", user_id);
    logMsg(LOG_DEBUG, str);

    db_lock();
    result = PQexec(get_db_connection(), str);
    if (PQresultStatus(result) != PGRES_TUPLES_OK)
    {
        logMsg(LOG_ERR, "failed: %s======================================== \n\n\n", PQerrorMessage(get_db_connection()));
        PQclear(result);
        db_unlock();
        return -1;
    }

    // получаем кол-во полей выборки
    nFields = PQnfields(result);
    logMsg(LOG_DEBUG, "fields = %d", nFields);
    if (!nFields)
    {
        PQclear(result);
        db_unlock();
        return -1;
    }

    for (uint16_t i = 0; i < nFields; i++) // выводим названия полей (столбцов)
        logMsg(LOG_DEBUG, "%-15s", PQfname(result, i));

    // получаем количество строк (по сути количество устройств)
    qntuples = PQntuples(result);
    logMsg(LOG_DEBUG, "qntuples = %d\n", qntuples);
    if (!qntuples)
    {
        logMsg(LOG_INFO, "No legacy switcher servers configured for user %d\n", user_id);
        *servers_count = 0;
        *servers = NULL;
        PQclear(result);
        db_unlock();
        return 0;
    }

    *servers_count = qntuples;

    // выделяем память под список устройств
    *servers = (proxy_server_t*)malloc(qntuples * sizeof(proxy_server_t));
    if(!*servers)
    {
        logMsg(LOG_ERR, "Memory allocation failed ======================================== \n\n\n");
        PQclear(result);
        db_unlock();
        return -1;
    }

    memset(*servers, 0, qntuples * sizeof(proxy_server_t));

    for (uint16_t i = 0; i < qntuples; i++) {
        (*servers)[i].id = 0; // Will be set from database
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
    db_unlock();
    return 0;
}

int save_server_statistics(proxy_server_t *server)
{
    char query[512];
    uint64_t last_bytes_received = 0;
    uint64_t last_bytes_sent = 0;

    if (server->is_dynamic_port) {
        logMsg(LOG_DEBUG, "Skipping legacy statistics snapshot for dynamic server slot (device %s)\n",
               server->device_id[0] ? server->device_id : "unknown");
        return 0;
    }

    if (server->statistics.bytes_received == 0
        && server->statistics.bytes_sent == 0
        && server->statistics.connections_count == 0) {
        logMsg(LOG_DEBUG, "Skipping empty statistics snapshot for server %d\n", server->id);
        return 0;
    }

    db_lock();

    if (fetch_persisted_server_totals_unlocked(server->id, &last_bytes_received, &last_bytes_sent) == 0) {
        server->statistics.bytes_received = max_u64(server->statistics.bytes_received, last_bytes_received);
        server->statistics.bytes_sent = max_u64(server->statistics.bytes_sent, last_bytes_sent);
    } else if (fetch_peak_statistic_totals_unlocked(server->id, &last_bytes_received, &last_bytes_sent) == 0) {
        server->statistics.bytes_received = max_u64(server->statistics.bytes_received, last_bytes_received);
        server->statistics.bytes_sent = max_u64(server->statistics.bytes_sent, last_bytes_sent);
    }

    persist_server_totals_unlocked(server);
    
    // Формируем запрос на вставку статистики (накопительный итог)
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
        db_unlock();
        return -1;
    }
    
    PQclear(res);
    db_unlock();
    return 0;
}

int update_server_statistics(proxy_server_t* servers, proxy_server_t *server, uint64_t bytes_received, uint64_t bytes_sent)
{
    if (server->is_dynamic_port) {
        return 0;
    }

    // Обновляем статистику в памяти
    server->statistics.bytes_received += bytes_received;
    server->statistics.bytes_sent += bytes_sent;

    // Обновляем время последнего обновления
    server->statistics.last_update = time(NULL);

    // Защищаем доступ к статистике семафором
    sem_wait(&statistics_semaphore);

    // копируем статистику
    int server_index = find_server_index_by_id(server->id);
    if (server_index >= 0) {
        memcpy(&servers[server_index].statistics, &server->statistics, sizeof(proxy_server_statistics_t));
    }

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

int cleanup_old_statistics(time_t retention_period)
{
    char query[256];
    time_t current_time = time(NULL);
    time_t cutoff_time = current_time - retention_period;

    sync_all_server_totals_from_statistics();

    // Удаляем только исторические снимки; накопительный итог хранится в servers.total_bytes_*
    snprintf(query, sizeof(query), "DELETE FROM statistic WHERE timestamp < to_timestamp(%ld)", cutoff_time);

    logMsg(LOG_DEBUG, "Executing cleanup query: %s", query);

    db_lock();
    PGresult *res = PQexec(get_db_connection(), query);
    if (PQresultStatus(res) != PGRES_COMMAND_OK) {
        logMsg(LOG_ERR, "Failed to cleanup old statistics: %s", PQerrorMessage(get_db_connection()));
        PQclear(res);
        db_unlock();
        return -1;
    }

    int rows_affected = atoi(PQcmdTuples(res));
    logMsg(LOG_INFO, "Cleaned up %d old statistics records", rows_affected);

    PQclear(res);
    db_unlock();
    return 0;
}
