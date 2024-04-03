//
// Created by chistyakov_ds on 19.09.2022.
//

#ifndef CRYPT_SWITCHER_SETTINGS_H
#define CRYPT_SWITCHER_SETTINGS_H

#include "VersionInfo.h"

#define VERBOSE_KEY             "-v"
#define HOST_KEY                "--host"
#define PORT_KEY                "-p"

#define HOST_KEY_IN                "--host_in"
#define PORT_KEY_IN                "-p_in"

#define HOST_KEY_OUT                "--host_out"
#define PORT_KEY_OUT                "-p_out"

#define MODULE_NAME                             "'net_port'"
#define VERSION PRODUCT_VERSION_MAJOR_MINOR_PATCH_STR

#define MODULE_ACTIVITY_MINIMUM_TIME_SEC        (60U * 4)

#endif //CRYPT_SWITCHER_SETTINGS_H
