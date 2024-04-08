'use strict';

const {Users} = require('./users.class');
const createModel = require('../../models/users.model');
const hooks = require('./users.hooks');

module.exports = function (app) {
  const SERVICE_ENDPOINT = app.get('prefix') + '/users';

  const options = {
    Model: createModel(app),
    paginate: app.get('paginate')
  };
  app.use(SERVICE_ENDPOINT, new Users(options, app));
  const service = app.service(SERVICE_ENDPOINT);
  service.hooks(hooks);
};
