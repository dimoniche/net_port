'use strict';

const {authenticate} = require('@feathersjs/authentication').hooks;

const {
  hashPassword, protect
} = require('@feathersjs/authentication-local').hooks;

const checkPermissions = require('feathers-permissions');

module.exports = {
  before: {
    all: [],
    find: [authenticate('jwt')],
    get: [authenticate('jwt')],
    create: [hashPassword('password')],
    update: [hashPassword('password'), authenticate('jwt'),checkPermissions({
      roles: [ 'admin' ],
      field: 'role_name'
    })],
    patch: [hashPassword('password'), authenticate('jwt'),checkPermissions({
      roles: [ 'admin' ],
      field: 'role_name'
    })],
    remove: [authenticate('jwt'),checkPermissions({
      roles: [ 'admin' ],
      field: 'role_name'
    })]
  },

  after: {
    all: [
      protect('password')
    ],
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
