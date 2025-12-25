'use strict';

const { Statistics } = require('./statistics.class');
const hooks = require('./statistics.hooks');

module.exports = function (app) {
  const SERVICE_ENDPOINT = app.get('prefix') + '/statistics';

  app.use(SERVICE_ENDPOINT, new Statistics(app.get('db')));
  const service = app.service(SERVICE_ENDPOINT);
  service.hooks(hooks);
};