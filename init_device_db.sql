-- Database schema extensions for device management and dynamic port allocation
-- This extends the existing net_port database schema

\c net_port

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table for IoT devices
CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255),
    description TEXT,
    type VARCHAR(50) DEFAULT 'iot_gateway',
    status VARCHAR(20) DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'pending', 'blocked')),
    auth_token_hash VARCHAR(255) NOT NULL,
    assigned_port INTEGER,
    internal_address VARCHAR(45),
    internal_port INTEGER,
    protocol VARCHAR(10) DEFAULT 'tcp' CHECK (protocol IN ('tcp', 'udp')),
    capabilities JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat TIMESTAMP,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    
    -- Indexes for performance
    CONSTRAINT valid_port_range CHECK (assigned_port IS NULL OR (assigned_port >= 6000 AND assigned_port <= 7000)),
    CONSTRAINT valid_internal_port CHECK (internal_port IS NULL OR (internal_port >= 6000 AND internal_port <= 7000))
);

-- Indexes for devices table
CREATE INDEX idx_devices_status ON devices(status);
CREATE INDEX idx_devices_user_id ON devices(user_id);
CREATE INDEX idx_devices_last_heartbeat ON devices(last_heartbeat);
CREATE INDEX idx_devices_assigned_port ON devices(assigned_port) WHERE assigned_port IS NOT NULL;

-- Table for active device sessions
CREATE TABLE device_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    client_ip VARCHAR(45),
    client_port INTEGER,
    server_ip VARCHAR(45) DEFAULT '0.0.0.0',
    assigned_port INTEGER NOT NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    bytes_sent BIGINT DEFAULT 0,
    bytes_received BIGINT DEFAULT 0,
    active_connections INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'expired', 'terminated', 'error')),
    
    -- Indexes for performance
    CONSTRAINT valid_session_port CHECK (assigned_port >= 6000 AND assigned_port <= 7000)
);

-- Indexes for device_sessions table
CREATE INDEX idx_device_sessions_device_id ON device_sessions(device_id);
CREATE INDEX idx_device_sessions_session_token ON device_sessions(session_token);
CREATE INDEX idx_device_sessions_assigned_port ON device_sessions(assigned_port);
CREATE INDEX idx_device_sessions_expires_at ON device_sessions(expires_at);
CREATE INDEX idx_device_sessions_status ON device_sessions(status);

-- Table for port allocations tracking
CREATE TABLE port_allocations (
    port INTEGER PRIMARY KEY CHECK (port >= 6000 AND port <= 7000),
    device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    session_id UUID REFERENCES device_sessions(id) ON DELETE SET NULL,
    allocated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'allocated' CHECK (status IN ('allocated', 'free', 'reserved', 'blocked')),
    
    -- Ensure port is unique and properly managed
    CONSTRAINT valid_allocation CHECK (
        (status = 'allocated' AND device_id IS NOT NULL AND session_id IS NOT NULL) OR
        (status IN ('free', 'reserved', 'blocked') AND device_id IS NULL AND session_id IS NULL)
    )
);

-- Indexes for port_allocations table
CREATE INDEX idx_port_allocations_device_id ON port_allocations(device_id);
CREATE INDEX idx_port_allocations_status ON port_allocations(status);
CREATE INDEX idx_port_allocations_expires_at ON port_allocations(expires_at);

-- Table for device statistics (hourly aggregates)
CREATE TABLE device_statistics (
    id SERIAL PRIMARY KEY,
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    period_start TIMESTAMP NOT NULL,
    period_end TIMESTAMP NOT NULL,
    bytes_sent BIGINT DEFAULT 0,
    bytes_received BIGINT DEFAULT 0,
    connection_count INTEGER DEFAULT 0,
    uptime_seconds INTEGER DEFAULT 0,
    peak_connections INTEGER DEFAULT 0,
    average_latency_ms DECIMAL(10,2),
    
    -- Ensure proper time periods
    CONSTRAINT valid_period CHECK (period_end > period_start),
    CONSTRAINT unique_device_period UNIQUE (device_id, period_start)
);

-- Indexes for device_statistics table
CREATE INDEX idx_device_statistics_device_id ON device_statistics(device_id);
CREATE INDEX idx_device_statistics_period ON device_statistics(period_start, period_end);

-- Table for device events and audit log
CREATE TABLE device_events (
    id SERIAL PRIMARY KEY,
    device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    event_type VARCHAR(50) NOT NULL,
    event_data JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Index for event querying
    INDEX idx_device_events_device_id_event_type (device_id, event_type)
);

-- Table for device configuration templates
CREATE TABLE device_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL,
    config JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Function to update device updated_at timestamp
CREATE OR REPLACE FUNCTION update_device_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for devices table
CREATE TRIGGER update_device_timestamp
    BEFORE UPDATE ON devices
    FOR EACH ROW
    EXECUTE FUNCTION update_device_updated_at();

-- Function to allocate a free port
CREATE OR REPLACE FUNCTION allocate_device_port(
    p_device_id UUID,
    p_session_id UUID,
    p_requested_port INTEGER DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    v_port INTEGER;
    v_expires_at TIMESTAMP := CURRENT_TIMESTAMP + INTERVAL '1 hour';
BEGIN
    -- Try to use requested port if provided and available
    IF p_requested_port IS NOT NULL THEN
        SELECT port INTO v_port
        FROM port_allocations
        WHERE port = p_requested_port
          AND status = 'free'
          AND (expires_at IS NULL OR expires_at < CURRENT_TIMESTAMP)
        FOR UPDATE SKIP LOCKED;
        
        IF FOUND THEN
            UPDATE port_allocations
            SET device_id = p_device_id,
                session_id = p_session_id,
                allocated_at = CURRENT_TIMESTAMP,
                expires_at = v_expires_at,
                status = 'allocated'
            WHERE port = v_port;
            
            RETURN v_port;
        END IF;
    END IF;
    
    -- Find any free port
    SELECT port INTO v_port
    FROM port_allocations
    WHERE status = 'free'
      AND (expires_at IS NULL OR expires_at < CURRENT_TIMESTAMP)
    ORDER BY port
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
    
    IF FOUND THEN
        UPDATE port_allocations
        SET device_id = p_device_id,
            session_id = p_session_id,
            allocated_at = CURRENT_TIMESTAMP,
            expires_at = v_expires_at,
            status = 'allocated'
        WHERE port = v_port;
        
        RETURN v_port;
    END IF;
    
    -- No free ports available
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to free a port
CREATE OR REPLACE FUNCTION free_device_port(p_port INTEGER)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE port_allocations
    SET device_id = NULL,
        session_id = NULL,
        allocated_at = NULL,
        expires_at = CURRENT_TIMESTAMP + INTERVAL '5 minutes', -- Grace period
        status = 'free'
    WHERE port = p_port
      AND status = 'allocated';
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to cleanup expired sessions and ports
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    -- Free ports from expired sessions
    WITH expired_sessions AS (
        SELECT id, assigned_port
        FROM device_sessions
        WHERE expires_at < CURRENT_TIMESTAMP
          AND status = 'active'
    )
    UPDATE port_allocations pa
    SET device_id = NULL,
        session_id = NULL,
        allocated_at = NULL,
        expires_at = CURRENT_TIMESTAMP,
        status = 'free'
    FROM expired_sessions es
    WHERE pa.port = es.assigned_port
      AND pa.status = 'allocated';
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    
    -- Mark expired sessions as expired
    UPDATE device_sessions
    SET status = 'expired'
    WHERE expires_at < CURRENT_TIMESTAMP
      AND status = 'active';
    
    -- Update device status if no active sessions
    UPDATE devices d
    SET status = 'inactive',
        assigned_port = NULL
    WHERE d.status = 'active'
      AND NOT EXISTS (
          SELECT 1
          FROM device_sessions ds
          WHERE ds.device_id = d.id
            AND ds.status = 'active'
            AND ds.expires_at >= CURRENT_TIMESTAMP
      );
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Function to validate device authentication
CREATE OR REPLACE FUNCTION validate_device_auth(
    p_device_id VARCHAR,
    p_auth_token VARCHAR
)
RETURNS TABLE (
    valid BOOLEAN,
    device_uuid UUID,
    device_name VARCHAR,
    device_type VARCHAR,
    user_id INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        CASE WHEN d.auth_token_hash = crypt(p_auth_token, d.auth_token_hash) THEN TRUE ELSE FALSE END as valid,
        d.id as device_uuid,
        d.name as device_name,
        d.type as device_type,
        d.user_id
    FROM devices d
    WHERE d.device_id = p_device_id
      AND d.status IN ('active', 'pending');
END;
$$ LANGUAGE plpgsql;

-- Initialize port allocations table with free ports (6000-7000)
INSERT INTO port_allocations (port, status)
SELECT generate_series(6000, 7000) as port, 'free'
ON CONFLICT (port) DO NOTHING;

-- Create a view for active device sessions with details
CREATE VIEW active_device_sessions AS
SELECT 
    ds.id as session_id,
    ds.session_token,
    ds.assigned_port,
    ds.client_ip,
    ds.started_at,
    ds.last_activity,
    ds.bytes_sent,
    ds.bytes_received,
    ds.active_connections,
    d.id as device_id,
    d.device_id as device_identifier,
    d.name as device_name,
    d.type as device_type,
    d.internal_address,
    d.internal_port,
    d.protocol,
    u.username as owner_username
FROM device_sessions ds
JOIN devices d ON ds.device_id = d.id
LEFT JOIN users u ON d.user_id = u.id
WHERE ds.status = 'active'
  AND ds.expires_at >= CURRENT_TIMESTAMP;

-- Create a view for device status dashboard
CREATE VIEW device_status_dashboard AS
SELECT 
    d.id,
    d.device_id,
    d.name,
    d.type,
    d.status as device_status,
    d.assigned_port,
    d.last_heartbeat,
    ds.status as session_status,
    ds.assigned_port as session_port,
    ds.last_activity,
    ds.bytes_sent,
    ds.bytes_received,
    ds.active_connections,
    CASE 
        WHEN d.last_heartbeat IS NULL THEN 'never'
        WHEN d.last_heartbeat > CURRENT_TIMESTAMP - INTERVAL '5 minutes' THEN 'online'
        WHEN d.last_heartbeat > CURRENT_TIMESTAMP - INTERVAL '1 hour' THEN 'recent'
        ELSE 'offline'
    END as connectivity_status,
    EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - d.last_heartbeat)) as seconds_since_heartbeat
FROM devices d
LEFT JOIN device_sessions ds ON d.id = ds.device_id 
    AND ds.status = 'active' 
    AND ds.expires_at >= CURRENT_TIMESTAMP;

-- Insert a sample device for testing (optional)
-- INSERT INTO devices (device_id, name, auth_token_hash, status, type) 
-- VALUES (
--     'test-device-001',
--     'Test IoT Gateway',
--     crypt('test-token-123', gen_salt('bf')),
--     'active',
--     'iot_gateway'
-- );

-- Grant permissions (adjust based on your security requirements)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO net_port_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO net_port_user;

COMMENT ON TABLE devices IS 'IoT devices that can connect to the net_port system';
COMMENT ON TABLE device_sessions IS 'Active sessions for connected devices';
COMMENT ON TABLE port_allocations IS 'Management of port allocations for devices';
COMMENT ON TABLE device_statistics IS 'Aggregated statistics for devices';
COMMENT ON TABLE device_events IS 'Audit log for device-related events';
COMMENT ON TABLE device_templates IS 'Configuration templates for different device types';