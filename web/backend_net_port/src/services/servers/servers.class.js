'use strict';

const util = require('util');
const exec = util.promisify(require('child_process').exec);

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

  async remove(id) {

    const server = await this.db
      .from('servers')
      .where('id', Number(id))
      .first();

    await this.db
      .from('servers')
      .where('id', id)
      .del();

    const command_start_service = 'systemctl';
    const args_restart_service = 'restart';
    const args_name_service = `net_port_u${server.user_id}`;

    await exec(`${command_start_service} ${args_restart_service} ${args_name_service}`);
  
    return this.db
      .from('servers')
      .where('user_id', Number(server.user_id))
      .select();
  }

  async create(data) {

    await this.db
      .insert(data)
      .into('servers');

    const command_start_service = 'systemctl';
    const args_restart_service = 'restart';
    const args_name_service = `net_port_u${data.user_id}`;

    await exec(`${command_start_service} ${args_restart_service} ${args_name_service}`);

    return `server add`;
  }
};
