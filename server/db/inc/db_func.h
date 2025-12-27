#ifndef DB_FUNC_H
#define DB_FUNC_H

#include "proxy_server.h"

int32_t get_user_server_ports(int user_id, proxy_server_t** server, uint16_t *servers_count);

// Функции для работы со статистикой
int save_server_statistics(proxy_server_t *server);
int update_server_statistics(proxy_server_t* servers, proxy_server_t *server, uint64_t bytes_received, uint64_t bytes_sent);

#endif