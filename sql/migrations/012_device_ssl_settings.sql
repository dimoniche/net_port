-- Per-device TLS flags for dynamic tunnel ports (replaces NET_PORT_DYNAMIC_* env vars)

ALTER TABLE devices
    ADD COLUMN IF NOT EXISTS enable_input_ssl BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE devices
    ADD COLUMN IF NOT EXISTS enable_tunnel_ssl BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN devices.enable_input_ssl IS 'TLS on external (assigned) port for clients connecting via published port';
COMMENT ON COLUMN devices.enable_tunnel_ssl IS 'TLS on tunnel port between Net Port device client and server';
