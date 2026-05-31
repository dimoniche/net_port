-- Deduplicate users by login (keep the oldest row) and enforce unique logins.

DO $$
DECLARE
  dup RECORD;
  keep_id INTEGER;
BEGIN
  FOR dup IN
    SELECT login, MIN(id) AS keep_id
    FROM users
    GROUP BY login
    HAVING COUNT(*) > 1
  LOOP
    keep_id := dup.keep_id;

    UPDATE devices
    SET user_id = keep_id
    WHERE user_id IN (
      SELECT id FROM users WHERE login = dup.login AND id <> keep_id
    );

    UPDATE servers
    SET user_id = keep_id
    WHERE user_id IN (
      SELECT id FROM users WHERE login = dup.login AND id <> keep_id
    );

    DELETE FROM users
    WHERE login = dup.login
      AND id <> keep_id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_login_unique ON users (login);
