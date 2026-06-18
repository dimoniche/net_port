-- Fixed input port assignment for devices (even port in 6000-6998, tunnel = input + 1)

ALTER TABLE devices
    ADD COLUMN IF NOT EXISTS preferred_port INTEGER;

ALTER TABLE devices
    DROP CONSTRAINT IF EXISTS valid_preferred_port;

ALTER TABLE devices
    ADD CONSTRAINT valid_preferred_port CHECK (
        preferred_port IS NULL
        OR (
            preferred_port >= 6000
            AND preferred_port <= 6998
            AND preferred_port % 2 = 0
        )
    );

ALTER TABLE port_allocations
    DROP CONSTRAINT IF EXISTS valid_allocation;

ALTER TABLE port_allocations
    ADD CONSTRAINT valid_allocation CHECK (
        (status = 'allocated' AND device_id IS NOT NULL AND session_id IS NOT NULL) OR
        (status = 'free' AND device_id IS NULL AND session_id IS NULL) OR
        (status = 'reserved' AND device_id IS NOT NULL AND session_id IS NULL) OR
        (status = 'blocked' AND device_id IS NULL AND session_id IS NULL)
    );

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_preferred_port
    ON devices(preferred_port)
    WHERE preferred_port IS NOT NULL;

CREATE OR REPLACE FUNCTION release_device_port_reservation(
    p_device_id UUID,
    p_input_port INTEGER DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    UPDATE port_allocations
    SET status = 'free',
        device_id = NULL,
        session_id = NULL,
        allocated_at = NULL,
        expires_at = NULL
    WHERE device_id = p_device_id
      AND status = 'reserved'
      AND (
          p_input_port IS NULL
          OR port IN (p_input_port, p_input_port + 1)
      );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reserve_device_port_pair(
    p_device_id UUID,
    p_input_port INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
    v_tunnel_port INTEGER;
    v_updated INTEGER;
BEGIN
    IF p_input_port IS NULL THEN
        PERFORM release_device_port_reservation(p_device_id, NULL);
        RETURN TRUE;
    END IF;

    IF p_input_port < 6000 OR p_input_port > 6998 OR p_input_port % 2 != 0 THEN
        RETURN FALSE;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM devices
        WHERE preferred_port = p_input_port
          AND id <> p_device_id
    ) THEN
        RETURN FALSE;
    END IF;

    v_tunnel_port := p_input_port + 1;

    PERFORM release_device_port_reservation(p_device_id, NULL);

    IF (
        SELECT COUNT(*)
        FROM port_allocations
        WHERE port IN (p_input_port, v_tunnel_port)
          AND status IN ('free', 'reserved')
          AND (device_id IS NULL OR device_id = p_device_id)
    ) < 2 THEN
        RETURN FALSE;
    END IF;

    UPDATE port_allocations
    SET status = 'reserved',
        device_id = p_device_id,
        session_id = NULL,
        allocated_at = NOW(),
        expires_at = NULL
    WHERE port IN (p_input_port, v_tunnel_port)
      AND status IN ('free', 'reserved')
      AND (device_id IS NULL OR device_id = p_device_id);

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated = 2;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION free_device_port_pair(p_input_port INTEGER)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
    v_device_id UUID;
    v_preferred INTEGER;
BEGIN
    IF p_input_port IS NULL THEN
        RETURN 0;
    END IF;

    SELECT d.id, d.preferred_port
    INTO v_device_id, v_preferred
    FROM devices d
    WHERE d.preferred_port = p_input_port
    LIMIT 1;

    IF free_device_port(p_input_port) THEN
        v_count := v_count + 1;
    END IF;

    IF free_device_port(p_input_port + 1) THEN
        v_count := v_count + 1;
    END IF;

    IF v_device_id IS NOT NULL AND v_preferred IS NOT NULL THEN
        PERFORM reserve_device_port_pair(v_device_id, v_preferred);
    END IF;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION release_device_port_reservation(UUID, INTEGER) TO admin;
GRANT EXECUTE ON FUNCTION reserve_device_port_pair(UUID, INTEGER) TO admin;
