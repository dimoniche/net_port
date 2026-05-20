'use strict';

const users = require('./users/users.service.js');
const role = require('./role/role.service.js');
const servers = require('./servers/servers.service.js');
const statistics = require('./statistics/statistics.service.js');
const { Devices } = require('./devices/devices.service.js');
const hooks = require('./devices/devices.hooks');

// eslint-disable-next-line no-unused-vars
module.exports = function (app) {
  app.configure(users);
  app.configure(role);
  app.configure(servers);
  app.configure(statistics);
  
  // Configure devices service
  const SERVICE_ENDPOINT = (app.get('prefix') || '') + '/devices';
  const options = {
    Model: app.get('db'),
    paginate: app.get('paginate')
  };
  app.use(SERVICE_ENDPOINT, new Devices(options, app));
  const service = app.service(SERVICE_ENDPOINT);
  service.hooks(hooks);
};
