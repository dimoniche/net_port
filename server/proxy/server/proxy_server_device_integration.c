//
// Modified proxy_server.c with device management integration
// This file shows the key modifications needed to integrate device management
//

#include "proxy_server.h"
#include "device_manager.h"
#include "db.h"
#include "db_proc.h"
#include "db_func.h"
#include "logMsg.h"
#include "time_counter.h"

#include <fcntl.h>
#include <sys/time.h>
#include <stdlib.h>
#include <semaphore.h>
#include <openssl/ssl.h>
#include <openssl/err.h>
#include <pthread.h>

// Forward declarations for functions from proxy_server.c
int server_input_init(proxy_server_t *server);
int server_output_init(proxy_server_t *server);
int get_session_by_device_id(const char *device_id, device_session_t *session);
void input_server_stop(proxy_server_t *server);
void input_server_wait_stop(proxy_server_t *server);

// Global server variables (same as proxy_server.c)
static proxy_server_t* servers;
static uint16_t servers_count;
static proxy_servers_settings_t proxy_settings;

// Global device manager instance
static device_manager_config_t g_device_config;
static bool g_device_manager_enabled = false;

// Modified proxy_server_t structure (add device_id field)
// This would be added to the proxy_server_t struct in proxy_server.h:
/*
typedef struct proxy_server_s
{
    uint16_t id;
    bool enable;
    
    // Device management fields
    char device_id[DEVICE_ID_MAX_LEN + 1];
    char session_token[SESSION_TOKEN_MAX_LEN + 1];
    bool is_dynamic_port; // True if port is dynamically allocated
    
    // ... existing fields ...
}
*/

// Function to initialize device manager from server configuration
static int init_device_manager_from_config(void)
{
    // Check if device management should be enabled
    // This could be based on command line arguments or configuration
    
    memset(&g_device_config, 0, sizeof(g_device_config));
    
    // Set default configuration
    g_device_config.control_port = 8443;
    g_device_config.port_range_start = 10000;
    g_device_config.port_range_end = 60000;
    g_device_config.heartbeat_interval = 30;
    g_device_config.session_timeout = 3600;
    g_device_config.max_devices = 50000;
    g_device_config.enable_ssl = true;
    
    // These should be loaded from configuration
    strncpy(g_device_config.ssl_cert_file, "/path/to/cert.pem", sizeof(g_device_config.ssl_cert_file));
    strncpy(g_device_config.ssl_key_file, "/path/to/key.pem", sizeof(g_device_config.ssl_key_file));
    
    // Database configuration (should match main server config)
    strncpy(g_device_config.db_host, "127.0.0.1", sizeof(g_device_config.db_host));
    strncpy(g_device_config.db_name, "net_port", sizeof(g_device_config.db_name));
    strncpy(g_device_config.db_user, "net_port_user", sizeof(g_device_config.db_user));
    strncpy(g_device_config.db_password, "", sizeof(g_device_config.db_password));
    
    // Initialize device manager
    if (device_manager_init(&g_device_config) != 0) {
        logMsg(LOG_ERR, "Failed to initialize device manager\n");
        return -1;
    }
    
    g_device_manager_enabled = true;
    logMsg(LOG_INFO, "Device manager initialized\n");
    
    return 0;
}

// Modified server initialization to support device management
int servers_init_with_device_management(uint32_t user_id, const char* cert_file, const char* key_file, time_t statistics_retention_period)
{
    int32_t res = get_user_server_ports(user_id, &servers, &servers_count);
    
    if(res < 0) {
        logMsg(LOG_ERR, "Error reading switcher servers\n");
        exit_nicely(get_db_connection());
        return -1;
    }
    
    // Initialize device manager if not already initialized
    if (!g_device_manager_enabled) {
        if (init_device_manager_from_config() != 0) {
            logMsg(LOG_WARNING, "Device manager initialization failed, continuing without device management\n");
        }
    }
    
    // Start device manager if enabled
    if (g_device_manager_enabled) {
        if (device_manager_start() != 0) {
            logMsg(LOG_WARNING, "Failed to start device manager, continuing without device management\n");
            g_device_manager_enabled = false;
        } else {
            logMsg(LOG_INFO, "Device manager started on port %d\n", g_device_config.control_port);
        }
    }
    
    memset(proxy_settings.local_address, 0, sizeof(proxy_settings.local_address));
    strncpy(proxy_settings.local_address, "127.0.0.1", 16);
    proxy_settings.statistics_retention_period = statistics_retention_period;
    
    // Initialize semaphore for statistics
    if (sem_init(&statistics_semaphore, 0, 1) != 0) {
        logMsg(LOG_ERR, "Failed to initialize statistics semaphore\n");
        exit_nicely(get_db_connection());
        return -1;
    }
    
    // Initialize OpenSSL before creating SSL contexts
    init_openssl();
    
    for(int i = 0; i < servers_count; i++)
    {
        if(!servers[i].enable) continue;
        
        // Save certificate paths for each server
        if (cert_file) {
            strncpy(servers[i].cert_file, cert_file, sizeof(servers[i].cert_file) - 1);
            servers[i].cert_file[sizeof(servers[i].cert_file) - 1] = '\0';
        } else {
            servers[i].cert_file[0] = '\0';
        }
        
        if (key_file) {
            strncpy(servers[i].key_file, key_file, sizeof(servers[i].key_file) - 1);
            servers[i].key_file[sizeof(servers[i].key_file) - 1] = '\0';
        } else {
            servers[i].key_file[0] = '\0';
        }
        
        // Initialize SSL if needed
        init_ssl_context(&servers[i]);
        
        // Check if this is a dynamic port (device-managed)
        // This would require checking the database or configuration
        servers[i].is_dynamic_port = false;
        servers[i].device_id[0] = '\0';
        servers[i].session_token[0] = '\0';
        
        if(server_input_init(&servers[i]) < 0) {
            servers[i].is_input_enabled = false;
        } else {
            servers[i].is_input_enabled = true;
        }
        
        if(server_output_init(&servers[i]) < 0) {
            servers[i].is_output_enabled = false;
        } else {
            servers[i].is_output_enabled = true;
        }
    }
    
    return res;
}

// Function to dynamically create a server for a device
int create_dynamic_server_for_device(const char *device_id, uint16_t port)
{
    if (!g_device_manager_enabled) {
        logMsg(LOG_ERR, "Device manager not enabled\n");
        return -1;
    }
    
    // Check if device exists and is authorized
    device_info_t device_info;
    if (device_authenticate(device_id, "", &device_info) != 0) {
        logMsg(LOG_ERR, "Device %s not authenticated\n", device_id);
        return -1;
    }
    
    // Create new server entry
    proxy_server_t *new_servers = realloc(servers, (servers_count + 1) * sizeof(proxy_server_t));
    if (!new_servers) {
        logMsg(LOG_ERR, "Failed to allocate memory for dynamic server\n");
        return -1;
    }
    
    servers = new_servers;
    int index = servers_count;
    servers_count++;
    
    // Initialize new server
    memset(&servers[index], 0, sizeof(proxy_server_t));
    
    servers[index].id = index;
    servers[index].enable = true;
    servers[index].input_port = port; // Dynamic port assigned to device
    servers[index].output_port = device_info.internal_port;
    servers[index].is_input_enabled = true;
    servers[index].is_output_enabled = true;
    servers[index].enable_output_ssl = false; // Configurable
    servers[index].enable_input_ssl = false;  // Configurable
    servers[index].is_dynamic_port = true;
    
    strncpy(servers[index].device_id, device_id, DEVICE_ID_MAX_LEN);
    
    // Initialize statistics
    servers[index].statistics.bytes_received = 0;
    servers[index].statistics.bytes_sent = 0;
    servers[index].statistics.connections_count = 0;
    servers[index].statistics.last_update = time(NULL);
    
    // Initialize SSL context if needed
    init_ssl_context(&servers[index]);
    
    // Initialize sockets
    if (server_input_init(&servers[index]) < 0) {
        servers[index].is_input_enabled = false;
        logMsg(LOG_ERR, "Failed to initialize input socket for device %s on port %d\n", 
               device_id, port);
        return -1;
    }
    
    if (server_output_init(&servers[index]) < 0) {
        servers[index].is_output_enabled = false;
        logMsg(LOG_ERR, "Failed to initialize output socket for device %s\n", device_id);
        return -1;
    }
    
    logMsg(LOG_INFO, "Created dynamic server for device %s on port %d\n", device_id, port);
    return index;
}

// Modified connection handler to check device authorization
int handle_incoming_connection_with_device_check(SOCKET client_socket, struct sockaddr_in *client_addr, 
                                                 proxy_server_t *server)
{
    // For dynamic ports, verify the device is still active
    if (server->is_dynamic_port && server->device_id[0] != '\0') {
        // Check if device session is still valid
        device_session_t session;
        if (get_session_by_device_id(server->device_id, &session) != 0) {
            logMsg(LOG_WARNING, "Device %s session expired, rejecting connection\n", server->device_id);
            close(client_socket);
            return -1;
        }
        
        // Check if session is still active
        if (session.status != SESSION_STATUS_ACTIVE || session.expires_at < time(NULL)) {
            logMsg(LOG_WARNING, "Device %s session invalid, rejecting connection\n", server->device_id);
            close(client_socket);
            return -1;
        }
        
        // Update session activity
        update_device_heartbeat(session.session_token);
    }
    
    // Proceed with normal connection handling
    // ... existing connection handling code ...
    
    return 0;
}

// Function to get session by device ID (helper function)
int get_session_by_device_id(const char *device_id, device_session_t *session)
{
    if (!g_device_manager_enabled || !device_id || !session) {
        return -1;
    }
    
    pthread_mutex_lock(&g_db_mutex);
    
    PGconn *conn = get_db_connection();
    if (!conn) {
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }
    
    char query[512];
    snprintf(query, sizeof(query),
             "SELECT session_token, assigned_port, expires_at, status "
             "FROM device_sessions ds "
             "JOIN devices d ON ds.device_id = d.id "
             "WHERE d.device_id = '%s' AND ds.status = 'active' "
             "ORDER BY ds.started_at DESC LIMIT 1",
             device_id);
    
    PGresult *res = PQexec(conn, query);
    if (PQresultStatus(res) != PGRES_TUPLES_OK || PQntuples(res) == 0) {
        PQclear(res);
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }
    
    // Fill session information
    memset(session, 0, sizeof(*session));
    strncpy(session->device_id, device_id, DEVICE_ID_MAX_LEN);
    
    char *session_token = PQgetvalue(res, 0, 0);
    char *assigned_port_str = PQgetvalue(res, 0, 1);
    char *expires_at_str = PQgetvalue(res, 0, 2);
    char *status_str = PQgetvalue(res, 0, 3);
    
    if (session_token) strncpy(session->session_token, session_token, SESSION_TOKEN_MAX_LEN);
    if (assigned_port_str) session->assigned_port = atoi(assigned_port_str);
    if (expires_at_str) {
        // Parse timestamp (simplified)
        struct tm tm;
        memset(&tm, 0, sizeof(tm));
        strptime(expires_at_str, "%Y-%m-%d %H:%M:%S", &tm);
        session->expires_at = mktime(&tm);
    }
    
    if (status_str && strcmp(status_str, "active") == 0) {
        session->status = SESSION_STATUS_ACTIVE;
    } else {
        session->status = SESSION_STATUS_EXPIRED;
    }
    
    PQclear(res);
    pthread_mutex_unlock(&g_db_mutex);
    
    return 0;
}

// Function to cleanup dynamic servers for expired devices
void cleanup_expired_device_servers(void)
{
    if (!g_device_manager_enabled) {
        return;
    }
    
    time_t now = time(NULL);
    
    for (int i = 0; i < servers_count; i++) {
        if (servers[i].is_dynamic_port && servers[i].device_id[0] != '\0') {
            device_session_t session;
            if (get_session_by_device_id(servers[i].device_id, &session) != 0 ||
                session.status != SESSION_STATUS_ACTIVE ||
                session.expires_at < now) {
                
                // Device session expired, stop and remove this server
                logMsg(LOG_INFO, "Stopping dynamic server for expired device %s on port %d\n",
                       servers[i].device_id, servers[i].input_port);
                
                // Stop server
                input_server_stop(&servers[i]);
                input_server_wait_stop(&servers[i]);
                
                // Mark as disabled
                servers[i].enable = false;
                servers[i].is_input_enabled = false;
                servers[i].is_output_enabled = false;
                
                // Free port
                free_device_port(servers[i].input_port);
                
                // Clear device info
                servers[i].device_id[0] = '\0';
                servers[i].session_token[0] = '\0';
                servers[i].is_dynamic_port = false;
            }
        }
    }
}

// Modified server stop function to cleanup device manager
int switcher_servers_stop_with_device_management(void)
{
    // Stop all servers
    for(int i = 0; i < servers_count; i++)
    {
        if(servers[i].enable)
        {
            input_server_stop(&servers[i]);
            input_server_wait_stop(&servers[i]);
        }
    }
    
    // Stop device manager if enabled
    if (g_device_manager_enabled) {
        device_manager_stop();
        g_device_manager_enabled = false;
    }
    
    // Cleanup OpenSSL
    cleanup_openssl();
    
    // Free servers array
    if(servers)
    {
        free(servers);
        servers = NULL;
    }
    servers_count = 0;
    
    // Destroy statistics semaphore
    sem_destroy(&statistics_semaphore);
    
    logMsg(LOG_DEBUG, "Servers stopped (with device management)\n");
    return 0;
}

// Statistics thread that includes device statistics
void* statistics_saver_thread_with_devices(void* arg)
{
    (void)arg;
    
    // Cleanup old statistics on first run
    cleanup_old_statistics(proxy_settings.statistics_retention_period);
    
    while(1) {
        Thread_sleep(60000); // Save statistics every minute
        
        for(int i = 0; i < servers_count; i++) {
            if(servers[i].enable) {
                save_server_statistics(&servers[i]);
                
                // For dynamic servers, also update device statistics
                if (servers[i].is_dynamic_port && servers[i].device_id[0] != '\0') {
                    // Get session for device
                    device_session_t session;
                    if (get_session_by_device_id(servers[i].device_id, &session) == 0) {
                        // Update device statistics with server statistics
                        update_device_statistics(session.session_token,
                                                servers[i].statistics.bytes_sent,
                                                servers[i].statistics.bytes_received,
                                                servers[i].statistics.connections_count);
                    }
                }
            }
        }
        
        // Cleanup expired device servers every hour
        static int cleanup_counter = 0;
        cleanup_counter++;
        if (cleanup_counter >= 60) {
            cleanup_expired_device_servers();
            cleanup_old_statistics(proxy_settings.statistics_retention_period);
            cleanup_counter = 0;
        }
    }
    
    return NULL;
}

// Main function integration example
/*
int main(int argc, char** argv) {
    // ... existing initialization ...
    
    // Parse command line arguments for device management
    bool enable_device_management = false;
    uint16_t device_control_port = 8443;
    
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--enable-device-management") == 0) {
            enable_device_management = true;
        } else if (strcmp(argv[i], "--device-control-port") == 0 && i + 1 < argc) {
            device_control_port = atoi(argv[++i]);
        }
    }
    
    // Initialize servers with device management if enabled
    if (enable_device_management) {
        servers_init_with_device_management(user_id, cert_file, key_file, statistics_retention_period);
    } else {
        servers_init(user_id, cert_file, key_file, statistics_retention_period);
    }
    
    // ... rest of main function ...
}
*/