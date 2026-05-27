'use strict';

const { Statistics } = require('./statistics.class');

function emitRealtimeEvent(app, event, payload, channels) {
  if (!payload || typeof app.channel !== 'function') {
    return;
  }

  const channel = app.channel(...channels);
  const hook = {
    app,
    path: '',
    dispatch: payload,
    result: payload
  };

  app.emit('publish', event, channel, hook, payload);
}

function emitServerStatisticsUpdate(app, stat) {
  const channels = ['admin'];
  if (stat.user_id != null) {
    channels.push(`user:${stat.user_id}`);
  }
  emitRealtimeEvent(app, 'statistics:server-updated', stat, channels);
}

function emitDeviceStatisticsUpdate(app, deviceRow) {
  const channels = ['admin'];
  if (deviceRow.user_id != null) {
    channels.push(`user:${deviceRow.user_id}`);
  }
  emitRealtimeEvent(app, 'statistics:device-updated', deviceRow, channels);
}

async function fetchServerStatisticsRow(knex, serverId) {
  const statistics = new Statistics(knex);
  return statistics.buildServerStatisticsRow(serverId);
}

async function broadcastServerStatisticsRow(app, serverId) {
  const knex = app.get('db');
  const row = await fetchServerStatisticsRow(knex, serverId);

  if (row) {
    emitServerStatisticsUpdate(app, row);
  }

  return row;
}

async function broadcastAllServerStatistics(app) {
  const knex = app.get('db');
  const statistics = new Statistics(knex);
  const rows = await statistics.find({});

  rows.forEach((row) => emitServerStatisticsUpdate(app, row));
  return rows;
}

async function broadcastDeviceStatisticsRow(app, deviceId) {
  const prefix = app.get('prefix') || '';
  const service = app.service(`${prefix}/devices`);
  const row = await service.getDeviceStatisticsSummaryRow(deviceId);

  if (row) {
    emitDeviceStatisticsUpdate(app, row);
  }

  return row;
}

module.exports = {
  emitServerStatisticsUpdate,
  emitDeviceStatisticsUpdate,
  fetchServerStatisticsRow,
  broadcastServerStatisticsRow,
  broadcastAllServerStatistics,
  broadcastDeviceStatisticsRow
};
