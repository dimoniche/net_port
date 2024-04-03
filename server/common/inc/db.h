//
// Created by chistyakov_ds on 19.09.2022.
//

#ifndef CRYPT_SWITCHER_DB_H
#define CRYPT_SWITCHER_DB_H

#include <libpq-fe.h>
#include <stdint.h>
#include <stdbool.h>

typedef struct _TDBConnectionData
{
    char* ip;
    char* port;

}TDBConnectionData;

PGconn* get_db_connection(void);
int16_t db_init(char* ip_addr, char* port);

#endif //CRYPT_SWITCHER_DB_H
