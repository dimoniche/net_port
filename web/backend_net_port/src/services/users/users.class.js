'use strict';

const { Service } = require('feathers-knex');

exports.Users = class Users extends Service {
  constructor(options) {
    super({
      ...options,
      name: 'users'
    });
    this.db1 = options.Model;
  }

  async update(id, data) {
    const user = await this.get(id);

    console.log(data);

    await this.db1
      .from('users')
      .where('id', Number(id))
      .update(data)
      .returning('*');

    return await this.find();
  }

  async remove(id) {
    const user = await this.get(id);
    if (user.login == 'admin') return await this.find();

    await this.db1
      .from('users')
      .where('id', id)
      .del();

    return await this.find();
  }

  async create(data) {

    console.log(data);
    
    await this.db1
      .insert(data)
      .into('users');

    return await this.find();
  }
};
