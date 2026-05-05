//
// Created for net_port device management system
//

#ifndef NET_PORT_DEVICE_MANAGER_H
#define NET_PORT_DEVICE_MANAGER_H

#include <stdint.h>
#include <stdbool.h>
#include <time.h>
#include <openssl/ssl.h>

// Maximum lengths for strings
#define DEVICE_ID_MAX_LEN 64
#define DEVICE_NAME_MAX_LEN 255
#define AUTH_TOKEN_MAX_LEN 256
#define SESSION_TOKEN_MAX_LEN 256
#define IP_ADDR_MAX_LEN 45
#define METADATA_JSON_MAX_LEN 4096

// Device status codes
typedef enum {
    DEVICE_STATUS_INACTIVE = 0,
    DEVICE_STATUS_ACTIVE,
    DEVICE_STATUS_PENDING,
    DEVICE_STATUS_BLOCKED,
    DEVICE_STATUS_ERROR
} device_status_t;

// Session status codes
typedef enum {
    SESSION_STATUS_ACTIVE = 0,
    SESSION_STATUS_EXPIRED,
    SESSION_STATUS_TERMINATED,
    SESSION_STATUS_ERROR
} session_status_t;

// Port allocation status
typedef enum {
    PORT_STATUS_FREE = 0,
    PORT_STATUS_ALLOCATED,
    PORT_STATUS_RESERVED,
    PORT_STATUS_BLOCKED
} port_status_t;

// Device capabilities
typedef enum {
    CAPABILITY_SSH = 1 << 0,
    CAPABILITY_HTTP = 1 << 1,
    CAPABILITY_HTTPS = 1 << 2,
    CAPABILITY_MQTT = 1 << 3,
    CAPABILITY_WEBSOCKET = 1 << 4,
    CAPABILITY_TCP = 1 << 5,
    CAPABILITY_UDP = 1 << 6,
    CAPABILITY_CUSTOM = 1 << 7
} device_capability_t;

// Device structure
typedef struct device_info_s {
    char device_id[DEVICE_ID_MAX_LEN + 1];
    char name[DEVICE_NAME_MAX_LEN + 1];
    char type[64];
    device_status_t status;
    uint16_t assigned_port;
    char internal_address[IP_ADDR_MAX_LEN + 1];
    uint16_t internal_port;
    char protocol[16];
    uint32_t capabilities;
    char metadata[METADATA_JSON_MAX_LEN + 1];
    time_t created_at;
    time_t updated_at;
    time_t last_heartbeat;
    int32_t user_id;
} device_info_t;

// Device session structure
typedef struct device_session_s {
    char session_token[SESSION_TOKEN_MAX_LEN + 1];
    char device_id[DEVICE_ID_MAX_LEN + 1];
    char client_ip[IP_ADDR_MAX_LEN + 1];
    uint16_t client_port;
    char server_ip[IP_ADDR_MAX_LEN + 1];
    uint16_t assigned_port;
    time_t started_at;
    time_t last_activity;
    time_t expires_at;
    uint64_t bytes_sent;
    uint64_t bytes_received;
    uint32_t active_connections;
    session_status_t status;
    SSL *ssl_connection; // SSL connection for this session
} device_session_t;

// Port allocation structure
typedef struct port_allocation_s {
    uint16_t port;
    char device_id[DEVICE_ID_MAX_LEN + 1];
    char session_token[SESSION_TOKEN_MAX_LEN + 1];
    time_t allocated_at;
    time_t expires_at;
    port_status_t status;
} port_allocation_t;

// Device registration request (JSON format)
typedef struct device_register_request_s {
    char device_id[DEVICE_ID_MAX_LEN + 1];
    char auth_token[AUTH_TOKEN_MAX_LEN + 1];
    char version[32];
    uint32_t capabilities;
    char metadata[METADATA_JSON_MAX_LEN + 1];
} device_register_request_t;

// Device registration response (JSON format)
typedef struct device_register_response_s {
    char status[32];
    uint16_t assigned_port;
    char session_token[SESSION_TOKEN_MAX_LEN + 1];
    uint32_t heartbeat_interval;
    time_t server_time;
} device_register_response_t;

// Heartbeat request
typedef struct device_heartbeat_request_s {
    char session_token[SESSION_TOKEN_MAX_LEN + 1];
    char status[32];
    uint32_t connections;
    float cpu_usage;
    float memory_usage;
    uint32_t uptime;
} device_heartbeat_request_t;

// Heartbeat response
typedef struct device_heartbeat_response_s {
    char status[32];
    time_t timestamp;
} device_heartbeat_response_t;

// Statistics update
typedef struct device_statistics_update_s {
    char session_token[SESSION_TOKEN_MAX_LEN + 1];
    uint64_t bytes_sent;
    uint64_t bytes_received;
    uint32_t active_connections;
    uint32_t period_seconds;
} device_statistics_update_t;

// Device manager configuration
typedef struct device_manager_config_s {
    uint16_t control_port;           // Port for device registration (default: 8443)
    uint16_t port_range_start;       // Start of dynamic port range (default: 10000)
    uint16_t port_range_end;         // End of dynamic port range (default: 60000)
    uint32_t heartbeat_interval;     // Default heartbeat interval in seconds (default: 30)
    uint32_t session_timeout;        // Session timeout in seconds (default: 3600)
    uint32_t max_devices;            // Maximum number of devices (default: 50000)
    bool enable_ssl;                 // Enable SSL for control channel
    char ssl_cert_file[256];         // SSL certificate file
    char ssl_key_file[256];          // SSL private key file
    char db_host[64];                // Database host
    char db_name[64];                // Database name
    char db_user[64];                // Database user
    char db_password[64];            // Database password
} device_manager_config_t;

// Function prototypes

/**
 * @brief Initialize device manager with configuration
 * 
 * @param config Device manager configuration
 * @return int 0 on success, -1 on error
 */
int device_manager_init(const device_manager_config_t *config);

/**
 * @brief Start device manager control server
 * 
 * @return int 0 on success, -1 on error
 */
int device_manager_start(void);

/**
 * @brief Stop device manager and cleanup resources
 * 
 * @return int 0 on success, -1 on error
 */
int device_manager_stop(void);

/**
 * @brief Authenticate device using device_id and auth_token
 * 
 * @param device_id Device identifier
 * @param auth_token Authentication token
 * @param device_info Output device information if authenticated
 * @return int 0 if authenticated, -1 if not authenticated
 */
int device_authenticate(const char *device_id, const char *auth_token, device_info_t *device_info);

/**
 * @brief Create a new session for authenticated device
 * 
 * @param device_id Device identifier
 * @param session Output session information
 * @return int 0 on success, -1 on error
 */
int device_create_session(const char *device_id, device_session_t *session);

/**
 * @brief Allocate a port for device session
 * 
 * @param device_id Device identifier
 * @param session_token Session token
 * @param requested_port Requested port (0 for any)
 * @return uint16_t Allocated port, 0 on error
 */
uint16_t allocate_port_for_device(const char *device_id, const char *session_token, uint16_t requested_port);

/**
 * @brief Free allocated port
 * 
 * @param port Port to free
 * @return int 0 on success, -1 on error
 */
int free_device_port(uint16_t port);

/**
 * @brief Update device heartbeat
 * 
 * @param session_token Session token
 * @return int 0 on success, -1 on error
 */
int update_device_heartbeat(const char *session_token);

/**
 * @brief Get device information by port
 * 
 * @param port Assigned port
 * @param device_id Output device identifier
 * @param device_id_len Maximum length of device_id buffer
 * @return int 0 on success, -1 on error
 */
int get_device_by_port(uint16_t port, char *device_id, size_t device_id_len);

/**
 * @brief Get session information by session token
 * 
 * @param session_token Session token
 * @param session Output session information
 * @return int 0 on success, -1 on error
 */
int get_session_by_token(const char *session_token, device_session_t *session);

/**
 * @brief Terminate device session
 * 
 * @param session_token Session token
 * @return int 0 on success, -1 on error
 */
int terminate_device_session(const char *session_token);

/**
 * @brief Update device statistics
 * 
 * @param session_token Session token
 * @param bytes_sent Bytes sent since last update
 * @param bytes_received Bytes received since last update
 * @param connections Active connections
 * @return int 0 on success, -1 on error
 */
int update_device_statistics(const char *session_token, uint64_t bytes_sent, uint64_t bytes_received, uint32_t connections);

/**
 * @brief Process device registration request
 * 
 * @param request Registration request
 * @param response Registration response
 * @return int 0 on success, -1 on error
 */
int process_device_registration(const device_register_request_t *request, device_register_response_t *response);

/**
 * @brief Process device heartbeat request
 * 
 * @param request Heartbeat request
 * @param response Heartbeat response
 * @return int 0 on success, -1 on error
 */
int process_device_heartbeat(const device_heartbeat_request_t *request, device_heartbeat_response_t *response);

/**
 * @brief Cleanup expired sessions and ports
 * 
 * @return int Number of cleaned up sessions
 */
int cleanup_expired_sessions(void);

/**
 * @brief Generate session token
 * 
 * @param device_id Device identifier
 * @param token Output token buffer
 * @param token_len Token buffer length
 * @return int 0 on success, -1 on error
 */
int generate_session_token(const char *device_id, char *token, size_t token_len);

/**
 * @brief Validate session token
 * 
 * @param session_token Session token to validate
 * @return int 0 if valid, -1 if invalid
 */
int validate_session_token(const char *session_token);

/**
 * @brief Get device count by status
 * 
 * @param status Device status to filter
 * @return int Number of devices
 */
int get_device_count(device_status_t status);

/**
 * @brief Get active sessions count
 * 
 * @return int Number of active sessions
 */
int get_active_sessions_count(void);

/**
 * @brief Get port usage statistics
 * 
 * @param used Output number of used ports
 * @param free Output number of free ports
 * @return int 0 on success, -1 on error
 */
int get_port_usage_stats(uint32_t *used, uint32_t *free);

#endif // NET_PORT_DEVICE_MANAGER_H