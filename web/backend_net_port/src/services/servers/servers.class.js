'use strict';

const util = require('util');
const exec = util.promisify(require('child_process').exec);
const { validateServerPorts } = require('../../config/ports');
const { assertLegacyServersAccess } = require('../../lib/userRoles');

exports.Servers = class Servers {
  constructor(dbInstance) {
    this.db = dbInstance;
  }

  async assertPortsAvailable(inputPort, outputPort, excludeServerId = null) {
    let query = this.db
      .from('servers')
      .where(function assignPortConflict() {
        this.where('input_port', inputPort)
          .orWhere('output_port', inputPort)
          .orWhere('input_port', outputPort)
          .orWhere('output_port', outputPort);
      });

    if (excludeServerId != null) {
      query = query.whereNot('id', Number(excludeServerId));
    }

    const conflict = await query.first();
    if (conflict) {
      throw new Error(`Port conflict with server #${conflict.id}`);
    }
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
    validateServerPorts(data.input_port, data.output_port);
    await this.assertPortsAvailable(data.input_port, data.output_port);

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
    const serverId = Number(id);
    const existing = await this.db
      .from('servers')
      .where('id', serverId)
      .first();

    if (!existing) {
      throw new Error(`Server with id ${id} not found`);
    }

    const inputPort = data.input_port != null ? data.input_port : existing.input_port;
    const outputPort = data.output_port != null ? data.output_port : existing.output_port;
    validateServerPorts(inputPort, outputPort);
    await this.assertPortsAvailable(inputPort, outputPort, serverId);

    await this.db
      .from('servers')
      .where('id', serverId)
      .update(data);

    try {
      const killCommand = `pkill -SIGTERM -f "module_net_port_server"`;
      await exec(killCommand);
    } catch (e) {

    }

    return `server ${id} updated`;
  }

  async restart(id, params = {}) {
    const { user } = params;

    if (!user) {
      throw new Error('Authentication required');
    }

    const server = await this.db
      .from('servers')
      .where('id', Number(id))
      .first();

    if (!server) {
      throw new Error(`Server with id ${id} not found`);
    }

    assertLegacyServersAccess(user);

    try {
      const killCommand = `pkill -SIGTERM -f "module_net_port_server"`;
      await exec(killCommand);
    } catch (e) {

    }
    return { success: true, message: `Server ${id} restarted successfully` };
  }
};
