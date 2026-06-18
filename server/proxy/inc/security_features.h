#ifndef SECURITY_FEATURES_H
#define SECURITY_FEATURES_H

#include <stddef.h>
#include <stdint.h>

typedef struct security_stats_s {
    size_t rate_limit_entries;
    size_t whitelist_entries;
    size_t blacklist_entries;
    size_t active_penalties;
    size_t permanent_blocks;
} security_stats_t;

int security_features_init(void);
void security_features_cleanup(void);

int check_rate_limit(const char *key, const char *source_ip);
int validate_device_token(const char *device_id, const char *auth_token, const char *source_ip);
int validate_session_token_security(const char *session_token, const char *source_ip);
int validate_json_input(const char *json_str, size_t max_length);

void security_configure_rate_limit(
    uint32_t max_requests,
    uint32_t window_seconds,
    uint32_t penalty_seconds
);

void security_reset_rate_limits(void);

void get_security_statistics(security_stats_t *stats);

#endif
