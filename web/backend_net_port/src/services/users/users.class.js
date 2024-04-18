'use strict';

const fs = require('fs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

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

    await this.db1
      .from('users')
      .where('id', Number(id))
      .update(data)
      .returning('*');

    return `user${id} update`;
  }

  async remove(id) {
    const user = await this.get(id);
    if (user.login == 'admin') return await this.find();

    await this.db1
      .from('users')
      .where('id', id)
      .del();

    const command_start_service = 'systemctl';
    const args_disable_service = 'disable';
    const args_name_service = `net_port_u${id}`;

    await exec(`${command_start_service} ${args_disable_service} ${args_name_service}`);
  
    const filepath = `/etc/systemd/system/net_port_u${id}.service`;

    try {
      fs.unlinkSync(filepath);
    } catch (e) {
      return e;
    }

    return `user${id} remove`;
  }

  async create(data) {
    
    const id = await this.db1
      .insert(data)
      .into('users')
      .returning('id');

    const service = String(`\
[Unit]\n\
Description=net port service user ${id}\n\
After=network.target auditd.service\n\
\n\
[Service]\n\
WorkingDirectory=/root/net_port\n\
ExecStart=/root/net_port/module_net_port_server-0.0.0 --user ${id}\n\
User=root\n\
Type=simple\n\
Restart=always\n\
RestartSec=5\n\
\n\
[Install]\n\
WantedBy=multi-user.target\n`);
  
    const filepath = `/etc/systemd/system/net_port_u${id}.service`;
    //const filepath = `C:\\tmp\\net_port_u${id}.service`;

    try {
      fs.writeFileSync(filepath, service, { flag: "wx" });
    } catch (e) {
      return e;
    }

    const command_start_service = 'systemctl';
    const args_enable_service = 'enable';
    const args_name_service = `net_port_u${id}`;

    await exec(`${command_start_service} ${args_enable_service} ${args_name_service}`);

    return `user${id} add`;
  }
};
