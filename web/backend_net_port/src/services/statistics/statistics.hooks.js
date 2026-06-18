'use strict';

const { authenticate } = require('@feathersjs/authentication').hooks;
const checkPermissions = require('feathers-permissions');
const { resolveStatisticsUserId } = require('./statistics.helpers');

module.exports = {
  before: {
    all: [
      authenticate('jwt'),
      checkPermissions({
        roles: ['admin', 'user'],
        field: 'role_name'
      })
    ],
    find: [
      async (context) => {
        const userId = resolveStatisticsUserId(context.params);

        const user = context.params.user;
        const isAdmin = user?.role === 'admin' || user?.role_name === 'admin';

        if (userId != null && !isAdmin) {
          context.params.query = {
            ...context.params.query,
            user_id: userId
          };
        }

        return context;
      }
    ],
    get: [],
    create: [],
    update: [],
    patch: [],
    remove: []
  },

  after: {
    all: [],
    find: [],
    get: [],
    create: [],
    update: [],
    patch: [],
    remove: []
  },

  error: {
    all: [],
    find: [],
    get: [],
    create: [],
    update: [],
    patch: [],
    remove: []
  }
};
