'use strict';

exports.Statistics = class Statistics {
  constructor(dbInstance) {
    this.db = dbInstance;
  }

  async find(params) {
    // Получаем последнее значение статистики для каждого сервера
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

    const result = await this.db.raw(query);
    // Извлекаем массив результатов из ответа базы данных
    return result.rows || (result[0] && result[0].rows) || result;
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
    const result = await this.db
      .from('statistic')
      .where('server_id', Number(serverId))
      .where('timestamp', '>=', startTime)
      .where('timestamp', '<=', endTime)
      .select('*')
      .orderBy('timestamp', 'asc');

    // Ensure we return an array in all cases
    return Array.isArray(result) ? result : (result.rows || []);
  }
};
