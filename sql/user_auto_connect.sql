-- Per-user auto-connect preference for device reconnection

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS auto_connect_enabled BOOLEAN DEFAULT TRUE;

UPDATE users
SET auto_connect_enabled = TRUE
WHERE auto_connect_enabled IS NULL;
