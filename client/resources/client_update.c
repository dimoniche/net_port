#include "client_update.h"

#include "settings.h"

#include <jansson.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <limits.h>
#include <sys/stat.h>

#if defined(__aarch64__)
#define CLIENT_ARCH_DEFAULT "aarch64"
#elif defined(__arm__) || defined(__ARM_ARCH)
#define CLIENT_ARCH_DEFAULT "armhf"
#else
#define CLIENT_ARCH_DEFAULT "amd64"
#endif

static int run_command_capture(const char *cmd, char *output, size_t output_size)
{
    FILE *fp = popen(cmd, "r");
    if (!fp) {
        return -1;
    }

    size_t total = 0;
    output[0] = '\0';

    while (total + 1 < output_size) {
        size_t read_bytes = fread(output + total, 1, output_size - total - 1, fp);
        if (read_bytes == 0) {
            break;
        }
        total += read_bytes;
    }

    output[total] = '\0';
    int status = pclose(fp);
    if (status != 0) {
        return -1;
    }

    return 0;
}

static char *find_arg_value(int argc, char **argv, const char *flag)
{
    for (int i = 1; i < argc - 1; i++) {
        if (strcmp(argv[i], flag) == 0) {
            return argv[i + 1];
        }
    }
    return NULL;
}

static int has_flag(int argc, char **argv, const char *flag)
{
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], flag) == 0) {
            return 1;
        }
    }
    return 0;
}

static void build_api_base(char *base, size_t base_size, int argc, char **argv)
{
    const char *update_server = find_arg_value(argc, argv, "--update-server");
    const char *registration_server = find_arg_value(argc, argv, "--registration-server");

    if (update_server && update_server[0]) {
        snprintf(base, base_size, "%s", update_server);
        return;
    }

    if (registration_server && registration_server[0]) {
        snprintf(base, base_size, "http://%s", registration_server);
        return;
    }

    base[0] = '\0';
}

static void trim_trailing_slash(char *value)
{
    size_t len = strlen(value);
    while (len > 0 && value[len - 1] == '/') {
        value[len - 1] = '\0';
        len--;
    }
}

static const char *resolve_arch(int argc, char **argv)
{
    const char *arch = find_arg_value(argc, argv, "--update-arch");
    return (arch && arch[0]) ? arch : CLIENT_ARCH_DEFAULT;
}

static int fetch_json(const char *url, char *buffer, size_t buffer_size)
{
    char cmd[2048];
    snprintf(cmd, sizeof(cmd), "curl -sf --max-time 30 '%s'", url);
    return run_command_capture(cmd, buffer, buffer_size);
}

static int download_file(const char *url, const char *target_path)
{
    char cmd[4096];
    snprintf(cmd, sizeof(cmd), "curl -sf --max-time 120 '%s' -o '%s'", url, target_path);
    return system(cmd) == 0 ? 0 : -1;
}

static int verify_sha256(const char *file_path, const char *expected_sha256)
{
    char cmd[PATH_MAX + 64];
    char output[128];

    if (!expected_sha256 || !expected_sha256[0]) {
        return 0;
    }

    snprintf(cmd, sizeof(cmd), "sha256sum '%s'", file_path);
    if (run_command_capture(cmd, output, sizeof(output)) != 0) {
        return -1;
    }

    if (strncmp(output, expected_sha256, 64) != 0) {
        return -1;
    }

    return 0;
}

static int install_symlink(const char *install_dir, const char *filename)
{
    char symlink_cmd[PATH_MAX + 256];
    snprintf(
        symlink_cmd,
        sizeof(symlink_cmd),
        "ln -sf '%s' '%s/module_net_port_client'",
        filename,
        install_dir
    );
    return system(symlink_cmd) == 0 ? 0 : -1;
}

int client_check_and_update(int argc, char **argv, bool auto_apply)
{
    char api_base[512];
    char response[8192];
    char url[1024];
    const char *arch;
    json_error_t error;
    json_t *root = NULL;
    int result = -1;

    if (!has_flag(argc, argv, "--check-update") && !auto_apply) {
        return 0;
    }

    build_api_base(api_base, sizeof(api_base), argc, argv);
    if (!api_base[0]) {
        fprintf(stderr, "client update: specify --update-server or --registration-server\n");
        return -1;
    }

    trim_trailing_slash(api_base);
    arch = resolve_arch(argc, argv);

    snprintf(
        url,
        sizeof(url),
        "%s/api/v1/clients/latest/check?platform=linux&arch=%s&current=%s",
        api_base,
        arch,
        VERSION
    );

    if (fetch_json(url, response, sizeof(response)) != 0) {
        fprintf(stderr, "client update: failed to query %s\n", url);
        return -1;
    }

    root = json_loads(response, 0, &error);
    if (!root) {
        fprintf(stderr, "client update: invalid JSON: %s\n", error.text);
        return -1;
    }

    json_t *update_available = json_object_get(root, "update_available");
    if (!json_is_true(update_available)) {
        printf("Client is up to date (%s).\n", VERSION);
        result = 0;
        goto cleanup;
    }

    json_t *latest = json_object_get(root, "latest");
    if (!latest) {
        fprintf(stderr, "client update: missing latest block\n");
        goto cleanup;
    }

    const char *latest_version = json_string_value(json_object_get(latest, "version"));
    const char *filename = json_string_value(json_object_get(latest, "filename"));
    const char *download_path = json_string_value(json_object_get(latest, "download_path"));
    const char *sha256 = json_string_value(json_object_get(latest, "sha256"));

    printf(
        "Client update available: %s -> %s (%s)\n",
        VERSION,
        latest_version ? latest_version : "?",
        filename ? filename : "?"
    );

    if (!auto_apply) {
        result = 2;
        goto cleanup;
    }

    if (!filename || !download_path) {
        fprintf(stderr, "client update: incomplete release metadata\n");
        goto cleanup;
    }

    char install_dir[PATH_MAX];
    if (find_arg_value(argc, argv, "--install-dir")) {
        snprintf(install_dir, sizeof(install_dir), "%s", find_arg_value(argc, argv, "--install-dir"));
    } else {
        char resolved[PATH_MAX];
        if (realpath(argv[0], resolved) != NULL) {
            char *slash = strrchr(resolved, '/');
            if (slash) {
                *slash = '\0';
                snprintf(install_dir, sizeof(install_dir), "%s", resolved);
            } else {
                snprintf(install_dir, sizeof(install_dir), ".");
            }
        } else {
            snprintf(install_dir, sizeof(install_dir), ".");
        }
    }

    char target_path[PATH_MAX];
    char temp_path[PATH_MAX + 16];
    snprintf(target_path, sizeof(target_path), "%s/%s", install_dir, filename);
    snprintf(temp_path, sizeof(temp_path), "%s.download", target_path);

    char download_url[1024];
    snprintf(download_url, sizeof(download_url), "%s%s", api_base, download_path);

    if (download_file(download_url, temp_path) != 0) {
        fprintf(stderr, "client update: download failed\n");
        goto cleanup;
    }

    if (verify_sha256(temp_path, sha256) != 0) {
        unlink(temp_path);
        fprintf(stderr, "client update: sha256 verification failed\n");
        goto cleanup;
    }

    chmod(temp_path, 0755);
    if (rename(temp_path, target_path) != 0) {
        unlink(temp_path);
        fprintf(stderr, "client update: failed to install %s\n", target_path);
        goto cleanup;
    }

    if (install_symlink(install_dir, filename) != 0) {
        fprintf(stderr, "client update: failed to update symlink\n");
        goto cleanup;
    }

    printf("Installed %s. Restarting via module_net_port_client symlink...\n", target_path);

    char launcher[PATH_MAX];
    snprintf(launcher, sizeof(launcher), "%s/module_net_port_client", install_dir);
    execv(launcher, argv);

    fprintf(stderr, "client update: exec %s failed\n", launcher);
    result = 1;

cleanup:
    if (root) {
        json_decref(root);
    }
    return result;
}
