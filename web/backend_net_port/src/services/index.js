'use strict';

const roles = require('./users/users.service.js');

// eslint-disable-next-line no-unused-vars
module.exports = function (app) {
  app.configure(roles);
};
