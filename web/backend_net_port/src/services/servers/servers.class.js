'use strict';

const util = require('util');
const exec = util.promisify(require('child_process').exec);

exports.Servers = class Servers {
  constructor(dbInstance) {
    this.db = dbInstance;
  }

  async find(params) {

    if (params.query.inputports != null) {
      return this.db
        .from('servers')
        .select('input_port');
    } else if (params.query.outputports != null) {
      return this.db
        .from('servers')
        .select('output_port');
    } else {
      return this.db
        .from('servers')
        .select();
    }
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
    const serverId = Number(id);
    const server = await this.db
      .from('servers')
      .where('id', serverId)
      .first();

    if (!server) {
      throw new Error(`Server with id ${id} not found`);
    }

    await this.db('statistic').where('server_id', serverId).del();

    await this.db
      .from('servers')
      .where('id', serverId)
      .del();

    try {
      const killCommand = `pkill -SIGTERM -f "module_net_port_server"`;
      await exec(killCommand);
    } catch (e) {

    }

    return this.db
      .from('servers')
      .where('user_id', Number(server.user_id))
      .select();
  }

  async create(data) {

    await this.db
      .insert(data)
      .into('servers');

    try {
      const killCommand = `pkill -SIGTERM -f "module_net_port_server"`;
      await exec(killCommand);
    } catch (e) {

    }

    return `server add`;
  }

  async update(id, data) {

    await this.db
      .from('servers')
      .where('id', Number(id))
      .update(data);

    try {
      const killCommand = `pkill -SIGTERM -f "module_net_port_server"`;
      await exec(killCommand);
    } catch (e) {

    }

    return `server ${id} updated`;
  }

  async restart(id) {
    const server = await this.db
      .from('servers')
      .where('id', Number(id))
      .first();

    if (!server) {
      throw new Error(`Server with id ${id} not found`);
    }

    try {
      const killCommand = `pkill -SIGTERM -f "module_net_port_server"`;
      await exec(killCommand);
    } catch (e) {

    }
    return { success: true, message: `Server ${id} restarted successfully` };
  }
};
