'use strict';

const {authenticate} = require('@feathersjs/authentication').hooks;

const {
  hashPassword, protect
} = require('@feathersjs/authentication-local').hooks;

const checkPermissions = require('feathers-permissions');
const {
  isAdminUser,
  assertSelfOrAdmin,
  isExternalProvider,
  stripPrivilegedUserFields
} = require('../../lib/userRoles');
const { assertLoginAvailable } = require('./userValidation');

module.exports = {
  before: {
    all: [],
    find: [
      authenticate('jwt'),
      async (context) => {
        const { user, provider } = context.params;

        // Internal lookups (e.g. local login) run without an authenticated user.
        if (!provider || !user) {
          return context;
        }

        if (isAdminUser(user)) {
          return context;
        }

        const query = { ...(context.params.query || {}) };
        query.login = user.login;
        context.params.query = query;
        return context;
      }
    ],
    get: [
      authenticate('jwt'),
      async (context) => {
        if (!isExternalProvider(context)) {
          return context;
        }
        assertSelfOrAdmin(context.params.user, context.id);
        return context;
      }
    ],
    create: [
      authenticate('jwt'),
      checkPermissions({
        roles: ['admin'],
        field: 'role_name'
      }),
      async (context) => {
        const knex = context.app.get('db');
        context.data.login = await assertLoginAvailable(knex, context.data?.login);
        return context;
      },
      hashPassword('password')
    ],
    update: [
      hashPassword('password'),
      authenticate('jwt'),
      checkPermissions({
        roles: ['admin', 'user'],
        field: 'role_name'
      }),
      async (context) => {
        if (isExternalProvider(context)) {
          assertSelfOrAdmin(context.params.user, context.id);
          context.data = stripPrivilegedUserFields(context.data, context.params.user);
        }
        if (context.data?.login) {
          const knex = context.app.get('db');
          context.data.login = await assertLoginAvailable(
            knex,
            context.data.login,
            context.id
          );
        }
        return context;
      }
    ],
    patch: [
      hashPassword('password'),
      authenticate('jwt'),
      checkPermissions({
        roles: ['admin', 'user'],
        field: 'role_name'
      }),
      async (context) => {
        if (isExternalProvider(context)) {
          assertSelfOrAdmin(context.params.user, context.id);
          context.data = stripPrivilegedUserFields(context.data, context.params.user);
        }
        if (context.data?.login) {
          const knex = context.app.get('db');
          context.data.login = await assertLoginAvailable(
            knex,
            context.data.login,
            context.id
          );
        }
        return context;
      }
    ],
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
