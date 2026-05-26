'use strict';

const { Client } = require('pg');
const logger = require('./logger');
const { broadcastDeviceById, emitDeviceRemoved } = require('./services/devices/device-events');
const {
  broadcastServerStatisticsRow,
  broadcastDeviceStatisticsRow
} = require('./services/statistics/statistics-events');

const DEVICE_STATUS_CHANNEL = 'device_status';
const STATISTICS_CHANNEL = 'statistics_updates';

const DEVICE_TRIGGER_SQL = `
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
    PERFORM pg_notify('${DEVICE_STATUS_CHANNEL}', payload);
    RETURN OLD;
  ELSE
    dev_id := COALESCE(NEW.id, OLD.id);
  END IF;

  IF dev_id IS NOT NULL THEN
    PERFORM pg_notify('${DEVICE_STATUS_CHANNEL}', dev_id::text);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS devices_status_notify ON devices;
  CREATE TRIGGER devices_status_notify
  AFTER INSERT OR UPDATE OF status, assigned_port, preferred_port, last_heartbeat OR DELETE
  ON devices
  FOR EACH ROW EXECUTE PROCEDURE notify_device_status_change();

DROP TRIGGER IF EXISTS device_sessions_status_notify ON device_sessions;
CREATE TRIGGER device_sessions_status_notify
  AFTER INSERT OR UPDATE OF status, assigned_port, last_activity, active_connections, bytes_sent, bytes_received OR DELETE
  ON device_sessions
  FOR EACH ROW EXECUTE PROCEDURE notify_device_status_change();
`;

const STATISTICS_TRIGGER_SQL = `
CREATE OR REPLACE FUNCTION notify_statistics_change() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'statistic' THEN
    PERFORM pg_notify('${STATISTICS_CHANNEL}', 'server:' || NEW.server_id::text);
  ELSIF TG_TABLE_NAME = 'device_traffic_samples' THEN
    PERFORM pg_notify('${STATISTICS_CHANNEL}', 'device:' || NEW.device_id::text);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS statistic_updates_notify ON statistic;
CREATE TRIGGER statistic_updates_notify
  AFTER INSERT OR UPDATE OF bytes_received, bytes_sent, connections_count, timestamp
  ON statistic
  FOR EACH ROW EXECUTE PROCEDURE notify_statistics_change();

DROP TRIGGER IF EXISTS device_traffic_samples_notify ON device_traffic_samples;
CREATE TRIGGER device_traffic_samples_notify
  AFTER INSERT OR UPDATE OF bytes_sent_delta, bytes_received_delta, active_connections
  ON device_traffic_samples
  FOR EACH ROW EXECUTE PROCEDURE notify_statistics_change();
`;

async function ensureNotifyTriggers(knex) {
  try {
    await knex.raw(DEVICE_TRIGGER_SQL);
    await knex.raw(STATISTICS_TRIGGER_SQL);
    logger.info('Realtime NOTIFY triggers are ready');
  } catch (error) {
    logger.error('Failed to create realtime NOTIFY triggers: %s', error.message);
  }
}

function startDeviceStatusWatcher(app) {
  const knex = app.get('db');
  if (!knex) {
    return;
  }

  ensureNotifyTriggers(knex);

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'net_port'
  });

  let reconnectTimer = null;
  const pendingDevicePayloads = new Set();
  const pendingStatistics = new Set();
  let deviceFlushTimer = null;
  let statisticsFlushTimer = null;

  const handleDeviceNotifyPayload = async (payload) => {
    if (!payload) {
      return;
    }

    if (payload.startsWith('{')) {
      try {
        const data = JSON.parse(payload);
        if (data.action === 'deleted' && data.id) {
          emitDeviceRemoved(app, data);
          return;
        }
      } catch (error) {
        logger.error('Failed to parse device notify payload: %s', error.message);
      }
    }

    await broadcastDeviceById(app, payload);
  };

  const flushDevices = async () => {
    deviceFlushTimer = null;
    const payloads = Array.from(pendingDevicePayloads);
    pendingDevicePayloads.clear();

    for (const payload of payloads) {
      try {
        await handleDeviceNotifyPayload(payload);
        if (!payload.startsWith('{')) {
          await broadcastDeviceStatisticsRow(app, payload);
        }
      } catch (error) {
        logger.error('Failed to broadcast device update %s: %s', payload, error.message);
      }
    }
  };

  const flushStatistics = async () => {
    statisticsFlushTimer = null;
    const items = Array.from(pendingStatistics);
    pendingStatistics.clear();

    for (const item of items) {
      try {
        if (item.startsWith('server:')) {
          await broadcastServerStatisticsRow(app, item.slice('server:'.length));
        } else if (item.startsWith('device:')) {
          await broadcastDeviceStatisticsRow(app, item.slice('device:'.length));
        }
      } catch (error) {
        logger.error('Failed to broadcast statistics update %s: %s', item, error.message);
      }
    }
  };

  const scheduleDeviceBroadcast = (payload) => {
    pendingDevicePayloads.add(String(payload));
    if (!deviceFlushTimer) {
      deviceFlushTimer = setTimeout(flushDevices, 150);
    }
  };

  const scheduleStatisticsBroadcast = (payload) => {
    pendingStatistics.add(String(payload));
    if (!statisticsFlushTimer) {
      statisticsFlushTimer = setTimeout(flushStatistics, 150);
    }
  };

  const connectListener = async () => {
    try {
      await client.connect();
      await client.query(`LISTEN ${DEVICE_STATUS_CHANNEL}`);
      await client.query(`LISTEN ${STATISTICS_CHANNEL}`);
      logger.info(
        'Listening for realtime changes on channels %s, %s',
        DEVICE_STATUS_CHANNEL,
        STATISTICS_CHANNEL
      );

      client.on('notification', (message) => {
        if (message.channel === DEVICE_STATUS_CHANNEL && message.payload) {
          scheduleDeviceBroadcast(message.payload);
          return;
        }

        if (message.channel === STATISTICS_CHANNEL && message.payload) {
          scheduleStatisticsBroadcast(message.payload);
        }
      });

      client.on('error', (error) => {
        logger.error('Realtime listener error: %s', error.message);
      });

      client.on('end', () => {
        logger.warn('Realtime listener disconnected, reconnecting in 3s');
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            startDeviceStatusWatcher(app);
          }, 3000);
        }
      });
    } catch (error) {
      logger.error('Failed to start realtime watcher: %s', error.message);
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          startDeviceStatusWatcher(app);
        }, 5000);
      }
    }
  };

  connectListener();
}

module.exports = startDeviceStatusWatcher;
