-- Remove duplicate empty statistic snapshots created by idle server processes.
-- Keeps rows with traffic when another row for the same server exists within 5 seconds.

DELETE FROM statistic AS empty_row
WHERE empty_row.bytes_received = 0
  AND empty_row.bytes_sent = 0
  AND empty_row.connections_count = 0
  AND EXISTS (
    SELECT 1
    FROM statistic AS data_row
    WHERE data_row.server_id = empty_row.server_id
      AND data_row.id <> empty_row.id
      AND data_row.timestamp BETWEEN empty_row.timestamp - interval '5 seconds'
                                 AND empty_row.timestamp + interval '5 seconds'
      AND (
        data_row.bytes_received > 0
        OR data_row.bytes_sent > 0
        OR data_row.connections_count > 0
      )
  );
