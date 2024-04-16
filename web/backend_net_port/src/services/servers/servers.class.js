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

  async get(id, param) {

    if (param.query.user_id == null) {
      return this.db
        .from('servers')
        .where('id', Number(id))
        .select();
    } else {
      return this.db
        .from('servers')
        .where('user_id', Number(param.query.user_id))
        .select();
    }
  }

  async create(data) {

    await this.db
      .insert(data)
      .into('servers');

    return await this.find();
  }
};
