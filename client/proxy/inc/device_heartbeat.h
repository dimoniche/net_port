//
// Device heartbeat mechanism header for net_port client
//

#ifndef NET_PORT_DEVICE_HEARTBEAT_H
#define NET_PORT_DEVICE_HEARTBEAT_H

#include <stdint.h>
#include <stdbool.h>
#include <time.h>
#include <openssl/ssl.h>

// Maximum lengths
#define DEVICE_ID_MAX_LEN 64
#define SESSION_TOKEN_MAX_LEN 256
#define SERVER_HOST_MAX_LEN 256
#define AUTH_TOKEN_MAX_LEN 256

// Device registration status
typedef enum {
    DEVICE_STATUS_DISCONNECTED = 0,
    DEVICE_STATUS_REGISTERED,
    DEVICE_STATUS_CONNECTED,
    DEVICE_STATUS_RECONNECTING
} device_registration_status_t;

// Device registration state
typedef struct device_registration_state_s {
    char device_id[DEVICE_ID_MAX_LEN + 1];
    char auth_token[AUTH_TOKEN_MAX_LEN + 1];
    char server_host[SERVER_HOST_MAX_LEN + 1];
    uint16_t server_port;
    uint16_t assigned_port;
    uint16_t tunnel_port;
    device_registration_status_t status;
    char session_token[SESSION_TOKEN_MAX_LEN + 1];
    time_t registered_at;
    time_t last_heartbeat;
    uint32_t heartbeat_interval;
} device_registration_state_t;

// Heartbeat status
typedef enum {
    HEARTBEAT_STATUS_DISCONNECTED = 0,
    HEARTBEAT_STATUS_CONNECTED,
    HEARTBEAT_STATUS_TIMEOUT,
    HEARTBEAT_STATUS_ERROR
} heartbeat_status_t;

// Heartbeat configuration
typedef struct heartbeat_config_s {
    char device_id[DEVICE_ID_MAX_LEN + 1];
    char auth_token[256];
    char session_token[SESSION_TOKEN_MAX_LEN + 1];
    char server_host[SERVER_HOST_MAX_LEN + 1];
    uint16_t server_port;
    uint16_t assigned_port;
    uint32_t heartbeat_interval;     // Seconds between heartbeats
    uint32_t heartbeat_timeout;      // Seconds before considering timeout
    uint32_t connection_timeout;     // Socket connection timeout
    uint32_t max_failures;           // Max consecutive failures before reconnect
    bool enable_ssl;
    SSL_CTX *ssl_ctx;
} heartbeat_config_t;

// Heartbeat statistics
typedef struct heartbeat_stats_s {
    time_t last_sent;
    time_t last_received;
    uint32_t fail_count;
    uint32_t reconnect_attempts;
    heartbeat_status_t status;
    int32_t seconds_since_last_sent;
    int32_t seconds_since_last_received;
} heartbeat_stats_t;

// Heartbeat manager state
typedef struct heartbeat_manager_s {
    heartbeat_config_t config;
    heartbeat_status_t status;
    time_t last_sent;
    time_t last_received;
    uint32_t fail_count;
    uint32_t reconnect_attempts;
} heartbeat_manager_t;

/**
 * @brief Initialize heartbeat manager
 * 
 * @param config Heartbeat configuration
 * @return int 0 on success, -1 on error
 */
int heartbeat_manager_init(const heartbeat_config_t *config);

/**
 * @brief Start heartbeat thread
 * 
 * @return int 0 on success, -1 on error
 */
int heartbeat_manager_start(void);

/**
 * @brief Stop heartbeat thread
 * 
 * @return int 0 on success, -1 on error
 */
int heartbeat_manager_stop(void);

/**
 * @brief Send heartbeat to server
 * 
 * @return int 0 on success, -1 on error
 */
int send_heartbeat(void);

/**
 * @brief Reconnect to server (full re-registration)
 * 
 * @return int 0 on success, -1 on error
 */
int reconnect_to_server(void);

/**
 * @brief Update heartbeat configuration
 * 
 * @param config New configuration
 * @return int 0 on success, -1 on error
 */
int heartbeat_update_config(const heartbeat_config_t *config);

/**
 * @brief Get current heartbeat status
 * 
 * @return heartbeat_status_t Current status
 */
heartbeat_status_t heartbeat_get_status(void);

/**
 * @brief Get heartbeat statistics
 * 
 * @param stats Output statistics
 * @return int 0 on success, -1 on error
 */
int heartbeat_get_statistics(heartbeat_stats_t *stats);

/**
 * @brief Heartbeat thread function
 * 
 * @param arg Thread argument (unused)
 * @return void* NULL
 */
void* heartbeat_thread_func(void *arg);

// Helper functions for statistics (to be implemented elsewhere)

/**
 * @brief Get active connections count
 * 
 * @return int Number of active connections
 */
int get_active_connections_count(void);

/**
 * @brief Get CPU usage percentage
 * 
 * @return float CPU usage (0-100)
 */
float get_cpu_usage(void);

/**
 * @brief Get memory usage percentage
 * 
 * @return float Memory usage (0-100)
 */
float get_memory_usage(void);

/**
 * @brief Get system/process uptime in seconds
 * 
 * @return time_t Uptime in seconds
 */
time_t get_uptime(void);

/**
 * @brief Get bytes sent since last heartbeat
 * 
 * @return uint64_t Bytes sent
 */
uint64_t get_bytes_sent_since_last(void);

/**
 * @brief Get bytes received since last heartbeat
 * 
 * @return uint64_t Bytes received
 */
uint64_t get_bytes_received_since_last(void);

/**
 * @brief Get number of active connections
 * 
 * @return int Active connections count
 */
int get_active_connections(void);

#endif // NET_PORT_DEVICE_HEARTBEAT_H