//
// Modified proxy_client.c with device registration integration - Header
//

#ifndef NET_PORT_PROXY_CLIENT_DEVICE_INTEGRATION_H
#define NET_PORT_PROXY_CLIENT_DEVICE_INTEGRATION_H

#include <stdint.h>
#include <stdbool.h>
#include "device_heartbeat.h"

/**
 * @brief Initialize device registration
 * 
 * @param device_id Device identifier
 * @param auth_token Authentication token
 * @param server_host Registration server hostname/IP
 * @param server_port Registration server port (default: 8443)
 * @return int 0 on success, -1 on error
 */
int device_registration_init(const char *device_id, const char *auth_token,
                             const char *server_host, uint16_t server_port);

/**
 * @brief Register device with server
 * 
 * @return int 0 on success, -1 on error
 */
int device_register_with_server(void);

/**
 * @brief Start device heartbeat
 * 
 * @return int 0 on success, -1 on error
 */
int start_device_heartbeat(void);

/**
 * @brief Main function with device registration
 * 
 * @param argc Argument count
 * @param argv Argument vector
 * @return int Exit code
 */
int main_with_device_registration(int argc, char** argv);

/**
 * @brief Cleanup device registration
 */
void device_registration_cleanup(void);

/**
 * @brief Get device registration status
 * 
 * @return device_registration_state_t* Pointer to device registration state
 */
device_registration_state_t* get_device_registration_state(void);

/**
 * @brief Reconnect device (called from heartbeat manager)
 * 
 * @return int 0 on success, -1 on error
 */
int reconnect_device(void);

#endif // NET_PORT_PROXY_CLIENT_DEVICE_INTEGRATION_H