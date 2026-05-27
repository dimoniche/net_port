'use strict';

const {
  resolveStatisticsUserId,
  computeSpeed
} = require('./statistics.helpers');

exports.Statistics = class Statistics {
  constructor(dbInstance) {
    this.db = dbInstance;
  }

  async fetchEnabledServers(params = {}) {
    const userId = resolveStatisticsUserId(params);
    let query = this.db('servers')
      .where('enable', true)
      .whereNot(function excludePlaceholder() {
        this.where('input_port', 5998).where('output_port', 5999);
      })
      .orderBy('id');

    if (userId != null) {
      query = query.where('user_id', userId);
    }

    return query.select('id', 'description', 'input_port', 'output_port');
  }

  async fetchLatestStatisticRow(serverId) {
    return this.db('statistic')
      .where('server_id', Number(serverId))
      .orderBy('timestamp', 'desc')
      .select('*')
      .first();
  }

  async find(params = {}) {
    const servers = await this.fetchEnabledServers(params);
    const result = [];

    for (const server of servers) {
      const row = await this.fetchLatestStatisticRow(server.id);

      if (!row) {
        result.push({
          server_id: server.id,
          bytes_received: 0,
          bytes_sent: 0,
          connections_count: 0,
          timestamp: null,
          avg_receive_speed: null,
          avg_send_speed: null
        });
        continue;
      }

      const prevResult = await this.db('statistic')
        .where('server_id', row.server_id)
        .where('timestamp', '<', row.timestamp)
        .orderBy('timestamp', 'desc')
        .select('bytes_received', 'bytes_sent', 'timestamp')
        .limit(1);

      const prevRow = prevResult.length > 0 ? prevResult[0] : null;
      const speeds = computeSpeed(row, prevRow);

      result.push({
        ...row,
        avg_receive_speed: speeds.avg_receive_speed,
        avg_send_speed: speeds.avg_send_speed
      });
    }

    return result;
  }

  async get(id, param) {
    return this.db
      .from('statistic')
      .where('server_id', Number(id))
      .select('*')
      .orderBy('timestamp', 'desc')
      .limit(1);
  }

  async getLatest(params = {}) {
    return this.find(params);
  }

  async getByServerAndTimeRange(serverId, startTime, endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error('Invalid date format provided');
    }

    const result = await this.db
      .from('statistic')
      .where('server_id', Number(serverId))
      .where('timestamp', '>=', start)
      .where('timestamp', '<=', end)
      .select('*')
      .orderBy('timestamp', 'asc');

    return Array.isArray(result) ? result : (result.rows || []);
  }

  async resetByServer(serverId) {
    await this.db('statistic').where('server_id', Number(serverId)).del();
    return { success: true, message: `Statistics for server ${serverId} have been reset` };
  }
};
