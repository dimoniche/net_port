'use strict';

const logger = require('./logger');
const { broadcastDeviceById } = require('./services/devices/device-events');

const AUTO_CONNECT_INTERVAL_MS = 60000;
const OFFLINE_THRESHOLD_MINUTES = 2;

function hasLiveSessionSubquery(knex) {
  return knex('device_sessions as ds')
    .select(knex.raw('1'))
    .whereRaw('ds.device_id = devices.id')
    .where('ds.status', 'active')
    .where('ds.expires_at', '>', knex.fn.now());
}

async function syncConnectedDeviceStatuses(app) {
  const knex = app.get('db');
  if (!knex) {
    return;
  }

  const promoted = await knex('devices')
    .where('devices.status', 'connecting')
    .whereNotNull('devices.last_heartbeat')
    .where(
      'devices.last_heartbeat',
      '>',
      knex.raw("NOW() - ? * interval '1 minute'", [OFFLINE_THRESHOLD_MINUTES])
    )
    .whereExists(hasLiveSessionSubquery(knex))
    .update({
      status: 'active',
      updated_at: knex.fn.now()
    });

  if (promoted > 0) {
    logger.info('Promoted %d device(s) from connecting to active', promoted);
  }
}

async function runAutoConnectCycle(app) {
  const knex = app.get('db');
  if (!knex) {
    return;
  }

  await syncConnectedDeviceStatuses(app);

  const staleDevices = await knex('devices')
    .join('users', 'devices.user_id', 'users.id')
    .where('users.auto_connect_enabled', true)
    .whereIn('devices.status', ['active', 'connecting'])
    .where(function markOfflineOnly() {
      this.whereNull('devices.last_heartbeat')
        .orWhere(
          'devices.last_heartbeat',
          '<',
          knex.raw("NOW() - ? * interval '1 minute'", [OFFLINE_THRESHOLD_MINUTES])
        );
    })
    .whereNotExists(hasLiveSessionSubquery(knex))
    .select('devices.id', 'devices.device_id');

  for (const device of staleDevices) {
    try {
      const updated = await knex('devices')
        .where('id', device.id)
        .whereIn('status', ['active', 'connecting'])
        .update({
          status: 'connecting',
          updated_at: knex.fn.now()
        });

      if (updated) {
        logger.info(
          'Auto-connect enabled device %s moved to connecting',
          device.device_id
        );
        await broadcastDeviceById(app, device.id);
      }
    } catch (error) {
      logger.error(
        'Failed auto-connect for device %s: %s',
        device.device_id,
        error.message
      );
    }
  }
}

function startDeviceAutoConnect(app) {
  const knex = app.get('db');
  if (!knex) {
    return;
  }

  const tick = async () => {
    try {
      await runAutoConnectCycle(app);
    } catch (error) {
      logger.error('Auto-connect cycle failed: %s', error.message);
    }
  };

  tick();
  return setInterval(tick, AUTO_CONNECT_INTERVAL_MS);
}

module.exports = startDeviceAutoConnect;
