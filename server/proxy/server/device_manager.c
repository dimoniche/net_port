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

#include <openssl/sha.h>
#include <ctype.h>

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
    .port_range_start = 6000,
    .port_range_end = 7000,
    .heartbeat_interval = 30,
    .session_timeout = 3600,
    .max_devices = 1001,
    .enable_ssl = false,
    .ssl_cert_file = "",
    .ssl_key_file = "",
    .db_host = "127.0.0.1",
    .db_name = "net_port",
    .db_user = "net_port_user",
    .db_password = ""
};

static int sha256_hex(const char *input, char *output_hex, size_t output_len);
static int register_device_session(const char *device_id, const char *client_ip,
                                     char *session_token, size_t token_len,
                                     uint16_t *input_port, uint16_t *tunnel_port);

/**
 * Compute SHA256 hex digest (matches web backend token hashing).
 */
static int sha256_hex(const char *input, char *output_hex, size_t output_len)
{
    unsigned char digest[SHA256_DIGEST_LENGTH];

    if (!input || !output_hex || output_len < (SHA256_DIGEST_LENGTH * 2 + 1)) {
        return -1;
    }

    if (!SHA256((const unsigned char *)input, strlen(input), digest)) {
        return -1;
    }

    for (size_t i = 0; i < SHA256_DIGEST_LENGTH; i++) {
        snprintf(output_hex + (i * 2), 3, "%02x", digest[i]);
    }
    output_hex[SHA256_DIGEST_LENGTH * 2] = '\0';
    return 0;
}
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
    
    json_t *device_id_obj = json_object_get(request, "device_id");
    json_t *auth_token_obj = json_object_get(request, "auth_token");
    
    if (!json_is_string(device_id_obj) || !json_is_string(auth_token_obj)) {
        json_object_set_new(response, "status", json_string("error"));
        json_object_set_new(response, "message", json_string("Missing device_id or auth_token"));
        return response;
    }
    
    const char *device_id = json_string_value(device_id_obj);
    const char *auth_token = json_string_value(auth_token_obj);
    
    logMsg(LOG_INFO, "Device registration request: %s\n", device_id);
    
    device_info_t device_info;
    if (device_authenticate(device_id, auth_token, &device_info) != 0) {
        json_object_set_new(response, "status", json_string("error"));
        json_object_set_new(response, "message", json_string("Authentication failed"));
        return response;
    }
    
    char session_token[SESSION_TOKEN_MAX_LEN + 1];
    uint16_t input_port = 0;
    uint16_t tunnel_port = 0;
    
    if (register_device_session(device_id, NULL, session_token, sizeof(session_token),
                                &input_port, &tunnel_port) != 0) {
        json_object_set_new(response, "status", json_string("error"));
        json_object_set_new(response, "message", json_string("Failed to create session"));
        return response;
    }
    
    device_info.tunnel_port = tunnel_port;
    device_info.assigned_port = input_port;
    
    if (ensure_dynamic_server_for_device(device_id, input_port, tunnel_port) < 0) {
        logMsg(LOG_WARNING, "Failed to ensure dynamic server for device %s (input=%u tunnel=%u)\n",
               device_id, input_port, tunnel_port);
    }
    
    json_object_set_new(response, "status", json_string("authenticated"));
    json_object_set_new(response, "assigned_port", json_integer(input_port));
    json_object_set_new(response, "tunnel_port", json_integer(tunnel_port));
    json_object_set_new(response, "session_token", json_string(session_token));
    json_object_set_new(response, "heartbeat_interval", json_integer(g_config.heartbeat_interval));
    json_object_set_new(response, "server_time", json_integer(time(NULL)));
    
    if (device_info.internal_address[0] != '\0') {
        json_object_set_new(response, "internal_address", json_string(device_info.internal_address));
    }
    if (device_info.internal_port != 0) {
        json_object_set_new(response, "internal_port", json_integer(device_info.internal_port));
    }
    
    logMsg(LOG_INFO, "Device %s registered: input=%u tunnel=%u\n", device_id, input_port, tunnel_port);
    
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

    device_session_t session;
    if (get_session_by_token(session_token, &session) == 0 && session.assigned_port != 0) {
        uint16_t tunnel_port = (uint16_t)(session.assigned_port + 1);
        if (ensure_dynamic_server_for_device(session.device_id, session.assigned_port, tunnel_port) < 0) {
            logMsg(LOG_WARNING, "Failed to ensure dynamic server for %s on heartbeat\n",
                   session.device_id);
        }
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
    char token_hash[SHA256_DIGEST_LENGTH * 2 + 1];

    if (!device_id || !auth_token) {
        return -1;
    }

    if (sha256_hex(auth_token, token_hash, sizeof(token_hash)) != 0) {
        return -1;
    }

    pthread_mutex_lock(&g_db_mutex);

    PGconn *conn = get_db_connection();
    if (!conn) {
        logMsg(LOG_ERR, "Failed to get database connection\n");
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }

    const char *params[2] = { device_id, token_hash };
    PGresult *res = PQexecParams(conn,
        "SELECT id::text, name, type, user_id, internal_address, internal_port, status "
        "FROM devices "
        "WHERE device_id = $1 AND auth_token_hash = $2 "
        "AND status IN ('active', 'pending', 'connecting', 'inactive')",
        2, NULL, params, NULL, NULL, 0);

    if (PQresultStatus(res) != PGRES_TUPLES_OK) {
        logMsg(LOG_ERR, "Database query failed: %s\n", PQerrorMessage(conn));
        PQclear(res);
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }

    if (PQntuples(res) == 0) {
        logMsg(LOG_WARNING, "Authentication failed for device %s\n", device_id);
        PQclear(res);
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }

    if (device_info) {
        memset(device_info, 0, sizeof(*device_info));
        strncpy(device_info->device_id, device_id, DEVICE_ID_MAX_LEN);

        char *device_name = PQgetvalue(res, 0, 1);
        char *device_type = PQgetvalue(res, 0, 2);
        char *user_id_str = PQgetvalue(res, 0, 3);
        char *internal_address = PQgetvalue(res, 0, 4);
        char *internal_port_str = PQgetvalue(res, 0, 5);
        char *status_str = PQgetvalue(res, 0, 6);

        if (device_name) strncpy(device_info->name, device_name, DEVICE_NAME_MAX_LEN);
        if (device_type) strncpy(device_info->type, device_type, 64);
        if (user_id_str) device_info->user_id = atoi(user_id_str);
        if (internal_address) strncpy(device_info->internal_address, internal_address, IP_ADDR_MAX_LEN);
        if (internal_port_str && internal_port_str[0] != '\0') {
            device_info->internal_port = (uint16_t)atoi(internal_port_str);
        }
        if (status_str && strcmp(status_str, "active") == 0) {
            device_info->status = DEVICE_STATUS_ACTIVE;
        } else {
            device_info->status = DEVICE_STATUS_PENDING;
        }
    }

    PQclear(res);
    pthread_mutex_unlock(&g_db_mutex);

    logMsg(LOG_INFO, "Device %s authenticated successfully\n", device_id);
    return 0;
}

/**
 * Register device session and allocate input/tunnel port pair in one transaction.
 */
static int register_device_session(const char *device_id, const char *client_ip,
                                   char *session_token, size_t token_len,
                                   uint16_t *input_port, uint16_t *tunnel_port)
{
    if (!device_id || !session_token || token_len < 32 || !input_port || !tunnel_port) {
        return -1;
    }

    if (generate_session_token(device_id, session_token, token_len) != 0) {
        return -1;
    }

    char timeout_str[16];
    snprintf(timeout_str, sizeof(timeout_str), "%u", g_config.session_timeout);

    const char *client_ip_param = client_ip ? client_ip : "0.0.0.0";
    const char *params[4] = { device_id, session_token, client_ip_param, timeout_str };

    pthread_mutex_lock(&g_db_mutex);

    PGconn *conn = get_db_connection();
    if (!conn) {
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }

    const char *cleanup_params[1] = { device_id };
    PGresult *cleanup_res = PQexecParams(conn,
        "SELECT cleanup_device_sessions($1)",
        1, NULL, cleanup_params, NULL, NULL, 0);
    if (cleanup_res) {
        if (PQresultStatus(cleanup_res) == PGRES_TUPLES_OK && PQntuples(cleanup_res) > 0) {
            char *freed = PQgetvalue(cleanup_res, 0, 0);
            if (freed && atoi(freed) > 0) {
                logMsg(LOG_INFO, "Released %s port(s) from previous sessions for device %s\n",
                       freed, device_id);
            }
        }
        PQclear(cleanup_res);
    }

    PGresult *res = PQexecParams(conn,
        "WITH dev AS ("
        "  SELECT id FROM devices WHERE device_id = $1 "
        "  AND status IN ('active', 'pending', 'connecting', 'inactive')"
        "), "
        "pair AS ("
        "  SELECT pa1.port AS input_port, pa2.port AS tunnel_port "
        "  FROM port_allocations pa1 "
        "  JOIN port_allocations pa2 ON pa2.port = pa1.port + 1 AND pa2.status = 'free' "
        "  WHERE pa1.status = 'free' "
        "    AND pa1.port >= 6000 AND pa1.port < 7000 "
        "    AND pa1.port % 2 = 0 "
        "    AND (pa1.expires_at IS NULL OR pa1.expires_at <= NOW()) "
        "    AND (pa2.expires_at IS NULL OR pa2.expires_at <= NOW()) "
        "  ORDER BY pa1.port "
        "  LIMIT 1 "
        "  FOR UPDATE OF pa1 SKIP LOCKED"
        "), "
        "ins AS ("
        "  INSERT INTO device_sessions (device_id, session_token, assigned_port, client_ip, expires_at, status) "
        "  SELECT dev.id, $2, pair.input_port, $3, NOW() + ($4 || ' seconds')::interval, 'active' "
        "  FROM dev, pair "
        "  RETURNING id, assigned_port"
        "), "
        "upd AS ("
        "  UPDATE port_allocations pa "
        "  SET device_id = (SELECT id FROM dev), "
        "      session_id = ins.id, "
        "      allocated_at = NOW(), "
        "      expires_at = NOW() + ($4 || ' seconds')::interval, "
        "      status = 'allocated' "
        "  FROM ins, pair "
        "  WHERE pa.port IN (pair.input_port, pair.tunnel_port) "
        "  RETURNING pa.port"
        ") "
        "SELECT pair.input_port, pair.tunnel_port FROM pair, ins",
        4, NULL, params, NULL, NULL, 0);

    if (PQresultStatus(res) != PGRES_TUPLES_OK || PQntuples(res) == 0) {
        logMsg(LOG_ERR, "Failed to register device session: %s\n", PQerrorMessage(conn));
        PQclear(res);
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }

    *input_port = (uint16_t)atoi(PQgetvalue(res, 0, 0));
    *tunnel_port = (uint16_t)atoi(PQgetvalue(res, 0, 1));

    PQclear(res);

    char input_port_str[8];
    char tunnel_port_str[8];
    snprintf(input_port_str, sizeof(input_port_str), "%u", *input_port);
    snprintf(tunnel_port_str, sizeof(tunnel_port_str), "%u", *tunnel_port);

    const char *update_params[2] = { input_port_str, device_id };
    res = PQexecParams(conn,
        "UPDATE devices SET assigned_port = $1::integer, status = 'active', updated_at = NOW() "
        "WHERE device_id = $2",
        2, NULL, update_params, NULL, NULL, 0);

    if (PQresultStatus(res) != PGRES_COMMAND_OK) {
        logMsg(LOG_ERR, "Failed to update device after registration: %s\n", PQerrorMessage(conn));
        PQclear(res);
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }
    PQclear(res);

    pthread_mutex_unlock(&g_db_mutex);
    return 0;
}

/**
 * Create device session (legacy helper, kept for compatibility)
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
        sleep(60); // Run every minute
        
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


int get_session_by_token(const char *session_token, device_session_t *session)
{
    if (!session_token || !session) {
        return -1;
    }

    pthread_mutex_lock(&g_db_mutex);

    PGconn *conn = get_db_connection();
    if (!conn) {
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }

    const char *params[1] = { session_token };
    PGresult *res = PQexecParams(conn,
        "SELECT ds.session_token, d.device_id, ds.assigned_port, "
        "EXTRACT(EPOCH FROM ds.expires_at)::bigint, ds.status, "
        "ds.bytes_sent, ds.bytes_received, ds.active_connections "
        "FROM device_sessions ds "
        "JOIN devices d ON ds.device_id = d.id "
        "WHERE ds.session_token = $1 AND ds.status = 'active'",
        1, NULL, params, NULL, NULL, 0);

    if (PQresultStatus(res) != PGRES_TUPLES_OK || PQntuples(res) == 0) {
        PQclear(res);
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }

    memset(session, 0, sizeof(*session));

    char *token = PQgetvalue(res, 0, 0);
    char *device_id = PQgetvalue(res, 0, 1);
    char *assigned_port_str = PQgetvalue(res, 0, 2);
    char *expires_at_str = PQgetvalue(res, 0, 3);
    char *status_str = PQgetvalue(res, 0, 4);

    if (token) strncpy(session->session_token, token, SESSION_TOKEN_MAX_LEN);
    if (device_id) strncpy(session->device_id, device_id, DEVICE_ID_MAX_LEN);
    if (assigned_port_str) session->assigned_port = (uint16_t)atoi(assigned_port_str);
    if (expires_at_str) session->expires_at = (time_t)atoll(expires_at_str);
    session->bytes_sent = (uint64_t)atoll(PQgetvalue(res, 0, 5));
    session->bytes_received = (uint64_t)atoll(PQgetvalue(res, 0, 6));
    session->active_connections = (uint32_t)atoi(PQgetvalue(res, 0, 7));

    if (status_str && strcmp(status_str, "active") == 0) {
        session->status = SESSION_STATUS_ACTIVE;
    } else {
        session->status = SESSION_STATUS_EXPIRED;
    }

    PQclear(res);
    pthread_mutex_unlock(&g_db_mutex);
    return 0;
}

int update_device_statistics(const char *session_token,
                             uint64_t bytes_sent,
                             uint64_t bytes_received,
                             uint32_t connections)
{
    if (!session_token) {
        return -1;
    }

    pthread_mutex_lock(&g_db_mutex);

    PGconn *conn = get_db_connection();
    if (!conn) {
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }

    char bytes_sent_str[32];
    char bytes_received_str[32];
    char connections_str[16];
    snprintf(bytes_sent_str, sizeof(bytes_sent_str), "%llu", (unsigned long long)bytes_sent);
    snprintf(bytes_received_str, sizeof(bytes_received_str), "%llu", (unsigned long long)bytes_received);
    snprintf(connections_str, sizeof(connections_str), "%u", connections);

    const char *params[4] = { bytes_sent_str, bytes_received_str, connections_str, session_token };
    PGresult *res = PQexecParams(conn,
        "UPDATE device_sessions SET "
        "bytes_sent = bytes_sent + $1::bigint, "
        "bytes_received = bytes_received + $2::bigint, "
        "active_connections = $3::integer, "
        "last_activity = NOW() "
        "WHERE session_token = $4 AND status = 'active'",
        4, NULL, params, NULL, NULL, 0);

    if (PQresultStatus(res) != PGRES_COMMAND_OK) {
        logMsg(LOG_ERR, "Failed to update device statistics: %s\n", PQerrorMessage(conn));
        PQclear(res);
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }

    PQclear(res);
    pthread_mutex_unlock(&g_db_mutex);
    return 0;
}

int free_device_port(uint16_t port)
{
    pthread_mutex_lock(&g_db_mutex);

    PGconn *conn = get_db_connection();
    if (!conn) {
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }

    char port_str[8];
    snprintf(port_str, sizeof(port_str), "%u", port);

    const char *params[1] = { port_str };
    PGresult *res = PQexecParams(conn, "SELECT free_device_port($1::integer)", 1, NULL, params, NULL, NULL, 0);

    if (PQresultStatus(res) != PGRES_TUPLES_OK) {
        logMsg(LOG_ERR, "Failed to free port %u: %s\n", port, PQerrorMessage(conn));
        PQclear(res);
        pthread_mutex_unlock(&g_db_mutex);
        return -1;
    }

    PQclear(res);
    pthread_mutex_unlock(&g_db_mutex);
    return 0;
}
