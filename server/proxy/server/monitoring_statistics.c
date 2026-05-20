//
// Monitoring and statistics for device management system
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
#include <math.h>

// Health status enumeration
typedef enum {
    HEALTH_STATUS_OK = 0,
    HEALTH_STATUS_WARNING,
    HEALTH_STATUS_ERROR
} health_status_enum_t;

// Health status structure
typedef struct health_status_s {
    time_t timestamp;
    health_status_enum_t database_status;
    health_status_enum_t device_manager_status;
    health_status_enum_t port_allocation_status;
    health_status_enum_t system_resources_status;
    char system_resources_message[256];
    health_status_enum_t port_usage_status;
    char port_usage_message[256];
    health_status_enum_t overall_status;
} health_status_t;

// Statistics structures
typedef struct device_stats_snapshot_s {
    char device_id[DEVICE_ID_MAX_LEN + 1];
    time_t timestamp;
    uint64_t bytes_sent;
    uint64_t bytes_received;
    uint32_t active_connections;
    uint32_t connection_count;
    uint32_t uptime_seconds;
    float cpu_usage;
    float memory_usage;
    uint32_t latency_ms;
} device_stats_snapshot_t;

typedef struct system_stats_s {
    time_t timestamp;
    uint32_t total_devices;
    uint32_t active_devices;
    uint32_t online_devices;
    uint32_t total_sessions;
    uint32_t active_sessions;
    uint64_t total_bytes_sent;
    uint64_t total_bytes_received;
    uint32_t total_connections;
    uint32_t peak_connections;
    uint32_t ports_used;
    uint32_t ports_available;
    float system_cpu_usage;
    float system_memory_usage;
    uint32_t security_events;
    uint32_t error_count;
} system_stats_t;

typedef struct performance_metrics_s {
    time_t period_start;
    time_t period_end;
    uint32_t request_count;
    uint32_t error_count;
    uint32_t timeout_count;
    uint32_t auth_failures;
    uint64_t total_processing_time_ms;
    uint32_t avg_response_time_ms;
    uint32_t p95_response_time_ms;
    uint32_t p99_response_time_ms;
    uint32_t max_response_time_ms;
} performance_metrics_t;

// Forward declarations for internal functions
void update_system_statistics(void);
float get_system_cpu_usage(void);
float get_system_memory_usage(void);
void update_prometheus_metrics(void);
void log_performance_metrics(performance_metrics_t *metrics);
void log_detailed_metric(const char *operation, uint32_t processing_time_ms, int success, time_t timestamp);

// Monitoring state
static pthread_mutex_t g_monitoring_mutex = PTHREAD_MUTEX_INITIALIZER;
static system_stats_t g_system_stats;
static performance_metrics_t g_performance_metrics;
static device_stats_snapshot_t *g_device_snapshots = NULL;
static size_t g_device_snapshots_size = 0;
static size_t g_device_snapshots_capacity = 0;
static time_t g_last_stats_update = 0;
static time_t g_last_metrics_reset = 0;

// Prometheus metrics buffer (for /metrics endpoint)
static char g_prometheus_metrics[65536];
static time_t g_prometheus_metrics_updated = 0;

/**
 * Initialize monitoring system
 */
int monitoring_init(void)
{
    logMsg(LOG_INFO, "Initializing monitoring system\n");
    
    memset(&g_system_stats, 0, sizeof(g_system_stats));
    g_system_stats.timestamp = time(NULL);
    
    memset(&g_performance_metrics, 0, sizeof(g_performance_metrics));
    g_performance_metrics.period_start = time(NULL);
    g_performance_metrics.period_end = g_performance_metrics.period_start + 3600; // 1 hour
    
    // Initialize device snapshots array
    g_device_snapshots_capacity = 1000;
    g_device_snapshots = calloc(g_device_snapshots_capacity, sizeof(device_stats_snapshot_t));
    if (!g_device_snapshots) {
        logMsg(LOG_ERR, "Failed to allocate device snapshots array\n");
        return -1;
    }
    
    g_device_snapshots_size = 0;
    g_last_stats_update = 0;
    g_last_metrics_reset = time(NULL);
    
    // Initialize Prometheus metrics buffer
    g_prometheus_metrics[0] = '\0';
    g_prometheus_metrics_updated = 0;
    
    logMsg(LOG_INFO, "Monitoring system initialized\n");
    
    return 0;
}

/**
 * Cleanup monitoring system
 */
void monitoring_cleanup(void)
{
    pthread_mutex_lock(&g_monitoring_mutex);
    
    if (g_device_snapshots) {
        free(g_device_snapshots);
        g_device_snapshots = NULL;
    }
    
    g_device_snapshots_size = 0;
    g_device_snapshots_capacity = 0;
    
    pthread_mutex_unlock(&g_monitoring_mutex);
    
    logMsg(LOG_INFO, "Monitoring system cleaned up\n");
}

/**
 * Update device statistics
 */
int update_device_statistics_monitoring(const char *device_id,
                                        uint64_t bytes_sent,
                                        uint64_t bytes_received,
                                        uint32_t active_connections,
                                        uint32_t connection_count,
                                        uint32_t uptime_seconds,
                                        float cpu_usage,
                                        float memory_usage,
                                        uint32_t latency_ms)
{
    if (!device_id) {
        return -1;
    }
    
    pthread_mutex_lock(&g_monitoring_mutex);
    
    time_t now = time(NULL);
    
    // Find existing snapshot
    device_stats_snapshot_t *snapshot = NULL;
    for (size_t i = 0; i < g_device_snapshots_size; i++) {
        if (strcmp(g_device_snapshots[i].device_id, device_id) == 0) {
            snapshot = &g_device_snapshots[i];
            break;
        }
    }
    
    // Create new snapshot if not found
    if (!snapshot) {
        if (g_device_snapshots_size >= g_device_snapshots_capacity) {
            // Resize array
            size_t new_capacity = g_device_snapshots_capacity * 2;
            device_stats_snapshot_t *new_snapshots = realloc(g_device_snapshots,
                                                           new_capacity * sizeof(device_stats_snapshot_t));
            if (!new_snapshots) {
                pthread_mutex_unlock(&g_monitoring_mutex);
                logMsg(LOG_WARNING, "Device snapshots array full\n");
                return -1;
            }
            
            g_device_snapshots = new_snapshots;
            g_device_snapshots_capacity = new_capacity;
            
            // Clear new entries
            memset(&g_device_snapshots[g_device_snapshots_size], 0,
                   (new_capacity - g_device_snapshots_size) * sizeof(device_stats_snapshot_t));
        }
        
        snapshot = &g_device_snapshots[g_device_snapshots_size];
        strncpy(snapshot->device_id, device_id, DEVICE_ID_MAX_LEN);
        snapshot->device_id[DEVICE_ID_MAX_LEN] = '\0';
        
        g_device_snapshots_size++;
    }
    
    // Update snapshot
    snapshot->timestamp = now;
    snapshot->bytes_sent = bytes_sent;
    snapshot->bytes_received = bytes_received;
    snapshot->active_connections = active_connections;
    snapshot->connection_count = connection_count;
    snapshot->uptime_seconds = uptime_seconds;
    snapshot->cpu_usage = cpu_usage;
    snapshot->memory_usage = memory_usage;
    snapshot->latency_ms = latency_ms;
    
    // Update system statistics
    update_system_statistics();
    
    pthread_mutex_unlock(&g_monitoring_mutex);
    
    return 0;
}

/**
 * Update system statistics
 */
void update_system_statistics(void)
{
    time_t now = time(NULL);
    
    // Don't update too frequently (max once per second)
    if (now - g_last_stats_update < 1) {
        return;
    }
    
    g_last_stats_update = now;
    
    // Reset statistics
    memset(&g_system_stats, 0, sizeof(g_system_stats));
    g_system_stats.timestamp = now;
    
    // Calculate device statistics
    uint32_t online_count = 0;
    
    for (size_t i = 0; i < g_device_snapshots_size; i++) {
        device_stats_snapshot_t *snapshot = &g_device_snapshots[i];
        
        // Check if device is online (updated in last 5 minutes)
        if (now - snapshot->timestamp <= 300) {
            online_count++;
            
            g_system_stats.total_bytes_sent += snapshot->bytes_sent;
            g_system_stats.total_bytes_received += snapshot->bytes_received;
            g_system_stats.total_connections += snapshot->connection_count;
            
            if (snapshot->active_connections > g_system_stats.peak_connections) {
                g_system_stats.peak_connections = snapshot->active_connections;
            }
        }
    }
    
    // Get device counts from database (in real implementation)
    // For now, use snapshot count
    g_system_stats.total_devices = g_device_snapshots_size;
    g_system_stats.online_devices = online_count;
    g_system_stats.active_devices = online_count; // Simplified
    
    // Get session counts (would query database in real implementation)
    g_system_stats.total_sessions = g_system_stats.active_devices;
    g_system_stats.active_sessions = g_system_stats.active_devices;
    
    // Get port usage (would query database in real implementation)
    g_system_stats.ports_used = g_system_stats.active_devices;
    g_system_stats.ports_available = 1001 - g_system_stats.ports_used; // 6000-7000 range
    
    // Get system resource usage (would use system calls in real implementation)
    g_system_stats.system_cpu_usage = get_system_cpu_usage();
    g_system_stats.system_memory_usage = get_system_memory_usage();
    
    // Update Prometheus metrics
    update_prometheus_metrics();
}

/**
 * Record performance metric
 */
void record_performance_metric(const char *operation, uint32_t processing_time_ms, int success)
{
    pthread_mutex_lock(&g_monitoring_mutex);
    
    time_t now = time(NULL);
    
    // Reset metrics if period has ended
    if (now >= g_performance_metrics.period_end) {
        // Save old metrics (would log to database in real implementation)
        log_performance_metrics(&g_performance_metrics);
        
        // Start new period
        g_performance_metrics.period_start = now;
        g_performance_metrics.period_end = now + 3600; // 1 hour
        memset(&g_performance_metrics, 0, sizeof(g_performance_metrics));
        g_performance_metrics.period_start = now;
        g_performance_metrics.period_end = now + 3600;
    }
    
    // Update metrics
    g_performance_metrics.request_count++;
    g_performance_metrics.total_processing_time_ms += processing_time_ms;
    
    if (!success) {
        g_performance_metrics.error_count++;
        
        if (strcmp(operation, "auth") == 0) {
            g_performance_metrics.auth_failures++;
        } else if (processing_time_ms > 10000) { // 10 second timeout
            g_performance_metrics.timeout_count++;
        }
    }
    
    // Update response time percentiles (simplified)
    if (processing_time_ms > g_performance_metrics.max_response_time_ms) {
        g_performance_metrics.max_response_time_ms = processing_time_ms;
    }
    
    // Calculate average
    g_performance_metrics.avg_response_time_ms = 
        g_performance_metrics.total_processing_time_ms / g_performance_metrics.request_count;
    
    // In real implementation, would maintain a histogram for percentiles
    // For now, use simplified calculation
    if (processing_time_ms > g_performance_metrics.p95_response_time_ms * 0.95) {
        g_performance_metrics.p95_response_time_ms = processing_time_ms;
    }
    
    if (processing_time_ms > g_performance_metrics.p99_response_time_ms * 0.99) {
        g_performance_metrics.p99_response_time_ms = processing_time_ms;
    }
    
    pthread_mutex_unlock(&g_monitoring_mutex);
    
    // Log detailed metric (would go to metrics database in real implementation)
    log_detailed_metric(operation, processing_time_ms, success, now);
}

/**
 * Get system statistics
 */
int get_system_statistics(system_stats_t *stats)
{
    if (!stats) {
        return -1;
    }
    
    pthread_mutex_lock(&g_monitoring_mutex);
    
    // Update statistics before returning
    update_system_statistics();
    
    memcpy(stats, &g_system_stats, sizeof(*stats));
    
    pthread_mutex_unlock(&g_monitoring_mutex);
    
    return 0;
}

/**
 * Get device statistics
 */
int get_device_statistics(const char *device_id, device_stats_snapshot_t *stats)
{
    if (!device_id || !stats) {
        return -1;
    }
    
    pthread_mutex_lock(&g_monitoring_mutex);
    
    int found = 0;
    
    for (size_t i = 0; i < g_device_snapshots_size; i++) {
        if (strcmp(g_device_snapshots[i].device_id, device_id) == 0) {
            memcpy(stats, &g_device_snapshots[i], sizeof(*stats));
            found = 1;
            break;
        }
    }
    
    pthread_mutex_unlock(&g_monitoring_mutex);
    
    return found ? 0 : -1;
}

/**
 * Get performance metrics
 */
int get_performance_metrics(performance_metrics_t *metrics)
{
    if (!metrics) {
        return -1;
    }
    
    pthread_mutex_lock(&g_monitoring_mutex);
    
    memcpy(metrics, &g_performance_metrics, sizeof(*metrics));
    
    pthread_mutex_unlock(&g_monitoring_mutex);
    
    return 0;
}

/**
 * Update Prometheus metrics
 */
void update_prometheus_metrics(void)
{
    time_t now = time(NULL);
    
    // Don't update too frequently (max once per 5 seconds)
    if (now - g_prometheus_metrics_updated < 5) {
        return;
    }
    
    char buffer[65536];
    int offset = 0;
    
    // System metrics
    offset += snprintf(buffer + offset, sizeof(buffer) - offset,
        "# HELP net_port_total_devices Total number of registered devices\n"
        "# TYPE net_port_total_devices gauge\n"
        "net_port_total_devices %u\n\n",
        g_system_stats.total_devices);
    
    offset += snprintf(buffer + offset, sizeof(buffer) - offset,
        "# HELP net_port_active_devices Number of active devices\n"
        "# TYPE net_port_active_devices gauge\n"
        "net_port_active_devices %u\n\n",
        g_system_stats.active_devices);
    
    offset += snprintf(buffer + offset, sizeof(buffer) - offset,
        "# HELP net_port_online_devices Number of online devices (heartbeat < 5min)\n"
        "# TYPE net_port_online_devices gauge\n"
        "net_port_online_devices %u\n\n",
        g_system_stats.online_devices);
    
    offset += snprintf(buffer + offset, sizeof(buffer) - offset,
        "# HELP net_port_bytes_sent_total Total bytes sent\n"
        "# TYPE net_port_bytes_sent_total counter\n"
        "net_port_bytes_sent_total %llu\n\n",
        (unsigned long long)g_system_stats.total_bytes_sent);
    
    offset += snprintf(buffer + offset, sizeof(buffer) - offset,
        "# HELP net_port_bytes_received_total Total bytes received\n"
        "# TYPE net_port_bytes_received_total counter\n"
        "net_port_bytes_received_total %llu\n\n",
        (unsigned long long)g_system_stats.total_bytes_received);
    
    offset += snprintf(buffer + offset, sizeof(buffer) - offset,
        "# HELP net_port_connections_total Total connections\n"
        "# TYPE net_port_connections_total counter\n"
        "net_port_connections_total %u\n\n",
        g_system_stats.total_connections);
    
    offset += snprintf(buffer + offset, sizeof(buffer) - offset,
        "# HELP net_port_peak_connections Peak concurrent connections\n"
        "# TYPE net_port_peak_connections gauge\n"
        "net_port_peak_connections %u\n\n",
        g_system_stats.peak_connections);
    
    offset += snprintf(buffer + offset, sizeof(buffer) - offset,
        "# HELP net_port_ports_used Number of ports in use\n"
        "# TYPE net_port_ports_used gauge\n"
        "net_port_ports_used %u\n\n",
        g_system_stats.ports_used);
    
    offset += snprintf(buffer + offset, sizeof(buffer) - offset,
        "# HELP net_port_ports_available Number of ports available\n"
        "# TYPE net_port_ports_available gauge\n"
        "net_port_ports_available %u\n\n",
        g_system_stats.ports_available);
    
    offset += snprintf(buffer + offset, sizeof(buffer) - offset,
        "# HELP net_port_system_cpu_usage System CPU usage percentage\n"
        "# TYPE net_port_system_cpu_usage gauge\n"
        "net_port_system_cpu_usage %.2f\n\n",
        g_system_stats.system_cpu_usage);
    
    offset += snprintf(buffer + offset, sizeof(buffer) - offset,
        "# HELP net_port_system_memory_usage System memory usage percentage\n"
        "# TYPE net_port_system_memory_usage gauge\n"
        "net_port_system_memory_usage %.2f\n\n",
        g_system_stats.system_memory_usage);
    
    // Performance metrics
    offset += snprintf(buffer + offset, sizeof(buffer) - offset,
        "# HELP net_port_requests_total Total requests\n"
        "# TYPE net_port_requests_total counter\n"
        "net_port_requests_total %u\n\n",
        g_performance_metrics.request_count);
    
    offset += snprintf(buffer + offset, sizeof(buffer) - offset,
        "# HELP net_port_errors_total Total errors\n"
        "# TYPE net_port_errors_total counter\n"
        "net_port_errors_total %u\n\n",
        g_performance_metrics.error_count);
    
    offset += snprintf(buffer + offset, sizeof(buffer) - offset,
        "# HELP net_port_auth_failures_total Authentication failures\n"
        "# TYPE net_port_auth_failures_total counter\n"
        "net_port_auth_failures_total %u\n\n",
        g_performance_metrics.auth_failures);
    
    offset += snprintf(buffer + offset, sizeof(buffer) - offset,
        "# HELP net_port_timeouts_total Request timeouts\n"
        "# TYPE net_port_timeouts_total counter\n"
        "net_port_timeouts_total %u\n\n",
        g_performance_metrics.timeout_count);
    
    offset += snprintf(buffer + offset, sizeof(buffer) - offset,
        "# HELP net_port_response_time_average Average response time in milliseconds\n"
        "# TYPE net_port_response_time_average gauge\n"
        "net_port_response_time_average %u\n\n",
        g_performance_metrics.avg_response_time_ms);
    
    offset += snprintf(buffer + offset, sizeof(buffer) - offset,
        "# HELP net_port_response_time_p95 95th percentile response time in milliseconds\n"
        "# TYPE net_port_response_time_p95 gauge\n"
        "net_port_response_time_p95 %u\n\n",
        g_performance_metrics.p95_response_time_ms);
    
    offset += snprintf(buffer + offset, sizeof(buffer) - offset,
        "# HELP net_port_response_time_p99 99th percentile response time in milliseconds\n"
        "# TYPE net_port_response_time_p99 gauge\n"
        "net_port_response_time_p99 %u\n\n",
        g_performance_metrics.p99_response_time_ms);
    
    offset += snprintf(buffer + offset, sizeof(buffer) - offset,
        "# HELP net_port_response_time_max Maximum response time in milliseconds\n"
        "# TYPE net_port_response_time_max gauge\n"
        "net_port_response_time_max %u\n",
        g_performance_metrics.max_response_time_ms);
    
    // Copy to global buffer
    pthread_mutex_lock(&g_monitoring_mutex);
    strncpy(g_prometheus_metrics, buffer, sizeof(g_prometheus_metrics) - 1);
    g_prometheus_metrics[sizeof(g_prometheus_metrics) - 1] = '\0';
    g_prometheus_metrics_updated = now;
    pthread_mutex_unlock(&g_monitoring_mutex);
}

/**
 * Get Prometheus metrics
 */
const char* get_prometheus_metrics(void)
{
    pthread_mutex_lock(&g_monitoring_mutex);
    
    // Update metrics if stale
    if (time(NULL) - g_prometheus_metrics_updated >= 5) {
        update_prometheus_metrics();
    }
    
    const char *metrics = g_prometheus_metrics;
    
    pthread_mutex_unlock(&g_monitoring_mutex);
    
    return metrics;
}

/**
 * Generate health check response
 */
int get_health_status(health_status_t *health)
{
    if (!health) {
        return -1;
    }
    
    time_t now = time(NULL);
    
    memset(health, 0, sizeof(*health));
    health->timestamp = now;
    
    // Check database connectivity (simplified)
    health->database_status = HEALTH_STATUS_OK;
    
    // Check device manager
    health->device_manager_status = HEALTH_STATUS_OK;
    
    // Check port allocation
    health->port_allocation_status = HEALTH_STATUS_OK;
    
    // Check system resources
    float cpu_usage = get_system_cpu_usage();
    float memory_usage = get_system_memory_usage();
    
    if (cpu_usage > 90.0) {
        health->system_resources_status = HEALTH_STATUS_WARNING;
        snprintf(health->system_resources_message, sizeof(health->system_resources_message),
                "High CPU usage: %.1f%%", cpu_usage);
    } else if (memory_usage > 90.0) {
        health->system_resources_status = HEALTH_STATUS_WARNING;
        snprintf(health->system_resources_message, sizeof(health->system_resources_message),
                "High memory usage: %.1f%%", memory_usage);
    } else {
        health->system_resources_status = HEALTH_STATUS_OK;
    }
    
    // Check port usage
    uint32_t ports_used = g_system_stats.ports_used;
    uint32_t ports_total = 1001; // 6000-7000 range
    
    if (ports_used > ports_total * 0.9) {
        health->port_usage_status = HEALTH_STATUS_WARNING;
        snprintf(health->port_usage_message, sizeof(health->port_usage_message),
                "High port usage: %u/%u (%.1f%%)", ports_used, ports_total,
                (float)ports_used / ports_total * 100.0);
    } else {
        health->port_usage_status = HEALTH_STATUS_OK;
    }
    
    // Calculate overall status
    if (health->database_status == HEALTH_STATUS_ERROR ||
        health->device_manager_status == HEALTH_STATUS_ERROR) {
        health->overall_status = HEALTH_STATUS_ERROR;
    } else if (health->system_resources_status == HEALTH_STATUS_WARNING ||
               health->port_usage_status == HEALTH_STATUS_WARNING) {
        health->overall_status = HEALTH_STATUS_WARNING;
    } else {
        health->overall_status = HEALTH_STATUS_OK;
    }
    
    return 0;
}

/**
 * Log performance metrics (stub implementation)
 */
void log_performance_metrics(performance_metrics_t *metrics)
{
    // In real implementation, would write to database or log file
    logMsg(LOG_INFO, "Performance metrics for period %ld-%ld:\n",
           metrics->period_start, metrics->period_end);
    logMsg(LOG_INFO, "  Requests: %u\n", metrics->request_count);
    logMsg(LOG_INFO, "  Errors: %u\n", metrics->error_count);
    logMsg(LOG_INFO, "  Avg response time: %u ms\n", metrics->avg_response_time_ms);
    logMsg(LOG_INFO, "  P95 response time: %u ms\n", metrics->p95_response_time_ms);
    logMsg(LOG_INFO, "  Max response time: %u ms\n", metrics->max_response_time_ms);
}

/**
 * Log detailed metric (stub implementation)
 */
void log_detailed_metric(const char *operation, uint32_t processing_time_ms, int success, time_t timestamp)
{
    // In real implementation, would write to metrics database
    // For now, just log at debug level
    logMsg(LOG_DEBUG, "Metric: %s %u ms %s\n",
           operation, processing_time_ms, success ? "OK" : "ERROR");
}

/**
 * Get system CPU usage (stub implementation)
 */
float get_system_cpu_usage(void)
{
    // In real implementation, would read /proc/stat
    // For now, return a dummy value
    return 25.5f; // 25.5% CPU usage
}

/**
 * Get system memory usage (stub implementation)
 */
float get_system_memory_usage(void)
{
    // In real implementation, would read /proc/meminfo
    // For now, return a dummy value
    return 65.2f; // 65.2% memory usage
}

/**
 * Generate statistics report
 */
int generate_statistics_report(time_t start_time, time_t end_time, char *report, size_t report_size)
{
    if (!report || report_size < 1024) {
        return -1;
    }
    
    system_stats_t stats;
    get_system_statistics(&stats);
    
    int offset = snprintf(report, report_size,
        "Net Port System Statistics Report\n"
        "================================\n"
        "Generated: %s"
        "Report Period: %s - %s\n\n"
        "Device Statistics:\n"
        "  Total Devices: %u\n"
        "  Active Devices: %u\n"
        "  Online Devices: %u\n"
        "  Offline Devices: %u\n\n"
        "Traffic Statistics:\n"
        "  Total Bytes Sent: %llu\n"
        "  Total Bytes Received: %llu\n"
        "  Total Connections: %u\n"
        "  Peak Concurrent Connections: %u\n\n"
        "Port Usage:\n"
        "  Ports Used: %u\n"
        "  Ports Available: %u\n"
        "  Usage Percentage: %.1f%%\n\n"
        "System Resources:\n"
        "  CPU Usage: %.1f%%\n"
        "  Memory Usage: %.1f%%\n\n"
        "Performance Metrics (last hour):\n"
        "  Total Requests: %u\n"
        "  Errors: %u (%.1f%%)\n"
        "  Authentication Failures: %u\n"
        "  Timeouts: %u\n"
        "  Average Response Time: %u ms\n"
        "  95th Percentile Response Time: %u ms\n"
        "  Maximum Response Time: %u ms\n",
        ctime(&end_time),
        ctime(&start_time), ctime(&end_time),
        stats.total_devices,
        stats.active_devices,
        stats.online_devices,
        stats.total_devices - stats.online_devices,
        (unsigned long long)stats.total_bytes_sent,
        (unsigned long long)stats.total_bytes_received,
        stats.total_connections,
        stats.peak_connections,
        stats.ports_used,
        stats.ports_available,
        stats.ports_used * 100.0 / (stats.ports_used + stats.ports_available),
        stats.system_cpu_usage,
        stats.system_memory_usage,
        g_performance_metrics.request_count,
        g_performance_metrics.error_count,
        g_performance_metrics.request_count > 0 ? 
            (float)g_performance_metrics.error_count / g_performance_metrics.request_count * 100.0 : 0.0,
        g_performance_metrics.auth_failures,
        g_performance_metrics.timeout_count,
        g_performance_metrics.avg_response_time_ms,
        g_performance_metrics.p95_response_time_ms,
        g_performance_metrics.max_response_time_ms);
    
    return offset;
}