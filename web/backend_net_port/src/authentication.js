'use strict';

const { AuthenticationService, JWTStrategy } = require('@feathersjs/authentication');
const { LocalStrategy } = require('@feathersjs/authentication-local');
const { expressOauth } = require('@feathersjs/authentication-oauth');

module.exports = app => {
  const SERVICE_ENDPOINT = app.get('prefix') + '/authentication';
  const authentication = new AuthenticationService(app);

  authentication.register('jwt', new JWTStrategy());
  authentication.register('local', new LocalStrategy());

  app.use(SERVICE_ENDPOINT, authentication);
  app.configure(expressOauth());

  app.service(SERVICE_ENDPOINT).hooks({
    error: {
      all: [
        async function () {
        }
      ]
    }
  });
};
