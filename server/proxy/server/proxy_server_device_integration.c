//
// Device management integration for proxy_server
//

#define _XOPEN_SOURCE 700
#include "proxy_server.h"
#include "device_manager.h"
#include "logMsg.h"

#include <string.h>

static device_manager_config_t g_device_config;
static bool g_device_manager_enabled = false;

static int init_device_manager_from_config(uint16_t device_control_port,
                                           const char *cert_file,
                                           const char *key_file)
{
    memset(&g_device_config, 0, sizeof(g_device_config));

    g_device_config.control_port = device_control_port;
    g_device_config.port_range_start = 6000;
    g_device_config.port_range_end = 7000;
    g_device_config.heartbeat_interval = 30;
    g_device_config.session_timeout = 3600;
    g_device_config.max_devices = 1001;
    g_device_config.enable_ssl = false;

    if (cert_file && cert_file[0] != '\0') {
        strncpy(g_device_config.ssl_cert_file, cert_file, sizeof(g_device_config.ssl_cert_file) - 1);
    }
    if (key_file && key_file[0] != '\0') {
        strncpy(g_device_config.ssl_key_file, key_file, sizeof(g_device_config.ssl_key_file) - 1);
    }

    if (g_device_config.ssl_cert_file[0] != '\0' && g_device_config.ssl_key_file[0] != '\0') {
        g_device_config.enable_ssl = true;
    }

    strncpy(g_device_config.db_host, "127.0.0.1", sizeof(g_device_config.db_host));
    strncpy(g_device_config.db_name, "net_port", sizeof(g_device_config.db_name));
    strncpy(g_device_config.db_user, "net_port_user", sizeof(g_device_config.db_user));

    if (device_manager_init(&g_device_config) != 0) {
        logMsg(LOG_ERR, "Failed to initialize device manager\n");
        return -1;
    }

    g_device_manager_enabled = true;
    logMsg(LOG_INFO, "Device manager initialized (control port %u, ports %u-%u)\n",
           g_device_config.control_port,
           g_device_config.port_range_start,
           g_device_config.port_range_end);
    return 0;
}

int servers_init_with_device_management(uint32_t user_id,
                                        const char *cert_file,
                                        const char *key_file,
                                        time_t statistics_retention_period,
                                        uint16_t device_control_port)
{
    int32_t res = servers_init(user_id, cert_file, key_file, statistics_retention_period);
    if (res < 0) {
        return -1;
    }

    if (!g_device_manager_enabled) {
        if (init_device_manager_from_config(device_control_port, cert_file, key_file) != 0) {
            logMsg(LOG_WARNING, "Device manager init failed, continuing without device management\n");
            return res;
        }
    }

    if (device_manager_start() != 0) {
        logMsg(LOG_WARNING, "Failed to start device manager\n");
        g_device_manager_enabled = false;
    }

    return res;
}

void device_management_shutdown(void)
{
    if (g_device_manager_enabled) {
        device_manager_stop();
        g_device_manager_enabled = false;
    }
}

bool is_device_management_enabled(void)
{
    return g_device_manager_enabled;
}
