-- Do not demote devices waiting for client registration (status = connecting)

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
