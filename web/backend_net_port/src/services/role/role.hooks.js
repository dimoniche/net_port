'use strict';

const { authenticate } = require('@feathersjs/authentication').hooks;
const checkPermissions = require('feathers-permissions');

module.exports = {
  before: {
    all: [],
    find: [authenticate('jwt'),checkPermissions({
      roles: [ 'admin' ],
      field: 'role_name'
    })],
    get: [authenticate('jwt'),checkPermissions({
      roles: [ 'admin' ],
      field: 'role_name'
    })],
    create: [authenticate('jwt'),checkPermissions({
      roles: [ 'admin' ],
      field: 'role_name'
    })],
    update: [authenticate('jwt'),checkPermissions({
      roles: [ 'admin' ],
      field: 'role_name'
    })],
    patch: [authenticate('jwt'),checkPermissions({
      roles: [ 'admin' ],
      field: 'role_name'
    })],
    remove: [authenticate('jwt'),checkPermissions({
      roles: [ 'admin' ],
      field: 'role_name'
    })]
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
