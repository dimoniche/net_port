-- Separate static server ports (5000-5999) from dynamic device ports (6000-7000)

UPDATE servers
SET input_port = 5998,
    output_port = 5999,
    enable = false,
    description = COALESCE(NULLIF(description, ''), 'Legacy placeholder (disabled)')
WHERE input_port BETWEEN 6000 AND 7000
   OR output_port BETWEEN 6000 AND 7000;

UPDATE servers
SET enable = false
WHERE input_port BETWEEN 6000 AND 7000
   OR output_port BETWEEN 6000 AND 7000;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'servers_input_port_range'
  ) THEN
    ALTER TABLE servers
      ADD CONSTRAINT servers_input_port_range
      CHECK (input_port IS NULL OR (input_port >= 5000 AND input_port <= 5999));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'servers_output_port_range'
  ) THEN
    ALTER TABLE servers
      ADD CONSTRAINT servers_output_port_range
      CHECK (output_port IS NULL OR (output_port >= 5000 AND output_port <= 5999));
  END IF;
END $$;
