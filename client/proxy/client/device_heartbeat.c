//
// Device heartbeat mechanism for net_port client
//

#include "proxy_client.h"
#include "device_heartbeat.h"
#include "logMsg.h"
#include "time_utils.h"
#include "hal_time.h"

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

// Heartbeat manager state
static heartbeat_manager_t g_heartbeat_manager;
static pthread_t g_heartbeat_thread;
static volatile bool g_heartbeat_running = false;
static pthread_mutex_t g_heartbeat_mutex = PTHREAD_MUTEX_INITIALIZER;

/**
 * Initialize heartbeat manager
 */
int heartbeat_manager_init(const heartbeat_config_t *config)
{
    if (config == NULL) {
        return -1;
    }
    
    pthread_mutex_lock(&g_heartbeat_mutex);
    
    memset(&g_heartbeat_manager, 0, sizeof(g_heartbeat_manager));
    memcpy(&g_heartbeat_manager.config, config, sizeof(heartbeat_config_t));
    
    g_heartbeat_manager.status = HEARTBEAT_STATUS_DISCONNECTED;
    g_heartbeat_manager.last_sent = 0;
    g_heartbeat_manager.last_received = 0;
    g_heartbeat_manager.fail_count = 0;
    g_heartbeat_manager.reconnect_attempts = 0;
    
    pthread_mutex_unlock(&g_heartbeat_mutex);
    
    logMsg(LOG_INFO, "Heartbeat manager initialized\n");
    logMsg(LOG_INFO, "  Server: %s:%d\n", config->server_host, config->server_port);
    logMsg(LOG_INFO, "  Interval: %d seconds\n", config->heartbeat_interval);
    logMsg(LOG_INFO, "  Timeout: %d seconds\n", config->heartbeat_timeout);
    
    return 0;
}

/**
 * Start heartbeat thread
 */
int heartbeat_manager_start(void)
{
    if (g_heartbeat_running) {
        logMsg(LOG_WARNING, "Heartbeat manager already running\n");
        return 0;
    }
    
    if (strlen(g_heartbeat_manager.config.device_id) == 0 ||
        strlen(g_heartbeat_manager.config.session_token) == 0) {
        logMsg(LOG_ERR, "Heartbeat manager not properly configured\n");
        return -1;
    }
    
    g_heartbeat_running = true;
    
    if (pthread_create(&g_heartbeat_thread, NULL, heartbeat_thread_func, NULL) != 0) {
        logMsg(LOG_ERR, "Failed to create heartbeat thread\n");
        g_heartbeat_running = false;
        return -1;
    }
    
    logMsg(LOG_INFO, "Heartbeat manager started\n");
    return 0;
}

/**
 * Stop heartbeat thread
 */
int heartbeat_manager_stop(void)
{
    if (!g_heartbeat_running) {
        return 0;
    }
    
    logMsg(LOG_INFO, "Stopping heartbeat manager\n");
    
    g_heartbeat_running = false;
    
    // Wait for thread to finish
    if (g_heartbeat_thread) {
        pthread_join(g_heartbeat_thread, NULL);
    }
    
    logMsg(LOG_INFO, "Heartbeat manager stopped\n");
    return 0;
}

/**
 * Heartbeat thread function
 */
void* heartbeat_thread_func(void *arg)
{
    (void)arg;
    
    logMsg(LOG_DEBUG, "Heartbeat thread started\n");
    
    while (g_heartbeat_running) {
        pthread_mutex_lock(&g_heartbeat_mutex);
        
        time_t now = time(NULL);
        time_t next_heartbeat = g_heartbeat_manager.last_sent + g_heartbeat_manager.config.heartbeat_interval;
        
        // Check if it's time to send heartbeat
        if (now >= next_heartbeat) {
            if (send_heartbeat() == 0) {
                g_heartbeat_manager.last_sent = now;
                g_heartbeat_manager.fail_count = 0;
                g_heartbeat_manager.status = HEARTBEAT_STATUS_CONNECTED;
                
                // Check if we need to reconnect
                if (g_heartbeat_manager.reconnect_attempts > 0) {
                    logMsg(LOG_INFO, "Heartbeat reestablished after %d attempts\n", 
                           g_heartbeat_manager.reconnect_attempts);
                    g_heartbeat_manager.reconnect_attempts = 0;
                }
            } else {
                g_heartbeat_manager.fail_count++;
                g_heartbeat_manager.status = HEARTBEAT_STATUS_DISCONNECTED;
                
                // Check if we've exceeded failure threshold
                if (g_heartbeat_manager.fail_count >= g_heartbeat_manager.config.max_failures) {
                    logMsg(LOG_WARNING, "Heartbeat failed %d times, attempting reconnect\n",
                           g_heartbeat_manager.fail_count);
                    
                    // Try to reconnect
                    if (reconnect_to_server() == 0) {
                        g_heartbeat_manager.reconnect_attempts++;
                        g_heartbeat_manager.fail_count = 0;
                    } else {
                        logMsg(LOG_ERR, "Reconnect attempt %d failed\n",
                               g_heartbeat_manager.reconnect_attempts);
                    }
                }
            }
        }
        
        // Check for heartbeat timeout
        if (g_heartbeat_manager.status == HEARTBEAT_STATUS_CONNECTED &&
            g_heartbeat_manager.last_received > 0) {
            time_t timeout_time = g_heartbeat_manager.last_received + g_heartbeat_manager.config.heartbeat_timeout;
            
            if (now > timeout_time) {
                logMsg(LOG_WARNING, "Heartbeat timeout, last received %ld seconds ago\n",
                       now - g_heartbeat_manager.last_received);
                g_heartbeat_manager.status = HEARTBEAT_STATUS_TIMEOUT;
            }
        }
        
        pthread_mutex_unlock(&g_heartbeat_mutex);
        
        // Sleep for 1 second before checking again
        sleep(1);
    }
    
    logMsg(LOG_DEBUG, "Heartbeat thread stopped\n");
    return NULL;
}

/**
 * Send heartbeat to server
 */
int send_heartbeat(void)
{
    int sock = -1;
    SSL *ssl = NULL;
    int result = -1;
    
    // Create socket
    sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock < 0) {
        logMsg(LOG_ERR, "Failed to create socket for heartbeat: %s\n", strerror(errno));
        return -1;
    }
    
    // Set timeout
    struct timeval timeout = {g_heartbeat_manager.config.connection_timeout, 0};
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
    
    // Connect to server
    struct sockaddr_in server_addr;
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(g_heartbeat_manager.config.server_port);
    
    if (inet_pton(AF_INET, g_heartbeat_manager.config.server_host, &server_addr.sin_addr) <= 0) {
        logMsg(LOG_ERR, "Invalid server address: %s\n", g_heartbeat_manager.config.server_host);
        close(sock);
        return -1;
    }
    
    if (connect(sock, (struct sockaddr *)&server_addr, sizeof(server_addr)) < 0) {
        logMsg(LOG_DEBUG, "Failed to connect to heartbeat server: %s\n", strerror(errno));
        close(sock);
        return -1;
    }
    
    // Setup SSL if enabled
    if (g_heartbeat_manager.config.enable_ssl) {
        SSL_CTX *ssl_ctx = g_heartbeat_manager.config.ssl_ctx;
        if (!ssl_ctx) {
            logMsg(LOG_ERR, "SSL enabled but no SSL context provided\n");
            close(sock);
            return -1;
        }
        
        ssl = SSL_new(ssl_ctx);
        if (!ssl) {
            logMsg(LOG_ERR, "Failed to create SSL object\n");
            close(sock);
            return -1;
        }
        
        SSL_set_fd(ssl, sock);
        
        if (SSL_connect(ssl) != 1) {
            logMsg(LOG_ERR, "SSL connection failed: %s\n", ERR_error_string(ERR_get_error(), NULL));
            SSL_free(ssl);
            close(sock);
            return -1;
        }
    }
    
    // Build heartbeat request
    json_t *request = json_object();
    json_object_set_new(request, "action", json_string("heartbeat"));
    json_object_set_new(request, "session_token", json_string(g_heartbeat_manager.config.session_token));
    json_object_set_new(request, "status", json_string("healthy"));
    
    // Add statistics if available
    json_t *stats = json_object();
    json_object_set_new(stats, "connections", json_integer(get_active_connections_count()));
    json_object_set_new(stats, "cpu_usage", json_real(get_cpu_usage()));
    json_object_set_new(stats, "memory_usage", json_real(get_memory_usage()));
    json_object_set_new(stats, "uptime", json_integer(get_uptime()));
    json_object_set_new(request, "statistics", stats);
    
    // Add traffic statistics
    json_t *traffic = json_object();
    json_object_set_new(traffic, "bytes_sent", json_integer(get_bytes_sent_since_last()));
    json_object_set_new(traffic, "bytes_received", json_integer(get_bytes_received_since_last()));
    json_object_set_new(traffic, "active_connections", json_integer(get_active_connections()));
    json_object_set_new(request, "traffic", traffic);
    
    // Serialize JSON
    char *json_str = json_dumps(request, JSON_COMPACT);
    json_decref(request);
    
    if (!json_str) {
        logMsg(LOG_ERR, "Failed to serialize heartbeat request\n");
        if (ssl) SSL_free(ssl);
        close(sock);
        return -1;
    }
    
    // Send request
    size_t len = strlen(json_str);
    ssize_t sent;
    
    if (ssl) {
        sent = SSL_write(ssl, json_str, len);
    } else {
        sent = send(sock, json_str, len, 0);
    }
    
    if (sent != (ssize_t)len) {
        logMsg(LOG_DEBUG, "Failed to send heartbeat request\n");
        free(json_str);
        if (ssl) SSL_free(ssl);
        close(sock);
        return -1;
    }
    
    free(json_str);
    
    // Receive response
    char buffer[4096];
    ssize_t received;
    
    if (ssl) {
        received = SSL_read(ssl, buffer, sizeof(buffer) - 1);
    } else {
        received = recv(sock, buffer, sizeof(buffer) - 1, 0);
    }
    
    if (received <= 0) {
        logMsg(LOG_DEBUG, "No response to heartbeat\n");
        if (ssl) SSL_free(ssl);
        close(sock);
        return -1;
    }
    
    buffer[received] = '\0';
    
    // Parse response
    json_error_t error;
    json_t *response = json_loads(buffer, 0, &error);
    
    if (!response) {
        logMsg(LOG_ERR, "Failed to parse heartbeat response: %s\n", error.text);
        if (ssl) SSL_free(ssl);
        close(sock);
        return -1;
    }
    
    // Check response status
    json_t *status_obj = json_object_get(response, "status");
    if (json_is_string(status_obj)) {
        const char *status = json_string_value(status_obj);
        
        if (strcmp(status, "ok") == 0) {
            result = 0;
            g_heartbeat_manager.last_received = time(NULL);
            
            // Update server time if provided
            json_t *timestamp_obj = json_object_get(response, "timestamp");
            if (json_is_integer(timestamp_obj)) {
                time_t server_time = json_integer_value(timestamp_obj);
                // Could sync clock here if needed
                (void)server_time;
            }
        } else {
            logMsg(LOG_WARNING, "Heartbeat response status: %s\n", status);
        }
    }
    
    json_decref(response);
    
    // Cleanup
    if (ssl) {
        SSL_shutdown(ssl);
        SSL_free(ssl);
    }
    close(sock);
    
    if (result == 0) {
        logMsg(LOG_DEBUG, "Heartbeat sent successfully\n");
    }
    
    return result;
}

/**
 * Reconnect to server (full re-registration)
 */
int reconnect_to_server(void)
{
    logMsg(LOG_INFO, "Attempting to reconnect to server\n");
    
    // Build registration request
    json_t *request = json_object();
    json_object_set_new(request, "action", json_string("register"));
    json_object_set_new(request, "device_id", json_string(g_heartbeat_manager.config.device_id));
    json_object_set_new(request, "auth_token", json_string(g_heartbeat_manager.config.auth_token));
    json_object_set_new(request, "version", json_string("1.0"));
    
    // Add capabilities
    json_t *capabilities = json_array();
    json_array_append_new(capabilities, json_string("tcp"));
    json_array_append_new(capabilities, json_string("ssl"));
    json_object_set_new(request, "capabilities", capabilities);
    
    // Add metadata
    json_t *metadata = json_object();
    json_object_set_new(metadata, "reconnect_attempt", json_integer(g_heartbeat_manager.reconnect_attempts + 1));
    json_object_set_new(metadata, "last_seen", json_integer(time(NULL)));
    json_object_set_new(request, "metadata", metadata);
    
    // Send registration request
    int sock = -1;
    SSL *ssl = NULL;
    int result = -1;
    
    // Create socket
    sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock < 0) {
        logMsg(LOG_ERR, "Failed to create socket for reconnect: %s\n", strerror(errno));
        json_decref(request);
        return -1;
    }
    
    // Connect to server
    struct sockaddr_in server_addr;
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(g_heartbeat_manager.config.server_port);
    
    if (inet_pton(AF_INET, g_heartbeat_manager.config.server_host, &server_addr.sin_addr) <= 0) {
        logMsg(LOG_ERR, "Invalid server address: %s\n", g_heartbeat_manager.config.server_host);
        close(sock);
        json_decref(request);
        return -1;
    }
    
    if (connect(sock, (struct sockaddr *)&server_addr, sizeof(server_addr)) < 0) {
        logMsg(LOG_DEBUG, "Failed to connect for reconnect: %s\n", strerror(errno));
        close(sock);
        json_decref(request);
        return -1;
    }
    
    // Setup SSL if enabled
    if (g_heartbeat_manager.config.enable_ssl) {
        SSL_CTX *ssl_ctx = g_heartbeat_manager.config.ssl_ctx;
        if (!ssl_ctx) {
            logMsg(LOG_ERR, "SSL enabled but no SSL context provided\n");
            close(sock);
            json_decref(request);
            return -1;
        }
        
        ssl = SSL_new(ssl_ctx);
        if (!ssl) {
            logMsg(LOG_ERR, "Failed to create SSL object\n");
            close(sock);
            json_decref(request);
            return -1;
        }
        
        SSL_set_fd(ssl, sock);
        
        if (SSL_connect(ssl) != 1) {
            logMsg(LOG_ERR, "SSL connection failed: %s\n", ERR_error_string(ERR_get_error(), NULL));
            SSL_free(ssl);
            close(sock);
            json_decref(request);
            return -1;
        }
    }
    
    // Send request
    char *json_str = json_dumps(request, JSON_COMPACT);
    json_decref(request);
    
    if (!json_str) {
        logMsg(LOG_ERR, "Failed to serialize reconnect request\n");
        if (ssl) SSL_free(ssl);
        close(sock);
        return -1;
    }
    
    size_t len = strlen(json_str);
    ssize_t sent;
    
    if (ssl) {
        sent = SSL_write(ssl, json_str, len);
    } else {
        sent = send(sock, json_str, len, 0);
    }
    
    free(json_str);
    
    if (sent != (ssize_t)len) {
        logMsg(LOG_DEBUG, "Failed to send reconnect request\n");
        if (ssl) SSL_free(ssl);
        close(sock);
        return -1;
    }
    
    // Receive response
    char buffer[4096];
    ssize_t received;
    
    if (ssl) {
        received = SSL_read(ssl, buffer, sizeof(buffer) - 1);
    } else {
        received = recv(sock, buffer, sizeof(buffer) - 1, 0);
    }
    
    if (received <= 0) {
        logMsg(LOG_DEBUG, "No response to reconnect request\n");
        if (ssl) SSL_free(ssl);
        close(sock);
        return -1;
    }
    
    buffer[received] = '\0';
    
    // Parse response
    json_error_t error;
    json_t *response = json_loads(buffer, 0, &error);
    
    if (!response) {
        logMsg(LOG_ERR, "Failed to parse reconnect response: %s\n", error.text);
        if (ssl) SSL_free(ssl);
        close(sock);
        return -1;
    }
    
    // Check response
    json_t *status_obj = json_object_get(response, "status");
    if (json_is_string(status_obj)) {
        const char *status = json_string_value(status_obj);
        
        if (strcmp(status, "authenticated") == 0) {
            // Update session token and port
            json_t *session_token_obj = json_object_get(response, "session_token");
            json_t *assigned_port_obj = json_object_get(response, "assigned_port");
            
            if (json_is_string(session_token_obj) && json_is_integer(assigned_port_obj)) {
                const char *new_session_token = json_string_value(session_token_obj);
                uint16_t new_port = json_integer_value(assigned_port_obj);
                
                pthread_mutex_lock(&g_heartbeat_mutex);
                strncpy(g_heartbeat_manager.config.session_token, new_session_token, SESSION_TOKEN_MAX_LEN);
                g_heartbeat_manager.config.assigned_port = new_port;
                pthread_mutex_unlock(&g_heartbeat_mutex);
                
                logMsg(LOG_INFO, "Reconnected successfully, new port: %d\n", new_port);
                result = 0;
            }
        }
    }
    
    json_decref(response);
    
    // Cleanup
    if (ssl) {
        SSL_shutdown(ssl);
        SSL_free(ssl);
    }
    close(sock);
    
    return result;
}

/**
 * Update heartbeat configuration (e.g., after reconnection)
 */
int heartbeat_update_config(const heartbeat_config_t *config)
{
    if (!config) {
        return -1;
    }
    
    pthread_mutex_lock(&g_heartbeat_mutex);
    memcpy(&g_heartbeat_manager.config, config, sizeof(heartbeat_config_t));
    pthread_mutex_unlock(&g_heartbeat_mutex);
    
    return 0;
}

/**
 * Get heartbeat status
 */
heartbeat_status_t heartbeat_get_status(void)
{
    heartbeat_status_t status;
    
    pthread_mutex_lock(&g_heartbeat_mutex);
    status = g_heartbeat_manager.status;
    pthread_mutex_unlock(&g_heartbeat_mutex);
    
    return status;
}

/**
 * Get heartbeat statistics
 */
int heartbeat_get_statistics(heartbeat_stats_t *stats)
{
    if (!stats) {
        return -1;
    }
    
    pthread_mutex_lock(&g_heartbeat_mutex);
    
    stats->last_sent = g_heartbeat_manager.last_sent;
    stats->last_received = g_heartbeat_manager.last_received;
    stats->fail_count = g_heartbeat_manager.fail_count;
    stats->reconnect_attempts = g_heartbeat_manager.reconnect_attempts;
    stats->status = g_heartbeat_manager.status;
    
    time_t now = time(NULL);
    stats->seconds_since_last_sent = (g_heartbeat_manager.last_sent > 0) ? now - g_heartbeat_manager.last_sent : -1;
    stats->seconds_since_last_received = (g_heartbeat_manager.last_received > 0) ? now - g_heartbeat_manager.last_received : -1;
    
    pthread_mutex_unlock(&g_heartbeat_mutex);
    
    return 0;
}

// Helper functions (would be implemented elsewhere)

int get_active_connections_count(void)
{
    // Implementation depends on your proxy client structure
    return 1; // Placeholder
}

float get_cpu_usage(void)
{
    // Implementation would read /proc/stat or similar
    return 0.0f; // Placeholder
}

float get_memory_usage(void)
{
    // Implementation would read /proc/meminfo or similar
    return 0.0f; // Placeholder
}

time_t get_uptime(void)
{
    // Implementation would get process/system uptime
    return time(NULL); // Placeholder
}

uint64_t get_bytes_sent_since_last(void)
{
    // Implementation would track bytes sent since last heartbeat
    return 0; // Placeholder
}

uint64_t get_bytes_received_since_last(void)
{
    // Implementation would track bytes received since last heartbeat
    return 0; // Placeholder
}

int get_active_connections(void)
{
    // Implementation would count active connections
    return 0; // Placeholder
}