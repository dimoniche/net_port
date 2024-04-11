'use strict';

exports.Role = class Role {
  constructor(dbInstance) {
    this.db = dbInstance;
  }

  async find() {
    return this.db
      .from('role')
      .select();
  }
};
