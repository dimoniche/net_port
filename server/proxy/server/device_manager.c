//
// Device manager implementation for net_port system
//

#include "device_manager.h"
#include "proxy_server.h"
#include "db.h"
#include "db_func.h"
#include "logMsg.h"
#include "time_utils.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <pthread.h>
#include <arpa/inet.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <openssl/ssl.h>
#include <openssl/err.h>
#include <jansson.h>

// Global device manager state
static device_manager_config_t g_config;
static bool g_initialized = false;
static pthread_t g_control_thread;
static volatile bool g_running = false;
static SSL_CTX *g_ssl_ctx = NULL;
static int g_control_socket = -1;
pthread_mutex_t g_db_mutex = PTHREAD_MUTEX_INITIALIZER;

// Default configuration
static const device_manager_config_t DEFAULT_CONFIG = {
    .control_port = 8443,
    .port_range_start = 10000,
    .port_range_end = 60000,
    .heartbeat_interval = 30,
    .session_timeout = 3600,
    .max_devices = 50000,
    .enable_ssl = true,
    .ssl_cert_file = "",
    .ssl_key_file = "",
    .db_host = "127.0.0.1",
    .db_name = "net_port",
    .db_user = "net_port_user",
    .db_password = ""
};

// Forward declarations
static void* control_server_thread(void *arg);
static int handle_device_connection(int client_fd, struct sockaddr_in *client_addr);
static int parse_json_request(const char *json_str, json_t **root);
static int process_json_message(int client_fd, const char *json_str);
static int send_json_response(int client_fd, json_t *response);
static int create_ssl_context(void);
static void cleanup_device_manager_ssl_context(void);

// Global functions defined in this file
void* cleanup_expired_sessions_thread(void *arg);
json_t* process_registration_request(json_t *request);
json_t* process_heartbeat_request(json_t *request);
json_t* process_statistics_request(json_t *request);

/**
 * Initialize device manager with configuration
 */
int device_manager_init(const device_manager_config_t *config)
{
    if (g_initialized) {
        logMsg(LOG_WARNING, "Device manager already initialized\n");
        return 0;
    }
    
    // Use default config if none provided
    if (config == NULL) {
        memcpy(&g_config, &DEFAULT_CONFIG, sizeof(g_config));
    } else {
        memcpy(&g_config, config, sizeof(g_config));
    }
    
    logMsg(LOG_INFO, "Initializing device manager\n");
    logMsg(LOG_INFO, "  Control port: %d\n", g_config.control_port);
    logMsg(LOG_INFO, "  Port range: %d-%d\n", g_config.port_range_start, g_config.port_range_end);
    logMsg(LOG_INFO, "  SSL enabled: %s\n", g_config.enable_ssl ? "yes" : "no");
    
    // Initialize SSL if enabled
    if (g_config.enable_ssl) {
        if (create_ssl_context() != 0) {
            logMsg(LOG_ERR, "Failed to create SSL context\n");
            return -1;
        }
    }
    
    g_initialized = true;
    return 0;
}

/**
 * Start device manager control server
 */
int device_manager_start(void)
{
    if (!g_initialized) {
        logMsg(LOG_ERR, "Device manager not initialized\n");
        return -1;
    }
    
    if (g_running) {
        logMsg(LOG_WARNING, "Device manager already running\n");
        return 0;
    }
    
    // Create control socket
    g_control_socket = socket(AF_INET, SOCK_STREAM, 0);
    if (g_control_socket < 0) {
        logMsg(LOG_ERR, "Failed to create control socket: %s\n", strerror(errno));
        return -1;
    }
    
    // Set socket options
    int opt = 1;
    if (setsockopt(g_control_socket, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt)) < 0) {
        logMsg(LOG_ERR, "Failed to set socket options: %s\n", strerror(errno));
        close(g_control_socket);
        return -1;
    }
    
    // Bind to control port
    struct sockaddr_in server_addr;
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    server_addr.sin_addr.s_addr = INADDR_ANY;
    server_addr.sin_port = htons(g_config.control_port);
    
    if (bind(g_control_socket, (struct sockaddr *)&server_addr, sizeof(server_addr)) < 0) {
        logMsg(LOG_ERR, "Failed to bind to port %d: %s\n", g_config.control_port, strerror(errno));
        close(g_control_socket);
        return -1;
    }
    
    // Listen for connections
    if (listen(g_control_socket, 100) < 0) {
        logMsg(LOG_ERR, "Failed to listen on socket: %s\n", strerror(errno));
        close(g_control_socket);
        return -1;
    }
    
    logMsg(LOG_INFO, "Device manager control server listening on port %d\n", g_config.control_port);
    
    // Start control thread
    g_running = true;
    if (pthread_create(&g_control_thread, NULL, control_server_thread, NULL) != 0) {
        logMsg(LOG_ERR, "Failed to create control thread\n");
        g_running = false;
        close(g_control_socket);
        return -1;
    }
    
    // Start cleanup thread for expired sessions
    pthread_t cleanup_thread;
    if (pthread_create(&cleanup_thread, NULL, (void *(*)(void *))cleanup_expired_sessions_thread, NULL) != 0) {
        logMsg(LOG_WARNING, "Failed to create cleanup thread\n");
    } else {
        pthread_detach(cleanup_thread);
    }
    
    return 0;
}

/**
 * Control server thread function
 */
static void* control_server_thread(void *arg)
{
    (void)arg;
    
    logMsg(LOG_INFO, "Device manager control thread started\n");
    
    while (g_running) {
        struct sockaddr_in client_addr;
        socklen_t client_len = sizeof(client_addr);
        
        // Accept incoming connection
        int client_fd = accept(g_control_socket, (struct sockaddr *)&client_addr, &client_len);
        if (client_fd < 0) {
            if (g_running) {
                logMsg(LOG_ERR, "Failed to accept connection: %s\n", strerror(errno));
            }
            continue;
        }
        
        // Handle connection in a separate thread or process
        // For simplicity, we handle it inline for now
        handle_device_connection(client_fd, &client_addr);
    }
    
    logMsg(LOG_INFO, "Device manager control thread stopped\n");
    return NULL;
}

/**
 * Handle device connection
 */
static int handle_device_connection(int client_fd, struct sockaddr_in *client_addr)
{
    char client_ip[INET_ADDRSTRLEN];
    inet_ntop(AF_INET, &client_addr->sin_addr, client_ip, sizeof(client_ip));
    
    logMsg(LOG_DEBUG, "Device connection from %s:%d\n", client_ip, ntohs(client_addr->sin_port));
    
    // Set socket timeout
    struct timeval timeout = {10, 0}; // 10 seconds
    setsockopt(client_fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    
    // Read request
    char buffer[4096];
    ssize_t bytes_read = recv(client_fd, buffer, sizeof(buffer) - 1, 0);
    if (bytes_read <= 0) {
        logMsg(LOG_DEBUG, "Failed to read from device %s\n", client_ip);
        close(client_fd);
        return -1;
    }
    
    buffer[bytes_read] = '\0';
    
    // Process JSON message
    int result = process_json_message(client_fd, buffer);
    
    close(client_fd);
    return result;
}

/**
 * Process JSON message from device
 */
static int process_json_message(int client_fd, const char *json_str)
{
    json_t *root = NULL;
    json_error_t error;
    
    // Parse JSON
    root = json_loads(json_str, 0, &error);
    if (!root) {
        logMsg(LOG_ERR, "JSON parse error at line %d: %s\n", error.line, error.text);
        
        // Send error response
        json_t *response = json_object();
        json_object_set_new(response, "status", json_string("error"));
        json_object_set_new(response, "message", json_string("Invalid JSON"));
        send_json_response(client_fd, response);
        json_decref(response);
        return -1;
    }
    
    // Get message type
    json_t *type_obj = json_object_get(root, "action");
    if (!json_is_string(type_obj)) {
        logMsg(LOG_ERR, "Missing or invalid 'action' field\n");
        
        json_t *response = json_object();
        json_object_set_new(response, "status", json_string("error"));
        json_object_set_new(response, "message", json_string("Missing 'action' field"));
        send_json_response(client_fd, response);
        json_decref(root);
        json_decref(response);
        return -1;
    }
    
    const char *action = json_string_value(type_obj);
    json_t *response = NULL;
    
    // Process based on action type
    if (strcmp(action, "register") == 0) {
        response = process_registration_request(root);
    } else if (strcmp(action, "heartbeat") == 0) {
        response = process_heartbeat_request(root);
    } else if (strcmp(action, "statistics") == 0) {
        response = process_statistics_request(root);
    } else {
        logMsg(LOG_WARNING, "Unknown action: %s\n", action);
        
        response = json_object();
        json_object_set_new(response, "status", json_string("error"));
        json_object_set_new(response, "message", json_string("Unknown action"));
    }
    
    // Send response
    if (response) {
        send_json_response(client_fd, response);
        json_decref(response);
    }
    
    json_decref(root);
    return 0;
}

/**
 * Process device registration request
 */
json_t* process_registration_request(json_t *request)
{
    json_t *response = json_object();
    
    // Extract fields
    json_t *device_id_obj = json_object_get(request, "device_id");
    json_t *auth_token_obj = json_object_get(request, "auth_token");
    json_t *version_obj = json_object_get(request, "version");
    json_t *capabilities_obj = json_object_get(request, "capabilities");
    json_t *metadata_obj = json_object_get(request, "metadata");
    
    if (!json_is_string(device_id_obj) || !json_is_string(auth_token_obj)) {
        json_object_set_new(response, "status", json_string("error"));
        json_object_set_new(response, "message", json_string("Missing device_id or auth_token"));
        return response;
    }
    
    const char *device_id = json_string_value(device_id_obj);
    const char *auth_token = json_string_value(auth_token_obj);
    
    logMsg(LOG_INFO, "Device registration request: %s\n", device_id);
    
    // Authenticate device
    device_info_t device_info;
    if (device_authenticate(device_id, auth_token, &device_info) != 0) {
        json_object_set_new(response, "status", json_string("error"));
        json_object_set_new(response, "message", json_string("Authentication failed"));
        return response;
    }
    
    // Create session
    device_session_t session;
    if (device_create_session(device_id, &session) != 0) {
        json_object_set_new(response, "status", json_string("error"));
        json_object_set_new(response, "message", json_string("Failed to create session"));
        return response;
    }
    
    // Allocate port
    uint16_t assigned_port = allocate_port_for_device(device_id, session.session_token, 0);
    if (assigned_port == 0) {
        json_object_set_new(response, "status", json_string("error"));
        json_object_set_new(response, "message", json_string("No ports available"));
        return response;
    }
    
    // Create dynamic proxy server for the device
    if (create_dynamic_server_for_device(device_id, assigned_port, &device_info) < 0) {
        logMsg(LOG_WARNING, "Failed to create dynamic server for device %s on port %d, but registration succeeded\n",
               device_id, assigned_port);
        // Continue anyway - device is registered but no proxy server
    }
    
    // Build success response
    json_object_set_new(response, "status", json_string("authenticated"));
    json_object_set_new(response, "assigned_port", json_integer(assigned_port));
    json_object_set_new(response, "session_token", json_string(session.session_token));
    json_object_set_new(response, "heartbeat_interval", json_integer(g_config.heartbeat_interval));
    json_object_set_new(response, "server_time", json_integer(time(NULL)));
    
    // Add device info if available
    if (device_info.internal_address[0] != '\0') {
        json_object_set_new(response, "internal_address", json_string(device_info.internal_address));
    }
    if (device_info.internal_port != 0) {
        json_object_set_new(response, "internal_port", json_integer(device_info.internal_port));
    }
    
    logMsg(LOG_INFO, "Device %s registered, assigned port %d\n", device_id, assigned_port);
    
    return response;
}

/**
 * Process device heartbeat request
 */
json_t* process_heartbeat_request(json_t *request)
{
    json_t *response = json_object();
    
    json_t *session_token_obj = json_object_get(request, "session_token");
    if (!json_is_string(session_token_obj)) {
        json_object_set_new(response, "status", json_string("error"));
        json_object_set_new(response, "message", json_string("Missing session_token"));
        return response;
    }
    
    const char *session_token = json_string_value(session_token_obj);
    
    // Update heartbeat
    if (update_device_heartbeat(session_token) != 0) {
        json_object_set_new(response, "status", json_string("error"));
        json_object_set_new(response, "message", json_string("Invalid session token"));
        return response;
    }
    
    // Update statistics if provided
    json_t *stats_obj = json_object_get(request, "statistics");
    if (stats_obj && json_is_object(stats_obj)) {
        json_t *bytes_sent_obj = json_object_get(stats_obj, "bytes_sent");
        json_t *bytes_received_obj = json_object_get(stats_obj, "bytes_received");
        json_t *connections_obj = json_object_get(stats_obj, "connections");
        
        if (json_is_integer(bytes_sent_obj) && json_is_integer(bytes_received_obj)) {
            uint64_t bytes_sent = json_integer_value(bytes_sent_obj);
            uint64_t bytes_received = json_integer_value(bytes_received_obj);
            uint32_t connections = json_is_integer(connections_obj) ? json_integer_value(connections_obj) : 0;
            
            update_device_statistics(session_token, bytes_sent, bytes_received, connections);
        }
    }
    
    json_object_set_new(response, "status", json_string("ok"));
    json_object_set_new(response, "timestamp", json_integer(time(NULL)));
    
    return response;
}

/**
 * Process device statistics request
 */
json_t* process_statistics_request(json_t *request)
{
    json_t *response = json_object();
    
    json_t *session_token_obj = json_object_get(request, "session_token");
    if (!json_is_string(session_token_obj)) {
        json_object_set_new(response, "status", json_string("error"));
        json_object_set_new(response, "message", json_string("Missing session_token"));
        return response;
    }
    
    const char *session_token = json_string_value(session_token_obj);
    
    // Validate session
    device_session_t session;
    if (get_session_by_token(session_token, &session) != 0) {
        json_object_set_new(response, "status", json_string("error"));
        json_object_set_new(response, "message", json_string("Invalid session token"));
        return response;
    }
    
    // Update statistics
    json_t *bytes_sent_obj = json_object_get(request, "bytes_sent");
    json_t *bytes_received_obj = json_object_get(request, "bytes_received");
    json_t *connections_obj = json_object_get(request, "connections");
    json_t *period_obj = json_object_get(request, "period_seconds");
    
    if (json_is_integer(bytes_sent_obj) && json_is_integer(bytes_received_obj)) {
        uint64_t bytes_sent = json_integer_value(bytes_sent_obj);
        uint64_t bytes_received = json_integer_value(bytes_received_obj);
        uint32_t connections = json_is_integer(connections_obj) ? json_integer_value(connections_obj) : 0;
        uint32_t period = json_is_integer(period_obj) ? json_integer_value(period_obj) : 60;
        
        update_device_statistics(session_token, bytes_sent, bytes_received, connections);
    }
    
    json_object_set_new(response, "status", json_string("ok"));
    json_object_set_new(response, "timestamp", json_integer(time(NULL)));
    
    return response;
}

/**
 * Send JSON response to client
 */
static int send_json_response(int client_fd, json_t *response)
{
    char *json_str = json_dumps(response, JSON_COMPACT);
    if (!json_str) {
        logMsg(LOG_ERR, "Failed to serialize JSON response\n");
        return -1;
    }
    
    // Send response
    size_t len = strlen(json_str);
    ssize_t sent = send(client_fd, json_str, len, 0);
    if (sent != (ssize_t)len) {
        logMsg(LOG_ERR, "Failed to send response: %s\n", strerror(errno));
        free(json_str);
        return -1;
    }
    
    free(json_str);
    return 0;
}

/**
 * Authenticate device using database
 */
int device_authenticate(const char *device_id, const char *auth_token, device_info_t *device_info)
{
    pthread_mutex_lock(&g_db_mutex);
    
    PGconn *conn = get_db_connection();
    if (!conn) {
        logMsg(LOG_ERR, "Failed to get database connection\n");
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }
    
    // Call PostgreSQL function to validate device auth
    char query[512];
    snprintf(query, sizeof(query),
             "SELECT * FROM validate_device_auth('%s', '%s')",
             device_id, auth_token);
    
    PGresult *res = PQexec(conn, query);
    if (PQresultStatus(res) != PGRES_TUPLES_OK) {
        logMsg(LOG_ERR, "Database query failed: %s\n", PQerrorMessage(conn));
        PQclear(res);
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }
    
    // Check if authentication succeeded
    if (PQntuples(res) == 0) {
        logMsg(LOG_WARNING, "Authentication failed for device %s\n", device_id);
        PQclear(res);
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }
    
    // Parse result
    char *valid_str = PQgetvalue(res, 0, 0);
    if (strcmp(valid_str, "t") != 0) {
        logMsg(LOG_WARNING, "Invalid credentials for device %s\n", device_id);
        PQclear(res);
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }
    
    // Get device information
    if (device_info) {
        memset(device_info, 0, sizeof(*device_info));
        strncpy(device_info->device_id, device_id, DEVICE_ID_MAX_LEN);
        
        char *device_uuid = PQgetvalue(res, 0, 1);
        char *device_name = PQgetvalue(res, 0, 2);
        char *device_type = PQgetvalue(res, 0, 3);
        char *user_id_str = PQgetvalue(res, 0, 4);
        
        if (device_name) strncpy(device_info->name, device_name, DEVICE_NAME_MAX_LEN);
        if (device_type) strncpy(device_info->type, device_type, 64);
        if (user_id_str) device_info->user_id = atoi(user_id_str);
        
        device_info->status = DEVICE_STATUS_ACTIVE;
    }
    
    PQclear(res);
    pthread_mutex_unlock(&g_db_mutex);
    
    logMsg(LOG_INFO, "Device %s authenticated successfully\n", device_id);
    return 0;
}

/**
 * Create device session
 */
int device_create_session(const char *device_id, device_session_t *session)
{
    if (!session) {
        return -1;
    }
    
    memset(session, 0, sizeof(*session));
    strncpy(session->device_id, device_id, DEVICE_ID_MAX_LEN);
    
    // Generate session token
    if (generate_session_token(device_id, session->session_token, SESSION_TOKEN_MAX_LEN) != 0) {
        return -1;
    }
    
    // Set session timestamps
    time_t now = time(NULL);
    session->started_at = now;
    session->last_activity = now;
    session->expires_at = now + g_config.session_timeout;
    session->status = SESSION_STATUS_ACTIVE;
    
    // Store session in database
    pthread_mutex_lock(&g_db_mutex);
    
    PGconn *conn = get_db_connection();
    if (!conn) {
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }
    
    char query[1024];
    snprintf(query, sizeof(query),
             "INSERT INTO device_sessions (device_id, session_token, started_at, expires_at, status) "
             "SELECT id, '%s', NOW(), NOW() + INTERVAL '%d seconds', 'active' "
             "FROM devices WHERE device_id = '%s'",
             session->session_token, g_config.session_timeout, device_id);
    
    PGresult *res = PQexec(conn, query);
    if (PQresultStatus(res) != PGRES_COMMAND_OK) {
        logMsg(LOG_ERR, "Failed to create session: %s\n", PQerrorMessage(conn));
        PQclear(res);
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }
    
    PQclear(res);
    pthread_mutex_unlock(&g_db_mutex);
    
    return 0;
}

/**
 * Allocate port for device
 */
uint16_t allocate_port_for_device(const char *device_id, const char *session_token, uint16_t requested_port)
{
    pthread_mutex_lock(&g_db_mutex);
    
    PGconn *conn = get_db_connection();
    if (!conn) {
        pthread_mutex_unlock(&g_db_mutex);
        return 0;
    }
    
    char query[512];
    if (requested_port == 0) {
        // Allocate any free port
        snprintf(query, sizeof(query),
                 "SELECT allocate_device_port("
                 "(SELECT id FROM devices WHERE device_id = '%s'), "
                 "(SELECT id FROM device_sessions WHERE session_token = '%s'), "
                 "NULL)", device_id, session_token);
    } else {
        // Try to allocate specific port
        snprintf(query, sizeof(query),
                 "SELECT allocate_device_port("
                 "(SELECT id FROM devices WHERE device_id = '%s'), "
                 "(SELECT id FROM device_sessions WHERE session_token = '%s'), "
                 "%d)", device_id, session_token, requested_port);
    }
    
    PGresult *res = PQexec(conn, query);
    if (PQresultStatus(res) != PGRES_TUPLES_OK) {
        logMsg(LOG_ERR, "Failed to allocate port: %s\n", PQerrorMessage(conn));
        PQclear(res);
        pthread_mutex_unlock(&g_db_mutex);
        return 0;
    }
    
    if (PQntuples(res) == 0) {
        logMsg(LOG_WARNING, "No port allocated for device %s\n", device_id);
        PQclear(res);
        pthread_mutex_unlock(&g_db_mutex);
        return 0;
    }
    
    char *port_str = PQgetvalue(res, 0, 0);
    uint16_t port = port_str ? atoi(port_str) : 0;
    
    // Update device with assigned port
    if (port != 0) {
        char update_query[256];
        snprintf(update_query, sizeof(update_query),
                 "UPDATE devices SET assigned_port = %d, status = 'active' WHERE device_id = '%s'",
                 port, device_id);
        
        PGresult *update_res = PQexec(conn, update_query);
        if (PQresultStatus(update_res) != PGRES_COMMAND_OK) {
            logMsg(LOG_ERR, "Failed to update device port: %s\n", PQerrorMessage(conn));
        }
        PQclear(update_res);
        
        // Update session with assigned port
        snprintf(update_query, sizeof(update_query),
                 "UPDATE device_sessions SET assigned_port = %d WHERE session_token = '%s'",
                 port, session_token);
        
        update_res = PQexec(conn, update_query);
        if (PQresultStatus(update_res) != PGRES_COMMAND_OK) {
            logMsg(LOG_ERR, "Failed to update session port: %s\n", PQerrorMessage(conn));
        }
        PQclear(update_res);
    }
    
    PQclear(res);
    pthread_mutex_unlock(&g_db_mutex);
    
    return port;
}

/**
 * Update device heartbeat
 */
int update_device_heartbeat(const char *session_token)
{
    pthread_mutex_lock(&g_db_mutex);
    
    PGconn *conn = get_db_connection();
    if (!conn) {
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }
    
    char query[512];
    snprintf(query, sizeof(query),
             "UPDATE device_sessions SET last_activity = NOW(), "
             "expires_at = NOW() + INTERVAL '%d seconds' "
             "WHERE session_token = '%s' AND status = 'active'",
             g_config.session_timeout, session_token);
    
    PGresult *res = PQexec(conn, query);
    if (PQresultStatus(res) != PGRES_COMMAND_OK) {
        logMsg(LOG_ERR, "Failed to update heartbeat: %s\n", PQerrorMessage(conn));
        PQclear(res);
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }
    
    // Also update device last_heartbeat
    snprintf(query, sizeof(query),
             "UPDATE devices SET last_heartbeat = NOW() "
             "WHERE id = (SELECT device_id FROM device_sessions WHERE session_token = '%s')",
             session_token);
    
    PGresult *res2 = PQexec(conn, query);
    if (PQresultStatus(res2) != PGRES_COMMAND_OK) {
        logMsg(LOG_ERR, "Failed to update device heartbeat: %s\n", PQerrorMessage(conn));
    }
    PQclear(res2);
    
    PQclear(res);
    pthread_mutex_unlock(&g_db_mutex);
    
    return 0;
}

/**
 * Generate session token
 */
int generate_session_token(const char *device_id, char *token, size_t token_len)
{
    if (!token || token_len < 64) {
        return -1;
    }
    
    // Generate random token (in production, use cryptographically secure random)
    time_t now = time(NULL);
    unsigned int seed = (unsigned int)(now ^ (uintptr_t)device_id);
    
    const char charset[] = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const size_t charset_size = sizeof(charset) - 1;
    
    for (size_t i = 0; i < token_len - 1; i++) {
        token[i] = charset[rand_r(&seed) % charset_size];
    }
    token[token_len - 1] = '\0';
    
    // Add timestamp prefix for uniqueness
    char temp[256];
    snprintf(temp, sizeof(temp), "%lx-%s", (unsigned long)now, token);
    strncpy(token, temp, token_len);
    
    return 0;
}

/**
 * Cleanup expired sessions (thread function)
 */
void* cleanup_expired_sessions_thread(void *arg)
{
    (void)arg;
    
    while (g_running) {
        sleep(300); // Run every 5 minutes
        
        if (!g_running) {
            break;
        }
        
        pthread_mutex_lock(&g_db_mutex);
        
        PGconn *conn = get_db_connection();
        if (conn) {
            // Call cleanup function
            PGresult *res = PQexec(conn, "SELECT cleanup_expired_sessions()");
            if (PQresultStatus(res) == PGRES_TUPLES_OK) {
                char *count_str = PQgetvalue(res, 0, 0);
                int count = count_str ? atoi(count_str) : 0;
                if (count > 0) {
                    logMsg(LOG_INFO, "Cleaned up %d expired sessions\n", count);
                }
            }
            PQclear(res);
        }
        
        pthread_mutex_unlock(&g_db_mutex);
    }
    
    return NULL;
}

/**
 * Create SSL context
 */
static int create_ssl_context(void)
{
    if (!g_config.enable_ssl) {
        return 0;
    }
    
    if (strlen(g_config.ssl_cert_file) == 0 || strlen(g_config.ssl_key_file) == 0) {
        logMsg(LOG_WARNING, "SSL enabled but certificate files not specified\n");
        return -1;
    }
    
    // Initialize OpenSSL
    SSL_library_init();
    SSL_load_error_strings();
    OpenSSL_add_all_algorithms();
    
    // Create SSL context
    g_ssl_ctx = SSL_CTX_new(TLS_server_method());
    if (!g_ssl_ctx) {
        logMsg(LOG_ERR, "Failed to create SSL context\n");
        return -1;
    }
    
    // Load certificate and private key
    if (SSL_CTX_use_certificate_file(g_ssl_ctx, g_config.ssl_cert_file, SSL_FILETYPE_PEM) <= 0) {
        logMsg(LOG_ERR, "Failed to load certificate file: %s\n", g_config.ssl_cert_file);
        SSL_CTX_free(g_ssl_ctx);
        g_ssl_ctx = NULL;
        return -1;
    }
    
    if (SSL_CTX_use_PrivateKey_file(g_ssl_ctx, g_config.ssl_key_file, SSL_FILETYPE_PEM) <= 0) {
        logMsg(LOG_ERR, "Failed to load private key file: %s\n", g_config.ssl_key_file);
        SSL_CTX_free(g_ssl_ctx);
        g_ssl_ctx = NULL;
        return -1;
    }
    
    // Verify private key matches certificate
    if (!SSL_CTX_check_private_key(g_ssl_ctx)) {
        logMsg(LOG_ERR, "Private key does not match certificate\n");
        SSL_CTX_free(g_ssl_ctx);
        g_ssl_ctx = NULL;
        return -1;
    }
    
    logMsg(LOG_INFO, "SSL context created successfully\n");
    return 0;
}

/**
 * Cleanup SSL context
 */
static void cleanup_device_manager_ssl_context(void)
{
    if (g_ssl_ctx) {
        SSL_CTX_free(g_ssl_ctx);
        g_ssl_ctx = NULL;
    }
    
    EVP_cleanup();
}

/**
 * Stop device manager
 */
int device_manager_stop(void)
{
    if (!g_running) {
        return 0;
    }
    
    logMsg(LOG_INFO, "Stopping device manager\n");
    
    g_running = false;
    
    // Close control socket to wake up accept() call
    if (g_control_socket >= 0) {
        shutdown(g_control_socket, SHUT_RDWR);
        close(g_control_socket);
        g_control_socket = -1;
    }
    
    // Wait for control thread to finish
    if (g_control_thread) {
        pthread_join(g_control_thread, NULL);
    }
    
    // Cleanup SSL
    cleanup_device_manager_ssl_context();
    
    logMsg(LOG_INFO, "Device manager stopped\n");
    return 0;
}

// Stub implementation for missing functions
int free_device_port(uint16_t port)
{
    logMsg(LOG_WARNING, "free_device_port called (stub) for port %u\n", port);
    return 0;
}

int get_session_by_token(const char *session_token, device_session_t *session)
{
    logMsg(LOG_WARNING, "get_session_by_token called (stub) for token %s\n", session_token);
    return -1; // Not found
}

int update_device_statistics(const char *session_token,
                             uint64_t bytes_sent,
                             uint64_t bytes_received,
                             uint32_t connections)
{
    logMsg(LOG_WARNING, "update_device_statistics called (stub) for token %s\n", session_token);
    return 0;
}