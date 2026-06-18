-- Grant application role access to all public objects.
-- Intended to run as PostgreSQL superuser after migrations create new tables.

DO $$
DECLARE
  app_role name := NULLIF(current_setting('net_port.app_role', true), '');
BEGIN
  IF app_role IS NULL THEN
    app_role := 'admin';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE NOTICE 'Role % does not exist, skipping grants', app_role;
    RETURN;
  END IF;

  EXECUTE format('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO %I', app_role);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', app_role);
  EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO %I', app_role);
END $$;
