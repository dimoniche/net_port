'use strict';

const {
  resolveStatisticsUserId,
  computeSpeed,
  isEmptyStatisticRow,
  filterEmptyStatisticSnapshots
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
    const meaningful = await this.db('statistic')
      .where('server_id', Number(serverId))
      .where(function hasTraffic() {
        this.where('bytes_received', '>', 0)
          .orWhere('bytes_sent', '>', 0)
          .orWhere('connections_count', '>', 0);
      })
      .orderBy('timestamp', 'desc')
      .first();

    if (meaningful) {
      return meaningful;
    }

    return this.db('statistic')
      .where('server_id', Number(serverId))
      .orderBy('timestamp', 'desc')
      .first();
  }

  async fetchPreviousStatisticRow(serverId, beforeTimestamp) {
    const meaningful = await this.db('statistic')
      .where('server_id', Number(serverId))
      .where('timestamp', '<', beforeTimestamp)
      .where(function hasTraffic() {
        this.where('bytes_received', '>', 0)
          .orWhere('bytes_sent', '>', 0);
      })
      .orderBy('timestamp', 'desc')
      .first();

    if (meaningful) {
      return meaningful;
    }

    return this.db('statistic')
      .where('server_id', Number(serverId))
      .where('timestamp', '<', beforeTimestamp)
      .orderBy('timestamp', 'desc')
      .first();
  }

  async buildServerStatisticsRow(serverId) {
    const server = await this.db('servers')
      .where('id', Number(serverId))
      .where('enable', true)
      .whereNot(function excludePlaceholder() {
        this.where('input_port', 5998).where('output_port', 5999);
      })
      .first('id', 'user_id');

    if (!server) {
      return null;
    }

    const row = await this.fetchLatestStatisticRow(server.id);

    if (!row || isEmptyStatisticRow(row)) {
      return {
        server_id: server.id,
        user_id: server.user_id,
        bytes_received: 0,
        bytes_sent: 0,
        connections_count: 0,
        timestamp: row?.timestamp || null,
        avg_receive_speed: null,
        avg_send_speed: null
      };
    }

    const prevRow = await this.fetchPreviousStatisticRow(server.id, row.timestamp);
    const speeds = computeSpeed(row, prevRow);

    return {
      ...row,
      user_id: server.user_id,
      avg_receive_speed: speeds.avg_receive_speed,
      avg_send_speed: speeds.avg_send_speed
    };
  }

  async find(params = {}) {
    const servers = await this.fetchEnabledServers(params);
    const result = [];

    for (const server of servers) {
      const row = await this.buildServerStatisticsRow(server.id);
      if (row) {
        result.push(row);
      }
    }

    return result;
  }

  async get(id, param) {
    const row = await this.fetchLatestStatisticRow(Number(id));
    return row ? [row] : [];
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

    const rows = Array.isArray(result) ? result : (result.rows || []);
    return filterEmptyStatisticSnapshots(rows);
  }

  async resetByServer(serverId) {
    await this.db('statistic').where('server_id', Number(serverId)).del();
    return { success: true, message: `Statistics for server ${serverId} have been reset` };
  }
};
