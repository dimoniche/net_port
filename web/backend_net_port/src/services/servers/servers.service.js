'use strict';

const { Servers } = require('./servers.class');
const hooks = require('./servers.hooks');

module.exports = function (app) {
  const SERVICE_ENDPOINT = app.get('prefix') + '/servers';

  app.use(SERVICE_ENDPOINT, new Servers(app.get('db')));
  const service = app.service(SERVICE_ENDPOINT);
  service.hooks(hooks);
};
