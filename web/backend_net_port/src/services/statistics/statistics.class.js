'use strict';

exports.Statistics = class Statistics {
  constructor(dbInstance) {
    this.db = dbInstance;
  }

  async find(params) {
    // Сначала получаем последние записи для каждого сервера
    const latestQuery = `
      SELECT s1.*
      FROM statistic s1
      INNER JOIN (
        SELECT server_id, MAX(timestamp) as max_timestamp
        FROM statistic
        GROUP BY server_id
      ) s2 ON s1.server_id = s2.server_id AND s1.timestamp = s2.max_timestamp
      INNER JOIN servers srv ON srv.id = s1.server_id
      ORDER BY s1.server_id
    `;

    const latestResult = await this.db.raw(latestQuery);
    const latestRows = latestResult.rows || (latestResult[0] && latestResult[0].rows) || latestResult;

    // Затем для каждой последней записи получаем предыдущую запись
    const result = [];
    for (const row of latestRows) {
      const prevQuery = `
        SELECT bytes_received, bytes_sent, timestamp
        FROM statistic
        WHERE server_id = ${row.server_id} AND timestamp < '${row.timestamp}'
        ORDER BY timestamp DESC
        LIMIT 1
      `;

      const prevResult = await this.db.raw(prevQuery);
      const prevRows = prevResult.rows || (prevResult[0] && prevResult[0].rows) || prevResult;

      const prevRow = prevRows.length > 0 ? prevRows[0] : null;

      // Рассчитываем скорость
      let avgReceiveSpeed = null;
      let avgSendSpeed = null;

      if (prevRow) {
        const timeDiff = (new Date(row.timestamp).getTime() - new Date(prevRow.timestamp).getTime()) / 1000; // в секундах
        
        if (timeDiff > 0) {
          avgReceiveSpeed = (row.bytes_received - prevRow.bytes_received) / timeDiff;
          avgSendSpeed = (row.bytes_sent - prevRow.bytes_sent) / timeDiff;
        }
      }

      result.push({
        ...row,
        avg_receive_speed: avgReceiveSpeed,
        avg_send_speed: avgSendSpeed
      });
    }

    return result;
  }

  async get(id, param) {
    // Получаем последнее значение статистики для конкретного сервера
    return this.db
      .from('statistic')
      .where('server_id', Number(id))
      .select('*')
      .orderBy('timestamp', 'desc')
      .limit(1);
  }

  async getLatest() {
    // Получаем последнюю статистику для всех серверов
    const query = `
      SELECT s1.* 
      FROM statistic s1
      INNER JOIN (
        SELECT server_id, MAX(timestamp) as max_timestamp
        FROM statistic
        GROUP BY server_id
      ) s2 ON s1.server_id = s2.server_id AND s1.timestamp = s2.max_timestamp
      ORDER BY s1.server_id
    `;
    
    return this.db.raw(query);
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

  // Method to reset statistics for a specific server
  async resetByServer(serverId) {
    // Delete all records for the specified server
    await this.db('statistic').where('server_id', Number(serverId)).del();
    return { success: true, message: `Statistics for server ${serverId} have been reset` };
  }
};

