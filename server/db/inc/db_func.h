#ifndef DB_FUNC_H
#define DB_FUNC_H

#include "proxy_server.h"

int32_t get_user_server_ports(int user_id, proxy_server_t** server, uint16_t *servers_count);

#endif