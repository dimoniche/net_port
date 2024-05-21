//
// Created by chistyakov_ds on 19.09.2022.
//

#ifndef CRYPT_SWITCHER_SETTINGS_H
#define CRYPT_SWITCHER_SETTINGS_H

#include "VersionInfo.h"

#define VERBOSE_KEY             "-v"
#define HOST_KEY                "--host"
#define PORT_KEY                "-p"

#define USER_ID                "--user"

#define MODULE_NAME                             "'net_port'"
#define VERSION PRODUCT_VERSION_MAJOR_MINOR_PATCH_STR

#define MODULE_ACTIVITY_MINIMUM_TIME_SEC        (60U * 4)

#endif //CRYPT_SWITCHER_SETTINGS_H
