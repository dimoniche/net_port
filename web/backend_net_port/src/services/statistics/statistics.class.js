'use strict';

exports.Statistics = class Statistics {
  constructor(dbInstance) {
    this.db = dbInstance;
  }

  async find(params) {
    // Получаем статистику для всех серверов
    return this.db
      .from('statistic')
      .select('*')
      .orderBy('timestamp', 'desc');
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
    // Получаем статистику для сервера за определенный период
    return this.db
      .from('statistic')
      .where('server_id', Number(serverId))
      .where('timestamp', '>=', startTime)
      .where('timestamp', '<=', endTime)
      .select('*')
      .orderBy('timestamp', 'asc');
  }
};
