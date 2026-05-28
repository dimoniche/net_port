'use strict';

const {
  resolveStatisticsUserId,
  computeSpeed,
  isEmptyStatisticRow,
  filterEmptyStatisticSnapshots,
  filterRegressiveStatisticSnapshots,
  isMonotonicStatisticPredecessor
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
    const server = await this.db('servers')
      .where('id', Number(serverId))
      .first('total_bytes_received', 'total_bytes_sent');

    const [peakRow] = await this.db('statistic')
      .where('server_id', Number(serverId))
      .select(
        this.db.raw('COALESCE(MAX(bytes_received), 0) AS peak_received'),
        this.db.raw('COALESCE(MAX(bytes_sent), 0) AS peak_sent')
      );

    const latestSnapshot = await this.db('statistic')
      .where('server_id', Number(serverId))
      .orderBy('timestamp', 'desc')
      .first('timestamp', 'connections_count');

    const bytesReceived = Math.max(
      Number(server?.total_bytes_received || 0),
      Number(peakRow?.peak_received || 0)
    );
    const bytesSent = Math.max(
      Number(server?.total_bytes_sent || 0),
      Number(peakRow?.peak_sent || 0)
    );

    if (bytesReceived === 0 && bytesSent === 0 && !latestSnapshot) {
      return null;
    }

    return {
      server_id: Number(serverId),
      bytes_received: bytesReceived,
      bytes_sent: bytesSent,
      connections_count: Number(latestSnapshot?.connections_count || 0),
      timestamp: latestSnapshot?.timestamp || null
    };
  }

  async fetchPreviousStatisticRow(serverId, currentRow) {
    const beforeTimestamp = currentRow?.timestamp;
    if (!beforeTimestamp) {
      return null;
    }

    const candidates = await this.db('statistic')
      .where('server_id', Number(serverId))
      .where('timestamp', '<', beforeTimestamp)
      .where(function hasTraffic() {
        this.where('bytes_received', '>', 0)
          .orWhere('bytes_sent', '>', 0);
      })
      .orderBy('timestamp', 'desc')
      .limit(30);

    const monotonic = candidates.find((row) => isMonotonicStatisticPredecessor(row, currentRow));
    if (monotonic) {
      return monotonic;
    }

    if (candidates.length > 0) {
      return candidates[0];
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

    const prevRow = await this.fetchPreviousStatisticRow(server.id, row);
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
    return filterRegressiveStatisticSnapshots(filterEmptyStatisticSnapshots(rows));
  }

  async resetByServer(serverId) {
    await this.db('statistic').where('server_id', Number(serverId)).del();
    await this.db('servers')
      .where('id', Number(serverId))
      .update({
        total_bytes_received: 0,
        total_bytes_sent: 0
      });
    return { success: true, message: `Statistics for server ${serverId} have been reset` };
  }
};
