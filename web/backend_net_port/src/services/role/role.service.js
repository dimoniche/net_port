'use strict';

const { Role } = require('./role.class');
const hooks = require('./role.hooks');

module.exports = function (app) {
  const SERVICE_ENDPOINT = app.get('prefix') + '/role';

  app.use(SERVICE_ENDPOINT, new Role(app.get('db')));
  const service = app.service(SERVICE_ENDPOINT);
  service.hooks(hooks);
};
