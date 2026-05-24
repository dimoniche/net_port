-- Runtime migration: fix port pair release (safe to re-apply)
CREATE OR REPLACE FUNCTION free_device_port(p_port INTEGER)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE port_allocations
    SET device_id = NULL,
        session_id = NULL,
        allocated_at = NULL,
        expires_at = NULL,
        status = 'free'
    WHERE port = p_port
      AND status IN ('allocated', 'reserved');

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION free_device_port_pair(p_input_port INTEGER)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    IF p_input_port IS NULL THEN
        RETURN 0;
    END IF;

    IF free_device_port(p_input_port) THEN
        v_count := v_count + 1;
    END IF;

    IF free_device_port(p_input_port + 1) THEN
        v_count := v_count + 1;
    END IF;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_device_sessions(p_device_id VARCHAR)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
    r RECORD;
BEGIN
    FOR r IN
        UPDATE device_sessions ds
        SET status = 'expired',
            expires_at = NOW()
        FROM devices d
        WHERE ds.device_id = d.id
          AND d.device_id = p_device_id
          AND ds.status IN ('active', 'connecting')
        RETURNING ds.assigned_port
    LOOP
        IF r.assigned_port IS NOT NULL THEN
            v_count := v_count + free_device_port_pair(r.assigned_port);
        END IF;
    END LOOP;

    UPDATE devices d
    SET assigned_port = NULL,
        status = CASE WHEN d.status = 'active' THEN 'inactive' ELSE d.status END,
        updated_at = NOW()
    WHERE d.device_id = p_device_id
      AND NOT EXISTS (
          SELECT 1
          FROM device_sessions ds
          WHERE ds.device_id = d.id
            AND ds.status = 'active'
            AND ds.expires_at >= NOW()
      );

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
    r RECORD;
BEGIN
    FOR r IN
        SELECT id, assigned_port
        FROM device_sessions
        WHERE expires_at < CURRENT_TIMESTAMP
          AND status IN ('active', 'connecting')
    LOOP
        IF r.assigned_port IS NOT NULL THEN
            v_count := v_count + free_device_port_pair(r.assigned_port);
        END IF;
    END LOOP;

    UPDATE device_sessions
    SET status = 'expired'
    WHERE expires_at < CURRENT_TIMESTAMP
      AND status IN ('active', 'connecting');

    UPDATE port_allocations pa
    SET device_id = NULL,
        session_id = NULL,
        allocated_at = NULL,
        expires_at = NULL,
        status = 'free'
    WHERE pa.status = 'allocated'
      AND NOT EXISTS (
          SELECT 1
          FROM device_sessions ds
          WHERE ds.status IN ('active', 'connecting')
            AND ds.expires_at >= CURRENT_TIMESTAMP
            AND (pa.port = ds.assigned_port OR pa.port = ds.assigned_port + 1)
      );

    UPDATE devices d
    SET status = 'inactive',
        assigned_port = NULL,
        updated_at = NOW()
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

-- One-time reconciliation for already leaked ports
SELECT cleanup_expired_sessions();

UPDATE device_sessions
SET status = 'expired', expires_at = NOW()
WHERE status IN ('active', 'connecting', 'terminated')
  AND expires_at < NOW() - INTERVAL '5 minutes';

SELECT cleanup_expired_sessions();
