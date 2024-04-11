'use strict';

exports.Servers = class Servers {
  constructor(dbInstance) {
    this.db = dbInstance;
  }

  async find() {
    return this.db
      .from('servers')
      .select();
  }

  async get(id) {
    return this.db
      .from('servers')
      .where('user_id', Number(id))
      .select();
  }
};
