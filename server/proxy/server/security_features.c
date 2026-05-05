//
// Security features for device management system
//

#include "device_manager.h"
#include "proxy_server.h"
#include "logMsg.h"
#include "time_utils.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <pthread.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <openssl/ssl.h>
#include <openssl/err.h>

// Rate limiting structures
typedef struct rate_limit_entry_s {
    char key[64];               // IP address or device_id
    uint32_t request_count;     // Number of requests in current window
    time_t window_start;        // Start time of current window
    time_t last_request;        // Time of last request
    uint32_t penalty_count;     // Number of times penalized
    time_t penalty_until;       // Time until penalty expires
} rate_limit_entry_t;

typedef struct rate_limit_config_s {
    uint32_t window_seconds;    // Time window in seconds
    uint32_t max_requests;      // Maximum requests per window
    uint32_t penalty_seconds;   // Penalty duration in seconds
    uint32_t max_penalties;     // Maximum penalties before permanent block
} rate_limit_config_t;

// Security manager state
static rate_limit_config_t g_rate_limit_config = {
    .window_seconds = 60,
    .max_requests = 100,
    .penalty_seconds = 300,
    .max_penalties = 5
};

static pthread_mutex_t g_security_mutex = PTHREAD_MUTEX_INITIALIZER;
static rate_limit_entry_t *g_rate_limit_table = NULL;
static size_t g_rate_limit_table_size = 0;
static size_t g_rate_limit_table_capacity = 0;

// IP whitelist/blacklist
static char **g_ip_whitelist = NULL;
static size_t g_ip_whitelist_size = 0;
static char **g_ip_blacklist = NULL;
static size_t g_ip_blacklist_size = 0;

// Security event logging
typedef struct security_event_s {
    time_t timestamp;
    char event_type[32];
    char source_ip[INET_ADDRSTRLEN];
    char device_id[DEVICE_ID_MAX_LEN];
    char description[256];
} security_event_t;

/**
 * Initialize security features
 */
int security_features_init(void)
{
    logMsg(LOG_INFO, "Initializing security features\n");
    
    // Initialize rate limit table
    g_rate_limit_table_capacity = 1000;
    g_rate_limit_table = calloc(g_rate_limit_table_capacity, sizeof(rate_limit_entry_t));
    if (!g_rate_limit_table) {
        logMsg(LOG_ERR, "Failed to allocate rate limit table\n");
        return -1;
    }
    
    g_rate_limit_table_size = 0;
    
    // Load IP lists from configuration (in real implementation)
    // load_ip_lists();
    
    logMsg(LOG_INFO, "Security features initialized\n");
    logMsg(LOG_INFO, "  Rate limit: %d requests per %d seconds\n",
           g_rate_limit_config.max_requests, g_rate_limit_config.window_seconds);
    
    return 0;
}

/**
 * Cleanup security features
 */
void security_features_cleanup(void)
{
    pthread_mutex_lock(&g_security_mutex);
    
    if (g_rate_limit_table) {
        free(g_rate_limit_table);
        g_rate_limit_table = NULL;
    }
    
    g_rate_limit_table_size = 0;
    g_rate_limit_table_capacity = 0;
    
    // Free IP lists
    for (size_t i = 0; i < g_ip_whitelist_size; i++) {
        free(g_ip_whitelist[i]);
    }
    free(g_ip_whitelist);
    g_ip_whitelist = NULL;
    g_ip_whitelist_size = 0;
    
    for (size_t i = 0; i < g_ip_blacklist_size; i++) {
        free(g_ip_blacklist[i]);
    }
    free(g_ip_blacklist);
    g_ip_blacklist = NULL;
    g_ip_blacklist_size = 0;
    
    pthread_mutex_unlock(&g_security_mutex);
    
    logMsg(LOG_INFO, "Security features cleaned up\n");
}

/**
 * Check rate limit for a key
 */
int check_rate_limit(const char *key, const char *source_ip)
{
    if (!key) {
        return 0; // No key, no rate limiting
    }
    
    pthread_mutex_lock(&g_security_mutex);
    
    time_t now = time(NULL);
    
    // Find existing entry
    rate_limit_entry_t *entry = NULL;
    for (size_t i = 0; i < g_rate_limit_table_size; i++) {
        if (strcmp(g_rate_limit_table[i].key, key) == 0) {
            entry = &g_rate_limit_table[i];
            break;
        }
    }
    
    // Create new entry if not found
    if (!entry) {
        if (g_rate_limit_table_size >= g_rate_limit_table_capacity) {
            // Resize table
            size_t new_capacity = g_rate_limit_table_capacity * 2;
            rate_limit_entry_t *new_table = realloc(g_rate_limit_table, 
                                                   new_capacity * sizeof(rate_limit_entry_t));
            if (!new_table) {
                pthread_mutex_unlock(&g_security_mutex);
                logMsg(LOG_WARNING, "Rate limit table full, allowing request\n");
                return 0;
            }
            
            g_rate_limit_table = new_table;
            g_rate_limit_table_capacity = new_capacity;
            
            // Clear new entries
            memset(&g_rate_limit_table[g_rate_limit_table_size], 0,
                   (new_capacity - g_rate_limit_table_size) * sizeof(rate_limit_entry_t));
        }
        
        entry = &g_rate_limit_table[g_rate_limit_table_size];
        strncpy(entry->key, key, sizeof(entry->key) - 1);
        entry->key[sizeof(entry->key) - 1] = '\0';
        entry->window_start = now;
        entry->request_count = 0;
        entry->last_request = 0;
        entry->penalty_count = 0;
        entry->penalty_until = 0;
        
        g_rate_limit_table_size++;
    }
    
    // Check if penalized
    if (entry->penalty_until > now) {
        pthread_mutex_unlock(&g_security_mutex);
        
        logMsg(LOG_WARNING, "Rate limit penalty for %s from %s (until %ld)\n",
               key, source_ip ? source_ip : "unknown", entry->penalty_until);
        
        // Log security event
        log_security_event("rate_limit_penalty", source_ip, key,
                          "Request blocked due to rate limit penalty");
        
        return -1; // Blocked
    }
    
    // Check if window has expired
    if (now - entry->window_start >= g_rate_limit_config.window_seconds) {
        entry->window_start = now;
        entry->request_count = 0;
    }
    
    // Check request count
    if (entry->request_count >= g_rate_limit_config.max_requests) {
        // Apply penalty
        entry->penalty_count++;
        entry->penalty_until = now + g_rate_limit_config.penalty_seconds;
        entry->request_count = 0;
        entry->window_start = now;
        
        pthread_mutex_unlock(&g_security_mutex);
        
        logMsg(LOG_WARNING, "Rate limit exceeded for %s from %s, penalty applied (%d/%d)\n",
               key, source_ip ? source_ip : "unknown",
               entry->penalty_count, g_rate_limit_config.max_penalties);
        
        // Log security event
        log_security_event("rate_limit_exceeded", source_ip, key,
                          "Rate limit exceeded, penalty applied");
        
        // Check for permanent block
        if (entry->penalty_count >= g_rate_limit_config.max_penalties) {
            logMsg(LOG_ERR, "Permanent block for %s from %s (too many penalties)\n",
                   key, source_ip ? source_ip : "unknown");
            
            log_security_event("permanent_block", source_ip, key,
                              "Permanent block due to excessive rate limit violations");
            
            // In real implementation, add to blacklist
            // add_to_blacklist(source_ip);
        }
        
        return -1; // Blocked
    }
    
    // Allow request
    entry->request_count++;
    entry->last_request = now;
    
    pthread_mutex_unlock(&g_security_mutex);
    
    return 0; // Allowed
}

/**
 * Check IP against whitelist/blacklist
 */
int check_ip_access(const char *ip_address)
{
    if (!ip_address) {
        return 0; // No IP, allow (shouldn't happen)
    }
    
    pthread_mutex_lock(&g_security_mutex);
    
    // Check blacklist first
    for (size_t i = 0; i < g_ip_blacklist_size; i++) {
        if (strcmp(g_ip_blacklist[i], ip_address) == 0) {
            pthread_mutex_unlock(&g_security_mutex);
            
            logMsg(LOG_WARNING, "Blocked request from blacklisted IP: %s\n", ip_address);
            log_security_event("blacklisted_ip", ip_address, NULL,
                              "Request from blacklisted IP");
            
            return -1; // Blocked
        }
    }
    
    // Check whitelist if enabled
    if (g_ip_whitelist_size > 0) {
        int allowed = 0;
        
        for (size_t i = 0; i < g_ip_whitelist_size; i++) {
            if (strcmp(g_ip_whitelist[i], ip_address) == 0) {
                allowed = 1;
                break;
            }
        }
        
        if (!allowed) {
            pthread_mutex_unlock(&g_security_mutex);
            
            logMsg(LOG_WARNING, "Blocked request from non-whitelisted IP: %s\n", ip_address);
            log_security_event("non_whitelisted_ip", ip_address, NULL,
                              "Request from non-whitelisted IP");
            
            return -1; // Blocked
        }
    }
    
    pthread_mutex_unlock(&g_security_mutex);
    
    return 0; // Allowed
}

/**
 * Validate device authentication token
 */
int validate_device_token(const char *device_id, const char *auth_token, const char *source_ip)
{
    if (!device_id || !auth_token) {
        return -1;
    }
    
    // Check rate limit for this device
    if (check_rate_limit(device_id, source_ip) != 0) {
        return -1;
    }
    
    // Check rate limit for IP if provided
    if (source_ip && check_rate_limit(source_ip, source_ip) != 0) {
        return -1;
    }
    
    // Check IP access
    if (source_ip && check_ip_access(source_ip) != 0) {
        return -1;
    }
    
    // In real implementation, validate token against database
    // For now, we'll assume validation happens elsewhere
    
    return 0;
}

/**
 * Validate session token
 */
int validate_session_token_security(const char *session_token, const char *source_ip)
{
    if (!session_token) {
        return -1;
    }
    
    // Check rate limit for this session
    char rate_limit_key[128];
    snprintf(rate_limit_key, sizeof(rate_limit_key), "session_%.16s", session_token);
    
    if (check_rate_limit(rate_limit_key, source_ip) != 0) {
        return -1;
    }
    
    // Check IP access
    if (source_ip && check_ip_access(source_ip) != 0) {
        return -1;
    }
    
    return 0;
}

/**
 * Log security event
 */
void log_security_event(const char *event_type, const char *source_ip,
                        const char *device_id, const char *description)
{
    time_t now = time(NULL);
    char timestamp[64];
    struct tm *tm_info = localtime(&now);
    
    strftime(timestamp, sizeof(timestamp), "%Y-%m-%d %H:%M:%S", tm_info);
    
    // Log to syslog or file
    logMsg(LOG_SECURITY, "[SECURITY] %s %s %s %s: %s\n",
           timestamp,
           event_type,
           source_ip ? source_ip : "unknown",
           device_id ? device_id : "unknown",
           description ? description : "");
    
    // In real implementation, also log to database
    // log_to_security_db(event_type, source_ip, device_id, description);
}

/**
 * Detect and prevent port scanning
 */
int detect_port_scanning(const char *source_ip, uint16_t port, time_t timestamp)
{
    // Simple port scanning detection
    // In real implementation, this would track connection attempts
    // across multiple ports from the same IP
    
    static struct {
        char ip[INET_ADDRSTRLEN];
        uint16_t ports[10];
        time_t first_seen;
        time_t last_seen;
        int port_count;
    } scan_tracker = {0};
    
    time_t now = time(NULL);
    
    // Reset tracker if too old
    if (now - scan_tracker.last_seen > 300) { // 5 minutes
        memset(&scan_tracker, 0, sizeof(scan_tracker));
    }
    
    // Check if same IP
    if (strcmp(scan_tracker.ip, source_ip) == 0) {
        // Check if this is a new port
        int is_new_port = 1;
        for (int i = 0; i < scan_tracker.port_count; i++) {
            if (scan_tracker.ports[i] == port) {
                is_new_port = 0;
                break;
            }
        }
        
        if (is_new_port) {
            if (scan_tracker.port_count < 10) {
                scan_tracker.ports[scan_tracker.port_count++] = port;
            }
            
            // Check if too many different ports in short time
            if (scan_tracker.port_count >= 5 &&
                (now - scan_tracker.first_seen) < 60) { // 5 ports in 60 seconds
                
                logMsg(LOG_WARNING, "Possible port scanning detected from %s\n", source_ip);
                log_security_event("port_scanning", source_ip, NULL,
                                  "Possible port scanning detected");
                
                // Add to temporary blacklist
                add_temporary_blacklist(source_ip, 3600); // 1 hour
                
                return -1; // Detected
            }
        }
    } else {
        // New IP
        strncpy(scan_tracker.ip, source_ip, INET_ADDRSTRLEN - 1);
        scan_tracker.ip[INET_ADDRSTRLEN - 1] = '\0';
        scan_tracker.ports[0] = port;
        scan_tracker.port_count = 1;
        scan_tracker.first_seen = now;
    }
    
    scan_tracker.last_seen = now;
    
    return 0; // Not detected
}

/**
 * Add IP to temporary blacklist
 */
void add_temporary_blacklist(const char *ip_address, time_t duration)
{
    if (!ip_address) {
        return;
    }
    
    pthread_mutex_lock(&g_security_mutex);
    
    // Check if already in blacklist
    for (size_t i = 0; i < g_ip_blacklist_size; i++) {
        if (strcmp(g_ip_blacklist[i], ip_address) == 0) {
            pthread_mutex_unlock(&g_security_mutex);
            return; // Already blacklisted
        }
    }
    
    // Add to blacklist
    char **new_blacklist = realloc(g_ip_blacklist, 
                                   (g_ip_blacklist_size + 1) * sizeof(char *));
    if (!new_blacklist) {
        pthread_mutex_unlock(&g_security_mutex);
        logMsg(LOG_ERR, "Failed to allocate memory for blacklist\n");
        return;
    }
    
    g_ip_blacklist = new_blacklist;
    g_ip_blacklist[g_ip_blacklist_size] = strdup(ip_address);
    if (!g_ip_blacklist[g_ip_blacklist_size]) {
        pthread_mutex_unlock(&g_security_mutex);
        logMsg(LOG_ERR, "Failed to duplicate IP address\n");
        return;
    }
    
    g_ip_blacklist_size++;
    
    pthread_mutex_unlock(&g_security_mutex);
    
    logMsg(LOG_INFO, "Added %s to temporary blacklist for %ld seconds\n",
           ip_address, duration);
    
    // Schedule removal
    schedule_blacklist_removal(ip_address, duration);
}

/**
 * Schedule blacklist removal
 */
void schedule_blacklist_removal(const char *ip_address, time_t duration)
{
    // In real implementation, this would use a timer or background thread
    // to remove the IP from blacklist after duration
    
    // For simplicity, we'll just log
    logMsg(LOG_DEBUG, "Scheduled removal of %s from blacklist in %ld seconds\n",
           ip_address, duration);
}

/**
 * Validate JSON input to prevent injection attacks
 */
int validate_json_input(const char *json_str, size_t max_length)
{
    if (!json_str) {
        return -1;
    }
    
    // Check length
    size_t len = strlen(json_str);
    if (len > max_length) {
        logMsg(LOG_WARNING, "JSON input too long: %zu > %zu\n", len, max_length);
        return -1;
    }
    
    // Check for null bytes (potential injection)
    for (size_t i = 0; i < len; i++) {
        if (json_str[i] == '\0' && i < len - 1) {
            logMsg(LOG_WARNING, "JSON contains null byte at position %zu\n", i);
            return -1;
        }
    }
    
    // Check for suspicious patterns
    const char *suspicious_patterns[] = {
        "../",      // Directory traversal
        "..\\",     // Windows directory traversal
        "/etc/",    // System files
        "/bin/",    // System binaries
        "/dev/",    // Device files
        "<?",       // XML/HTML injection
        "<script",  // Script injection
        "javascript:", // JavaScript
        "onload=",  // Event handler
        "onerror=",
        "eval(",    // JavaScript eval
        "exec(",    // Command execution
        "system(",  // System command
        "popen(",   // Pipe open
        "fopen(",   // File open
        NULL
    };
    
    for (int i = 0; suspicious_patterns[i] != NULL; i++) {
        if (strstr(json_str, suspicious_patterns[i]) != NULL) {
            logMsg(LOG_WARNING, "JSON contains suspicious pattern: %s\n",
                   suspicious_patterns[i]);
            return -1;
        }
    }
    
    return 0; // Valid
}

/**
 * Generate secure random token
 */
int generate_secure_token(char *buffer, size_t buffer_size)
{
    if (!buffer || buffer_size < 32) {
        return -1;
    }
    
    // Use /dev/urandom for cryptographically secure random
    FILE *urandom = fopen("/dev/urandom", "rb");
    if (!urandom) {
        logMsg(LOG_ERR, "Failed to open /dev/urandom\n");
        return -1;
    }
    
    unsigned char random_bytes[32];
    if (fread(random_bytes, 1, sizeof(random_bytes), urandom) != sizeof(random_bytes)) {
        fclose(urandom);
        logMsg(LOG_ERR, "Failed to read from /dev/urandom\n");
        return -1;
    }
    
    fclose(urandom);
    
    // Convert to hex string
    const char hex_chars[] = "0123456789abcdef";
    for (size_t i = 0; i < sizeof(random_bytes) && (i * 2 + 1) < buffer_size; i++) {
        buffer[i * 2] = hex_chars[(random_bytes[i] >> 4) & 0x0F];
        buffer[i * 2 + 1] = hex_chars[random_bytes[i] & 0x0F];
    }
    
    buffer[buffer_size - 1] = '\0';
    
    return 0;
}

/**
 * Get security statistics
 */
void get_security_statistics(security_stats_t *stats)
{
    if (!stats) {
        return;
    }
    
    pthread_mutex_lock(&g_security_mutex);
    
    memset(stats, 0, sizeof(*stats));
    
    stats->rate_limit_entries = g_rate_limit_table_size;
    stats->whitelist_entries = g_ip_whitelist_size;
    stats->blacklist_entries = g_ip_blacklist_size;
    
    // Count active penalties
    time_t now = time(NULL);
    for (size_t i = 0; i < g_rate_limit_table_size; i++) {
        if (g_rate_limit_table[i].penalty_until > now) {
            stats->active_penalties++;
        }
        
        if (g_rate_limit_table[i].penalty_count >= g_rate_limit_config.max_penalties) {
            stats->permanent_blocks++;
        }
    }
    
    pthread_mutex_unlock(&g_security_mutex);
}

/**
 * Security audit logging
 */
void security_audit_log(const char *action, const char *user, const char *device_id,
                        const char *details, int success)
{
    time_t now = time(NULL);
    char timestamp[64];
    struct tm *tm_info = localtime(&now);
    
    strftime(timestamp, sizeof(timestamp), "%Y-%m-%d %H:%M:%S", tm_info);
    
    logMsg(LOG_AUDIT, "[AUDIT] %s %s %s %s %s: %s\n",
           timestamp,
           success ? "SUCCESS" : "FAILURE",
           action,
           user ? user : "unknown",
           device_id ? device_id : "unknown",
           details ? details : "");
    
    // In real implementation, log to audit database
    // log_to_audit_db(action, user, device_id, details, success, timestamp);
}