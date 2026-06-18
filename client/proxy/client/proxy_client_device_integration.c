//
// Modified proxy_client.c with device registration integration
//

#include "proxy_client.h"
#include "device_heartbeat.h"
#include "logMsg.h"
#include "time_counter.h"
#include "settings.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <errno.h>
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
static const int g_registration_retry_seconds = 10;
static volatile sig_atomic_t g_device_session_revoked = 0;
static volatile sig_atomic_t g_registration_wait_running = 0;
static SSL_CTX *g_device_control_ssl_ctx = NULL;
static bool g_device_control_ssl_enabled = true;
static char g_registration_ca_file[512] = "";

static void log_registration_failure(const char *message)
{
    if (message &&
        (strstr(message, "Authentication failed") != NULL ||
         strstr(message, "Failed to create session") != NULL)) {
        logMsg(LOG_INFO, "Registration waiting for server permission: %s\n", message);
        return;
    }

    if (message) {
        logMsg(LOG_WARNING, "Registration failed: %s\n", message);
    } else {
        logMsg(LOG_WARNING, "Registration failed\n");
    }
}

static void log_registration_transport_failure(const char *details)
{
    logMsg(LOG_WARNING, "Registration transport error: %s\n", details);
}

void device_registration_set_control_tls(const char *ca_file, bool enable_ssl)
{
    g_device_control_ssl_enabled = enable_ssl;
    g_registration_ca_file[0] = '\0';

    if (ca_file && ca_file[0]) {
        strncpy(g_registration_ca_file, ca_file, sizeof(g_registration_ca_file) - 1);
        g_registration_ca_file[sizeof(g_registration_ca_file) - 1] = '\0';
    }
}

static int ensure_device_control_ssl_ctx(void)
{
    if (!g_device_control_ssl_enabled) {
        return 0;
    }

    if (g_device_control_ssl_ctx) {
        return 0;
    }

    g_device_control_ssl_ctx = create_device_control_ssl_context(
        g_registration_ca_file[0] ? g_registration_ca_file : NULL);
    if (!g_device_control_ssl_ctx) {
        logMsg(LOG_ERR, "Failed to create device control SSL context\n");
        return -1;
    }

    return 0;
}

static int device_control_connect(int *sock_out, SSL **ssl_out)
{
    int sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock < 0) {
        logMsg(LOG_ERR, "Failed to create socket for device control: %s\n", strerror(errno));
        return -1;
    }

    struct timeval timeout = {10, 0};
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));

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
        log_registration_transport_failure(strerror(errno));
        close(sock);
        return -1;
    }

    SSL *ssl = NULL;
    if (g_device_control_ssl_enabled) {
        if (ensure_device_control_ssl_ctx() != 0) {
            close(sock);
            return -1;
        }

        ssl = SSL_new(g_device_control_ssl_ctx);
        if (!ssl) {
            logMsg(LOG_ERR, "Failed to create SSL object for device control\n");
            close(sock);
            return -1;
        }

        SSL_set_fd(ssl, sock);
        if (SSL_connect(ssl) != 1) {
            logMsg(LOG_ERR, "Device control SSL handshake failed: %s\n",
                   ERR_error_string(ERR_get_error(), NULL));
            SSL_free(ssl);
            close(sock);
            return -1;
        }
    }

    *sock_out = sock;
    *ssl_out = ssl;
    return 0;
}

static ssize_t device_control_send(int sock, SSL *ssl, const char *data, size_t len)
{
    if (ssl) {
        return SSL_write(ssl, data, (int)len);
    }

    return send(sock, data, len, 0);
}

static ssize_t device_control_recv(int sock, SSL *ssl, char *buffer, size_t buflen)
{
    if (ssl) {
        return SSL_read(ssl, buffer, (int)buflen);
    }

    return recv(sock, buffer, buflen, 0);
}

static void device_control_disconnect(int sock, SSL *ssl)
{
    if (ssl) {
        SSL_shutdown(ssl);
        SSL_free(ssl);
    }
    close(sock);
}

int device_session_is_revoked(void)
{
    return g_device_session_revoked != 0;
}

void device_session_set_revoked(int revoked)
{
    g_device_session_revoked = revoked ? 1 : 0;
}

static heartbeat_config_t g_heartbeat_config;
static bool g_cli_output_host = false;
static bool g_cli_output_port = false;
static uint16_t g_port_host_base = 0;
static uint16_t g_port_range_start = 6000;
static uint16_t g_tunnel_port_override = 0;

static bool argv_has_flag(int argc, char **argv, const char *flag)
{
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], flag) == 0) {
            return true;
        }
    }
    return false;
}

static void apply_tunnel_tls_client_settings(proxy_server_thread_data_t *settings);

static void apply_tunnel_settings(proxy_server_thread_data_t *settings)
{
    if (!settings) {
        return;
    }

    uint16_t tunnel_connect_port = g_device_state.tunnel_port;

    if (g_tunnel_port_override != 0) {
        tunnel_connect_port = g_tunnel_port_override;
    } else if (g_port_host_base != 0) {
        tunnel_connect_port = (uint16_t)(g_port_host_base +
            (g_device_state.tunnel_port - g_port_range_start));
    }

    strncpy(settings->input_address, g_device_state.server_host,
            sizeof(settings->input_address) - 1);
    settings->input_address[sizeof(settings->input_address) - 1] = '\0';
    settings->input_port = tunnel_connect_port;

    logMsg(LOG_INFO, "Configured proxy tunnel to %s:%d (server tunnel %d, external %d)\n",
           settings->input_address, tunnel_connect_port,
           g_device_state.tunnel_port, g_device_state.assigned_port);
    if (g_port_host_base != 0 && g_tunnel_port_override == 0) {
        logMsg(LOG_INFO, "Using port-host-base %u (map internal %u-%u -> host %u+)\n",
               g_port_host_base, g_port_range_start, g_port_range_start + 9, g_port_host_base);
    }

    apply_tunnel_tls_client_settings(settings);
}

static void apply_tunnel_tls_client_settings(proxy_server_thread_data_t *settings)
{
    if (!settings || !g_device_state.tunnel_tls) {
        if (settings) {
            settings->enable_ssl = false;
            settings->ca_file[0] = '\0';
        }
        return;
    }

    if (g_registration_ca_file[0] == '\0') {
        logMsg(LOG_WARNING,
               "Server requires tunnel TLS but no --registration-ca-file/--ca-file was provided\n");
        return;
    }

    /* TLS to server tunnel port uses the client "input" socket (enable_ssl), not output to local SSH. */
    settings->enable_ssl = true;
    strncpy(settings->ca_file, g_registration_ca_file, sizeof(settings->ca_file) - 1);
    settings->ca_file[sizeof(settings->ca_file) - 1] = '\0';
    logMsg(LOG_INFO, "Tunnel TLS enabled on server link (CA %s)\n", settings->ca_file);
}

static void apply_output_target_from_registration(proxy_server_thread_data_t *settings)
{
    if (!settings) {
        return;
    }

    if (!g_cli_output_host) {
        if (g_device_state.internal_address[0] != '\0') {
            strncpy(settings->output_address, g_device_state.internal_address,
                    sizeof(settings->output_address) - 1);
            settings->output_address[sizeof(settings->output_address) - 1] = '\0';
            logMsg(LOG_INFO, "Using internal_address from registration: %s\n",
                   settings->output_address);
        } else if (g_device_state.internal_port != 0) {
            strncpy(settings->output_address, "127.0.0.1",
                    sizeof(settings->output_address) - 1);
            settings->output_address[sizeof(settings->output_address) - 1] = '\0';
            logMsg(LOG_INFO, "Using default internal_address 127.0.0.1 for registered port %d\n",
                   g_device_state.internal_port);
        }
    }

    if (!g_cli_output_port && g_device_state.internal_port != 0) {
        settings->output_port = g_device_state.internal_port;
        logMsg(LOG_INFO, "Using internal_port from registration: %d\n",
               settings->output_port);
    }
}

static int validate_output_target(const proxy_server_thread_data_t *settings)
{
    if (!settings || settings->output_port == 0) {
        logMsg(LOG_ERR,
               "Output target is not configured. Set internal_port in web UI or use -p_out\n");
        return -1;
    }

    if (settings->output_address[0] == '\0') {
        logMsg(LOG_ERR,
               "Output address is not configured. Set internal_address in web UI or use --host_out\n");
        return -1;
    }

    return 0;
}

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
    g_heartbeat_config.enable_ssl = g_device_control_ssl_enabled;
    g_heartbeat_config.ssl_ctx = g_device_control_ssl_ctx;
    
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
    
    if (device_control_connect(&sock, &ssl) != 0) {
        return -1;
    }

    struct timeval recv_timeout = {30, 0};
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &recv_timeout, sizeof(recv_timeout));
    
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
        device_control_disconnect(sock, ssl);
        return -1;
    }
    
    // Send request
    size_t len = strlen(json_str);
    ssize_t sent = device_control_send(sock, ssl, json_str, len);
    
    free(json_str);
    
    if (sent != (ssize_t)len) {
        logMsg(LOG_ERR, "Failed to send registration request\n");
        device_control_disconnect(sock, ssl);
        return -1;
    }
    
    // Receive response
    char buffer[4096];
    ssize_t received = device_control_recv(sock, ssl, buffer, sizeof(buffer) - 1);
    
    if (received <= 0) {
        log_registration_transport_failure("no response from registration server");
        device_control_disconnect(sock, ssl);
        return -1;
    }
    
    buffer[received] = '\0';
    
    // Parse response
    json_error_t error;
    json_t *response = json_loads(buffer, 0, &error);
    
    if (!response) {
        logMsg(LOG_ERR, "Failed to parse registration response: %s\n", error.text);
        device_control_disconnect(sock, ssl);
        return -1;
    }
    
    // Check response
    json_t *status_obj = json_object_get(response, "status");
    if (!json_is_string(status_obj)) {
        logMsg(LOG_ERR, "Invalid registration response format\n");
        json_decref(response);
        device_control_disconnect(sock, ssl);
        return -1;
    }
    
    const char *status = json_string_value(status_obj);
    
    if (strcmp(status, "authenticated") == 0) {
        // Registration successful
        json_t *port_obj = json_object_get(response, "assigned_port");
        json_t *tunnel_obj = json_object_get(response, "tunnel_port");
        json_t *token_obj = json_object_get(response, "session_token");
        json_t *interval_obj = json_object_get(response, "heartbeat_interval");
        
        if (json_is_integer(port_obj) && json_is_string(token_obj)) {
            g_device_state.assigned_port = (uint16_t)json_integer_value(port_obj);
            if (json_is_integer(tunnel_obj)) {
                g_device_state.tunnel_port = (uint16_t)json_integer_value(tunnel_obj);
            } else {
                g_device_state.tunnel_port = (uint16_t)(g_device_state.assigned_port + 1);
            }
            strncpy(g_device_state.session_token, json_string_value(token_obj), SESSION_TOKEN_MAX_LEN);
            
            if (json_is_integer(interval_obj)) {
                g_device_state.heartbeat_interval = (uint32_t)json_integer_value(interval_obj);
            }

            json_t *internal_addr_obj = json_object_get(response, "internal_address");
            json_t *internal_port_obj = json_object_get(response, "internal_port");
            g_device_state.internal_address[0] = '\0';
            g_device_state.internal_port = 0;
            if (json_is_string(internal_addr_obj)) {
                strncpy(g_device_state.internal_address,
                        json_string_value(internal_addr_obj),
                        sizeof(g_device_state.internal_address) - 1);
                g_device_state.internal_address[sizeof(g_device_state.internal_address) - 1] = '\0';
            }
            if (json_is_integer(internal_port_obj)) {
                g_device_state.internal_port = (uint16_t)json_integer_value(internal_port_obj);
            }

            g_device_state.input_tls = false;
            g_device_state.tunnel_tls = false;
            json_t *input_tls_obj = json_object_get(response, "input_tls");
            json_t *tunnel_tls_obj = json_object_get(response, "tunnel_tls");
            if (json_is_true(input_tls_obj)) {
                g_device_state.input_tls = true;
            }
            if (json_is_true(tunnel_tls_obj)) {
                g_device_state.tunnel_tls = true;
            }
            
            g_device_state.status = DEVICE_STATUS_REGISTERED;
            g_device_state.registered_at = time(NULL);
            
            strncpy(g_heartbeat_config.session_token, g_device_state.session_token, SESSION_TOKEN_MAX_LEN);
            g_heartbeat_config.assigned_port = g_device_state.assigned_port;
            g_heartbeat_config.heartbeat_interval = g_device_state.heartbeat_interval;
            g_heartbeat_config.enable_ssl = g_device_control_ssl_enabled;
            g_heartbeat_config.ssl_ctx = g_device_control_ssl_ctx;
            
            result = 0;
            
            logMsg(LOG_INFO, "Device registered successfully\n");
            logMsg(LOG_INFO, "  External port: %d\n", g_device_state.assigned_port);
            logMsg(LOG_INFO, "  Tunnel port: %d\n", g_device_state.tunnel_port);
            if (g_device_state.input_tls) {
                logMsg(LOG_INFO, "  External port uses TLS (openssl s_client -connect host:%d)\n",
                       g_device_state.assigned_port);
            }
            if (g_device_state.tunnel_tls) {
                logMsg(LOG_INFO, "  Tunnel port uses TLS (client needs -e and CA file)\n");
            }
            if (g_device_state.internal_port != 0) {
                logMsg(LOG_INFO, "  Internal target: %s:%d\n",
                       g_device_state.internal_address[0] != '\0'
                           ? g_device_state.internal_address
                           : "127.0.0.1",
                       g_device_state.internal_port);
            }
            logMsg(LOG_INFO, "  Heartbeat interval: %d seconds\n", g_device_state.heartbeat_interval);
        } else {
            logMsg(LOG_ERR, "Missing required fields in registration response\n");
        }
    } else {
        json_t *message_obj = json_object_get(response, "message");
        const char *message = json_is_string(message_obj) ? json_string_value(message_obj) : "Unknown error";
        
        log_registration_failure(message);
    }
    
    json_decref(response);
    device_control_disconnect(sock, ssl);
    
    return result;
}

int device_register_until_allowed(void)
{
    int attempt = 0;

    while (!global_graceful_shutdown) {
        attempt++;

        if (device_register_with_server() == 0) {
            if (attempt > 1) {
                logMsg(LOG_INFO, "Device registered successfully after %d attempt(s)\n", attempt);
            }
            device_session_set_revoked(0);
            return 0;
        }

        logMsg(LOG_INFO, "Registration attempt %d failed, retrying in %d seconds...\n",
               attempt, g_registration_retry_seconds);

        for (int i = 0; i < g_registration_retry_seconds && !global_graceful_shutdown; i++) {
            sleep(1);
        }
    }

    logMsg(LOG_INFO, "Registration retry loop stopped due to shutdown\n");
    return -1;
}

static int device_apply_reregistration(void)
{
    strncpy(g_heartbeat_config.session_token, g_device_state.session_token, SESSION_TOKEN_MAX_LEN);
    g_heartbeat_config.assigned_port = g_device_state.assigned_port;

    proxy_server_thread_data_t *settings = get_client_settings();
    apply_tunnel_settings(settings);
    apply_output_target_from_registration(settings);
    if (validate_output_target(settings) != 0) {
        return -1;
    }

    refresh_client_ssl_context();

    heartbeat_update_config(&g_heartbeat_config);
    g_device_state.status = DEVICE_STATUS_CONNECTED;
    switcher_servers_restart_input_threads();
    logMsg(LOG_INFO, "Device tunnel settings updated after registration\n");
    return 0;
}

void device_apply_tls_settings_update(bool input_tls, bool tunnel_tls, bool force_reload)
{
    bool changed = g_device_state.input_tls != input_tls || g_device_state.tunnel_tls != tunnel_tls;

    if (!changed && !force_reload) {
        return;
    }

    g_device_state.input_tls = input_tls;
    g_device_state.tunnel_tls = tunnel_tls;

    proxy_server_thread_data_t *settings = get_client_settings();
    apply_tunnel_settings(settings);
    refresh_client_ssl_context();

    switcher_servers_drop_active_connections();
    switcher_servers_restart_input_threads();

    logMsg(LOG_INFO,
           "Device TLS settings updated (input_tls=%d tunnel_tls=%d force=%d)\n",
           input_tls ? 1 : 0, tunnel_tls ? 1 : 0, force_reload ? 1 : 0);
}

static void *registration_wait_thread(void *arg)
{
    (void)arg;

    if (device_register_until_allowed() != 0) {
        g_registration_wait_running = 0;
        return NULL;
    }

    device_session_set_revoked(0);

    if (device_apply_reregistration() != 0) {
        g_device_state.status = DEVICE_STATUS_DISCONNECTED;
        device_session_set_revoked(1);
    }

    g_registration_wait_running = 0;
    return NULL;
}

void device_start_registration_wait(void)
{
    if (g_registration_wait_running) {
        return;
    }

    g_registration_wait_running = 1;
    device_session_set_revoked(1);
    switcher_servers_drop_active_connections();

    pthread_t thread;
    if (pthread_create(&thread, NULL, registration_wait_thread, NULL) != 0) {
        logMsg(LOG_ERR, "Failed to start registration wait thread\n");
        g_registration_wait_running = 0;
        return;
    }

    pthread_detach(thread);
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

    g_heartbeat_config.enable_ssl = g_device_control_ssl_enabled;
    g_heartbeat_config.ssl_ctx = g_device_control_ssl_ctx;
    
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
    char *device_id = NULL;
    char *auth_token = NULL;
    char *registration_server = NULL;
    uint16_t registration_port = 8443;
    bool enable_device_registration = false;
    char registration_ca_file[512] = "";
    bool registration_no_ssl = false;

    g_cli_output_host = argv_has_flag(argc, argv, "--host_out");
    g_cli_output_port = argv_has_flag(argc, argv, "-p_out");
    g_tunnel_port_override = 0;
    g_port_host_base = 0;
    g_port_range_start = 6000;
    
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--device-id") == 0 && i + 1 < argc) {
            device_id = argv[++i];
            enable_device_registration = true;
        } else if (strcmp(argv[i], "--device-token") == 0 && i + 1 < argc) {
            auth_token = argv[++i];
        } else if (strcmp(argv[i], "--registration-server") == 0 && i + 1 < argc) {
            registration_server = argv[++i];
        } else if (strcmp(argv[i], "--registration-port") == 0 && i + 1 < argc) {
            registration_port = (uint16_t)atoi(argv[++i]);
        } else if (strcmp(argv[i], "--tunnel-port") == 0 && i + 1 < argc) {
            g_tunnel_port_override = (uint16_t)atoi(argv[++i]);
        } else if (strcmp(argv[i], "--port-host-base") == 0 && i + 1 < argc) {
            g_port_host_base = (uint16_t)atoi(argv[++i]);
        } else if (strcmp(argv[i], "--port-range-start") == 0 && i + 1 < argc) {
            g_port_range_start = (uint16_t)atoi(argv[++i]);
        } else if (strcmp(argv[i], "--registration-ca-file") == 0 && i + 1 < argc) {
            strncpy(registration_ca_file, argv[++i], sizeof(registration_ca_file) - 1);
            registration_ca_file[sizeof(registration_ca_file) - 1] = '\0';
        } else if ((strcmp(argv[i], "--ca-file") == 0 || strcmp(argv[i], "-a") == 0) && i + 1 < argc) {
            if (registration_ca_file[0] == '\0') {
                strncpy(registration_ca_file, argv[++i], sizeof(registration_ca_file) - 1);
                registration_ca_file[sizeof(registration_ca_file) - 1] = '\0';
            } else {
                i++;
            }
        } else if (strcmp(argv[i], "--registration-no-ssl") == 0) {
            registration_no_ssl = true;
        } else if (strcmp(argv[i], "-p_in") == 0 && i + 1 < argc) {
            g_tunnel_port_override = (uint16_t)atoi(argv[++i]);
        }
    }
    
    if (enable_device_registration && device_id && auth_token && registration_server) {
        device_registration_set_control_tls(
            registration_ca_file[0] ? registration_ca_file : NULL,
            !registration_no_ssl);

        if (device_registration_init(device_id, auth_token, registration_server, registration_port) != 0) {
            logMsg(LOG_ERR, "Failed to initialize device registration\n");
            return -1;
        }
        
        if (device_register_until_allowed() != 0) {
            logMsg(LOG_ERR, "Device registration stopped\n");
            return -1;
        }

        proxy_server_thread_data_t *settings = get_client_settings();
        apply_tunnel_settings(settings);
        apply_output_target_from_registration(settings);
        if (validate_output_target(settings) != 0) {
            return -1;
        }
        
        if (start_device_heartbeat() != 0) {
            logMsg(LOG_WARNING, "Failed to start heartbeat, continuing without it\n");
        }

        return switcher_servers_start();
    }
    
    logMsg(LOG_ERR, "Device registration mode requires --device-id, --device-token, --registration-server\n");
    return -1;
}

/**
 * Cleanup device registration
 */
void device_registration_cleanup(void)
{
    if (g_device_registration_enabled) {
        heartbeat_manager_stop();
        g_device_registration_enabled = false;
        g_device_state.status = DEVICE_STATUS_DISCONNECTED;

        if (g_device_control_ssl_ctx) {
            SSL_CTX_free(g_device_control_ssl_ctx);
            g_device_control_ssl_ctx = NULL;
        }
        
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
    g_device_state.status = DEVICE_STATUS_RECONNECTING;
    device_start_registration_wait();
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