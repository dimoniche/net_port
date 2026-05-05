//
// Modified proxy_client.c with device registration integration
//

#include "proxy_client.h"
#include "device_heartbeat.h"
#include "logMsg.h"
#include "time_counter.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <pthread.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <openssl/ssl.h>
#include <openssl/err.h>
#include <jansson.h>

// Device registration state
static device_registration_state_t g_device_state;
static bool g_device_registration_enabled = false;
static heartbeat_config_t g_heartbeat_config;

/**
 * Initialize device registration
 */
int device_registration_init(const char *device_id, const char *auth_token,
                             const char *server_host, uint16_t server_port)
{
    if (!device_id || !auth_token || !server_host) {
        logMsg(LOG_ERR, "Invalid device registration parameters\n");
        return -1;
    }
    
    memset(&g_device_state, 0, sizeof(g_device_state));
    
    strncpy(g_device_state.device_id, device_id, DEVICE_ID_MAX_LEN);
    strncpy(g_device_state.auth_token, auth_token, AUTH_TOKEN_MAX_LEN);
    strncpy(g_device_state.server_host, server_host, SERVER_HOST_MAX_LEN);
    g_device_state.server_port = server_port;
    g_device_state.status = DEVICE_STATUS_DISCONNECTED;
    
    // Initialize heartbeat configuration
    memset(&g_heartbeat_config, 0, sizeof(g_heartbeat_config));
    strncpy(g_heartbeat_config.device_id, device_id, DEVICE_ID_MAX_LEN);
    strncpy(g_heartbeat_config.auth_token, auth_token, AUTH_TOKEN_MAX_LEN);
    strncpy(g_heartbeat_config.server_host, server_host, SERVER_HOST_MAX_LEN);
    g_heartbeat_config.server_port = server_port;
    g_heartbeat_config.heartbeat_interval = 30;
    g_heartbeat_config.heartbeat_timeout = 90;
    g_heartbeat_config.connection_timeout = 10;
    g_heartbeat_config.max_failures = 3;
    g_heartbeat_config.enable_ssl = true;
    g_heartbeat_config.ssl_ctx = NULL; // Will be set later
    
    g_device_registration_enabled = true;
    
    logMsg(LOG_INFO, "Device registration initialized for device %s\n", device_id);
    logMsg(LOG_INFO, "  Server: %s:%d\n", server_host, server_port);
    
    return 0;
}

/**
 * Register device with server
 */
int device_register_with_server(void)
{
    if (!g_device_registration_enabled) {
        logMsg(LOG_ERR, "Device registration not enabled\n");
        return -1;
    }
    
    logMsg(LOG_INFO, "Registering device %s with server...\n", g_device_state.device_id);
    
    int sock = -1;
    SSL *ssl = NULL;
    int result = -1;
    
    // Create socket
    sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock < 0) {
        logMsg(LOG_ERR, "Failed to create socket for registration: %s\n", strerror(errno));
        return -1;
    }
    
    // Set timeout
    struct timeval timeout = {10, 0}; // 10 seconds
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
    
    // Connect to server
    struct sockaddr_in server_addr;
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(g_device_state.server_port);
    
    if (inet_pton(AF_INET, g_device_state.server_host, &server_addr.sin_addr) <= 0) {
        logMsg(LOG_ERR, "Invalid server address: %s\n", g_device_state.server_host);
        close(sock);
        return -1;
    }
    
    if (connect(sock, (struct sockaddr *)&server_addr, sizeof(server_addr)) < 0) {
        logMsg(LOG_ERR, "Failed to connect to registration server: %s\n", strerror(errno));
        close(sock);
        return -1;
    }
    
    // Setup SSL
    SSL_CTX *ssl_ctx = create_client_ssl_context(NULL); // Use default CA
    if (!ssl_ctx) {
        logMsg(LOG_ERR, "Failed to create SSL context\n");
        close(sock);
        return -1;
    }
    
    ssl = SSL_new(ssl_ctx);
    if (!ssl) {
        logMsg(LOG_ERR, "Failed to create SSL object\n");
        SSL_CTX_free(ssl_ctx);
        close(sock);
        return -1;
    }
    
    SSL_set_fd(ssl, sock);
    
    if (SSL_connect(ssl) != 1) {
        logMsg(LOG_ERR, "SSL connection failed: %s\n", ERR_error_string(ERR_get_error(), NULL));
        SSL_free(ssl);
        SSL_CTX_free(ssl_ctx);
        close(sock);
        return -1;
    }
    
    // Build registration request
    json_t *request = json_object();
    json_object_set_new(request, "action", json_string("register"));
    json_object_set_new(request, "device_id", json_string(g_device_state.device_id));
    json_object_set_new(request, "auth_token", json_string(g_device_state.auth_token));
    json_object_set_new(request, "version", json_string("1.0"));
    
    // Add capabilities
    json_t *capabilities = json_array();
    json_array_append_new(capabilities, json_string("tcp"));
    json_array_append_new(capabilities, json_string("ssl"));
    json_object_set_new(request, "capabilities", capabilities);
    
    // Add metadata
    json_t *metadata = json_object();
    json_object_set_new(metadata, "client_version", json_string(VERSION));
    json_object_set_new(metadata, "platform", json_string("linux"));
    json_object_set_new(metadata, "start_time", json_integer(time(NULL)));
    json_object_set_new(request, "metadata", metadata);
    
    // Serialize JSON
    char *json_str = json_dumps(request, JSON_COMPACT);
    json_decref(request);
    
    if (!json_str) {
        logMsg(LOG_ERR, "Failed to serialize registration request\n");
        SSL_free(ssl);
        SSL_CTX_free(ssl_ctx);
        close(sock);
        return -1;
    }
    
    // Send request
    size_t len = strlen(json_str);
    ssize_t sent = SSL_write(ssl, json_str, len);
    
    free(json_str);
    
    if (sent != (ssize_t)len) {
        logMsg(LOG_ERR, "Failed to send registration request\n");
        SSL_free(ssl);
        SSL_CTX_free(ssl_ctx);
        close(sock);
        return -1;
    }
    
    // Receive response
    char buffer[4096];
    ssize_t received = SSL_read(ssl, buffer, sizeof(buffer) - 1);
    
    if (received <= 0) {
        logMsg(LOG_ERR, "No response from registration server\n");
        SSL_free(ssl);
        SSL_CTX_free(ssl_ctx);
        close(sock);
        return -1;
    }
    
    buffer[received] = '\0';
    
    // Parse response
    json_error_t error;
    json_t *response = json_loads(buffer, 0, &error);
    
    if (!response) {
        logMsg(LOG_ERR, "Failed to parse registration response: %s\n", error.text);
        SSL_free(ssl);
        SSL_CTX_free(ssl_ctx);
        close(sock);
        return -1;
    }
    
    // Check response
    json_t *status_obj = json_object_get(response, "status");
    if (!json_is_string(status_obj)) {
        logMsg(LOG_ERR, "Invalid registration response format\n");
        json_decref(response);
        SSL_free(ssl);
        SSL_CTX_free(ssl_ctx);
        close(sock);
        return -1;
    }
    
    const char *status = json_string_value(status_obj);
    
    if (strcmp(status, "authenticated") == 0) {
        // Registration successful
        json_t *port_obj = json_object_get(response, "assigned_port");
        json_t *token_obj = json_object_get(response, "session_token");
        json_t *interval_obj = json_object_get(response, "heartbeat_interval");
        
        if (json_is_integer(port_obj) && json_is_string(token_obj)) {
            g_device_state.assigned_port = json_integer_value(port_obj);
            strncpy(g_device_state.session_token, json_string_value(token_obj), SESSION_TOKEN_MAX_LEN);
            
            if (json_is_integer(interval_obj)) {
                g_device_state.heartbeat_interval = json_integer_value(interval_obj);
            }
            
            g_device_state.status = DEVICE_STATUS_REGISTERED;
            g_device_state.registered_at = time(NULL);
            
            // Update heartbeat configuration
            strncpy(g_heartbeat_config.session_token, g_device_state.session_token, SESSION_TOKEN_MAX_LEN);
            g_heartbeat_config.assigned_port = g_device_state.assigned_port;
            g_heartbeat_config.heartbeat_interval = g_device_state.heartbeat_interval;
            g_heartbeat_config.ssl_ctx = ssl_ctx; // Reuse SSL context
            
            result = 0;
            
            logMsg(LOG_INFO, "Device registered successfully\n");
            logMsg(LOG_INFO, "  Assigned port: %d\n", g_device_state.assigned_port);
            logMsg(LOG_INFO, "  Heartbeat interval: %d seconds\n", g_device_state.heartbeat_interval);
        } else {
            logMsg(LOG_ERR, "Missing required fields in registration response\n");
        }
    } else {
        json_t *message_obj = json_object_get(response, "message");
        const char *message = json_is_string(message_obj) ? json_string_value(message_obj) : "Unknown error";
        
        logMsg(LOG_ERR, "Registration failed: %s\n", message);
    }
    
    json_decref(response);
    
    // Cleanup (keep SSL context for heartbeat)
    SSL_shutdown(ssl);
    SSL_free(ssl);
    close(sock);
    
    return result;
}

/**
 * Start device heartbeat
 */
int start_device_heartbeat(void)
{
    if (g_device_state.status != DEVICE_STATUS_REGISTERED) {
        logMsg(LOG_ERR, "Device not registered, cannot start heartbeat\n");
        return -1;
    }
    
    // Initialize heartbeat manager
    if (heartbeat_manager_init(&g_heartbeat_config) != 0) {
        logMsg(LOG_ERR, "Failed to initialize heartbeat manager\n");
        return -1;
    }
    
    // Start heartbeat
    if (heartbeat_manager_start() != 0) {
        logMsg(LOG_ERR, "Failed to start heartbeat manager\n");
        return -1;
    }
    
    g_device_state.status = DEVICE_STATUS_CONNECTED;
    
    logMsg(LOG_INFO, "Device heartbeat started\n");
    return 0;
}

/**
 * Modified main function with device registration
 */
int main_with_device_registration(int argc, char** argv)
{
    // Parse command line arguments
    char *device_id = NULL;
    char *auth_token = NULL;
    char *registration_server = NULL;
    uint16_t registration_port = 8443;
    bool enable_device_registration = false;
    
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--device-id") == 0 && i + 1 < argc) {
            device_id = argv[++i];
            enable_device_registration = true;
        } else if (strcmp(argv[i], "--device-token") == 0 && i + 1 < argc) {
            auth_token = argv[++i];
        } else if (strcmp(argv[i], "--registration-server") == 0 && i + 1 < argc) {
            registration_server = argv[++i];
        } else if (strcmp(argv[i], "--registration-port") == 0 && i + 1 < argc) {
            registration_port = atoi(argv[++i]);
        }
    }
    
    // Initialize device registration if enabled
    if (enable_device_registration && device_id && auth_token && registration_server) {
        if (device_registration_init(device_id, auth_token, registration_server, registration_port) != 0) {
            logMsg(LOG_ERR, "Failed to initialize device registration\n");
            return -1;
        }
        
        // Register with server
        if (device_register_with_server() != 0) {
            logMsg(LOG_ERR, "Device registration failed\n");
            return -1;
        }
        
        // Update proxy client settings with assigned port
        // This would modify the global threads_data structure
        proxy_server_thread_data_t *settings = get_client_settings();
        if (settings) {
            // Set the server host and port to connect to
            strncpy(settings->host_in, registration_server, sizeof(settings->host_in) - 1);
            settings->port_in = g_device_state.assigned_port;
            
            logMsg(LOG_INFO, "Configured to connect to server on port %d\n", g_device_state.assigned_port);
        }
        
        // Start heartbeat
        if (start_device_heartbeat() != 0) {
            logMsg(LOG_WARNING, "Failed to start heartbeat, continuing without it\n");
        }
    }
    
    // Start the proxy client
    return switcher_servers_start();
}

/**
 * Cleanup device registration
 */
void device_registration_cleanup(void)
{
    if (g_device_registration_enabled) {
        // Stop heartbeat
        heartbeat_manager_stop();
        
        // Cleanup SSL context
        if (g_heartbeat_config.ssl_ctx) {
            SSL_CTX_free(g_heartbeat_config.ssl_ctx);
            g_heartbeat_config.ssl_ctx = NULL;
        }
        
        g_device_registration_enabled = false;
        g_device_state.status = DEVICE_STATUS_DISCONNECTED;
        
        logMsg(LOG_INFO, "Device registration cleaned up\n");
    }
}

/**
 * Get device registration status
 */
device_registration_state_t* get_device_registration_state(void)
{
    return &g_device_state;
}

/**
 * Reconnect device (called from heartbeat manager)
 */
int reconnect_device(void)
{
    logMsg(LOG_INFO, "Attempting to reconnect device...\n");
    
    // Update status
    g_device_state.status = DEVICE_STATUS_RECONNECTING;
    
    // Try to register again
    if (device_register_with_server() != 0) {
        g_device_state.status = DEVICE_STATUS_DISCONNECTED;
        return -1;
    }
    
    // Update heartbeat configuration with new session token
    strncpy(g_heartbeat_config.session_token, g_device_state.session_token, SESSION_TOKEN_MAX_LEN);
    g_heartbeat_config.assigned_port = g_device_state.assigned_port;
    
    // Restart heartbeat
    heartbeat_manager_stop();
    heartbeat_manager_init(&g_heartbeat_config);
    heartbeat_manager_start();
    
    g_device_state.status = DEVICE_STATUS_CONNECTED;
    
    logMsg(LOG_INFO, "Device reconnected successfully\n");
    return 0;
}

// Example usage in modified proxy_client.c main function:
/*
int main(int argc, char** argv) {
    logMsgInit();
    
    // Parse standard arguments
    // ... existing argument parsing code ...
    
    // Check if device registration is enabled
    bool has_device_args = false;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--device-id") == 0) {
            has_device_args = true;
            break;
        }
    }
    
    if (has_device_args) {
        // Use device registration mode
        return main_with_device_registration(argc, argv);
    } else {
        // Use traditional mode
        return main_traditional(argc, argv);
    }
}
*/