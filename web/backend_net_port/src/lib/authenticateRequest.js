'use strict';

const { NotAuthenticated, Forbidden, NotFound } = require('@feathersjs/errors');

async function authenticateRequest(app, req) {
  let user = null;
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.substring(7);
      const authServicePath = (app.get('prefix') || '') + '/authentication';
      const authResult = await app.service(authServicePath).verifyAccessToken(token);
      const payload = authResult.user || authResult;
      const userId = payload.id || payload.sub;

      if (userId != null) {
        user = await app.get('db')('users').where('id', Number(userId)).first();
      }
    } catch (authError) {
      console.error('Authentication failed:', authError);
    }
  }

  if (!user && req.feathers?.user) {
    user = req.feathers.user;
  }

  return user;
}

function mapServiceError(error) {
  if (error.code && Number.isFinite(error.code)) {
    return error.code;
  }
  if (error instanceof NotAuthenticated) {
    return 401;
  }
  if (error instanceof Forbidden) {
    return 403;
  }
  if (error instanceof NotFound) {
    return 404;
  }
  if (error.message === 'Authentication required') {
    return 401;
  }
  if (error.message === 'Permission denied') {
    return 403;
  }
  if (
    error.message === 'Device not found'
    || (typeof error.message === 'string' && error.message.includes('not found'))
  ) {
    return 404;
  }
  return 500;
}

module.exports = {
  authenticateRequest,
  mapServiceError
};
