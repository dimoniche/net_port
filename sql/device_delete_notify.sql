-- Notify clients when a device row is deleted (WebSocket device:removed).
CREATE OR REPLACE FUNCTION notify_device_status_change() RETURNS trigger AS $$
DECLARE
  dev_id UUID;
  payload TEXT;
BEGIN
  IF TG_TABLE_NAME = 'device_sessions' THEN
    dev_id := COALESCE(NEW.device_id, OLD.device_id);
  ELSIF TG_OP = 'DELETE' THEN
    payload := json_build_object(
      'action', 'deleted',
      'id', OLD.id,
      'device_id', OLD.device_id,
      'user_id', OLD.user_id
    )::text;
    PERFORM pg_notify('device_status', payload);
    RETURN OLD;
  ELSE
    dev_id := COALESCE(NEW.id, OLD.id);
  END IF;

  IF dev_id IS NOT NULL THEN
    PERFORM pg_notify('device_status', dev_id::text);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
