-- Persistent cumulative traffic totals (survive restarts and history cleanup).

ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS total_bytes_received BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_bytes_sent BIGINT NOT NULL DEFAULT 0;

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS total_bytes_received BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_bytes_sent BIGINT NOT NULL DEFAULT 0;

UPDATE servers s
SET
  total_bytes_received = GREATEST(
    COALESCE(s.total_bytes_received, 0),
    COALESCE((SELECT MAX(st.bytes_received) FROM statistic st WHERE st.server_id = s.id), 0)
  ),
  total_bytes_sent = GREATEST(
    COALESCE(s.total_bytes_sent, 0),
    COALESCE((SELECT MAX(st.bytes_sent) FROM statistic st WHERE st.server_id = s.id), 0)
  );

UPDATE devices d
SET
  total_bytes_received = GREATEST(
    COALESCE(d.total_bytes_received, 0),
    COALESCE((SELECT SUM(ds.bytes_received) FROM device_sessions ds WHERE ds.device_id = d.id), 0)
  ),
  total_bytes_sent = GREATEST(
    COALESCE(d.total_bytes_sent, 0),
    COALESCE((SELECT SUM(ds.bytes_sent) FROM device_sessions ds WHERE ds.device_id = d.id), 0)
  );
