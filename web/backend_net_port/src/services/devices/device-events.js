'use strict';

function enrichDeviceWithOnline(device) {
  const deviceObj = { ...device };

  if (device.last_heartbeat) {
    const lastHeartbeat = new Date(device.last_heartbeat);
    const now = new Date();
    const diffMinutes = (now - lastHeartbeat) / (1000 * 60);
    deviceObj.online = diffMinutes < 2;
  } else {
    deviceObj.online = false;
  }

  const hasLiveSession = Boolean(
    device.session_port != null
    || device.last_activity
    || (device.active_connections != null && device.active_connections >= 0)
  );

  if (
    deviceObj.status === 'connecting'
    && deviceObj.online
    && hasLiveSession
  ) {
    deviceObj.status = 'active';
  }

  return deviceObj;
}

async function fetchDeviceBroadcastPayload(knex, deviceId) {
  const latestSessions = knex('device_sessions')
    .select(knex.raw('DISTINCT ON (device_id) device_id, assigned_port, last_activity, active_connections, bytes_sent, bytes_received'))
    .where('status', 'active')
    .where('expires_at', '>', knex.fn.now())
    .orderBy('device_id')
    .orderBy('started_at', 'desc')
    .as('device_sessions');

  const device = await knex('devices')
    .select(
      'devices.*',
      'users.username as owner_username',
      'device_sessions.assigned_port as session_port',
      'device_sessions.last_activity',
      'device_sessions.active_connections',
      'device_sessions.bytes_sent',
      'device_sessions.bytes_received'
    )
    .leftJoin('users', 'devices.user_id', 'users.id')
    .leftJoin(latestSessions, 'devices.id', 'device_sessions.device_id')
    .where('devices.id', deviceId)
    .first();

  if (!device) {
    return null;
  }

  return enrichDeviceWithOnline(device);
}

function emitDeviceUpdate(app, device) {
  if (!device || typeof app.channel !== 'function') {
    return;
  }

  const channels = ['admin'];
  if (device.user_id != null) {
    channels.push(`user:${device.user_id}`);
  }

  const channel = app.channel(...channels);
  const hook = {
    app,
    path: '',
    dispatch: device,
    result: device
  };

  app.emit('publish', 'device:updated', channel, hook, device);
}

function emitDeviceRemoved(app, device) {
  if (!device || typeof app.channel !== 'function') {
    return;
  }

  const payload = { id: device.id, device_id: device.device_id, user_id: device.user_id };
  const channels = ['admin'];
  if (device.user_id != null) {
    channels.push(`user:${device.user_id}`);
  }

  const channel = app.channel(...channels);
  const hook = {
    app,
    path: '',
    dispatch: payload,
    result: payload
  };

  app.emit('publish', 'device:removed', channel, hook, payload);
}

async function broadcastDeviceById(app, deviceId) {
  const knex = app.get('db');
  const device = await fetchDeviceBroadcastPayload(knex, deviceId);

  if (device) {
    emitDeviceUpdate(app, device);
    return device;
  }

  emitDeviceRemoved(app, { id: deviceId });
  return null;
}

module.exports = {
  enrichDeviceWithOnline,
  fetchDeviceBroadcastPayload,
  emitDeviceUpdate,
  emitDeviceRemoved,
  broadcastDeviceById
};
