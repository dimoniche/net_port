#ifndef NET_PORT_CLIENT_UPDATE_H
#define NET_PORT_CLIENT_UPDATE_H

#include <stdbool.h>

/* Returns 0 if up to date, 1 if update applied (caller should restart), 2 if update available but not applied, -1 on error. */
int client_check_and_update(int argc, char **argv, bool auto_apply);

#endif
