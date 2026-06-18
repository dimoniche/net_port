export const isLegacyPlaceholderServer = (server) => {
    if (!server) {
        return true;
    }

    if (Number(server.input_port) === 5998 && Number(server.output_port) === 5999) {
        return true;
    }

    const description = String(server.description || "").toLowerCase();
    return description.includes("legacy placeholder");
};

export const getEnabledLegacyServers = (servers = []) =>
    (servers || []).filter(
        (server) => server.enable === true && !isLegacyPlaceholderServer(server)
    );

export const hasEnabledLegacyServers = (servers = []) =>
    getEnabledLegacyServers(servers).length > 0;
