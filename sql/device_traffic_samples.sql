-- Fine-grained device traffic samples (one row per heartbeat)

CREATE TABLE IF NOT EXISTS device_traffic_samples (
    id SERIAL PRIMARY KEY,
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    session_id UUID REFERENCES device_sessions(id) ON DELETE CASCADE,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    bytes_sent_delta BIGINT DEFAULT 0,
    bytes_received_delta BIGINT DEFAULT 0,
    active_connections INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_device_traffic_samples_device_time
    ON device_traffic_samples(device_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_device_traffic_samples_session_time
    ON device_traffic_samples(session_id, recorded_at DESC);
