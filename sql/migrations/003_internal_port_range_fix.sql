-- Allow internal_port to be a local service port (e.g. 22), not device tunnel range

ALTER TABLE devices DROP CONSTRAINT IF EXISTS valid_internal_port;
ALTER TABLE devices
  ADD CONSTRAINT valid_internal_port
  CHECK (internal_port IS NULL OR (internal_port >= 1 AND internal_port <= 65535));
