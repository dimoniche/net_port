'use strict';

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
  let statusCode = 500;
  if (error.message === 'Authentication required') {
    statusCode = 401;
  } else if (error.message === 'Permission denied') {
    statusCode = 403;
  } else if (
    error.message === 'Device not found'
    || (typeof error.message === 'string' && error.message.includes('not found'))
  ) {
    statusCode = 404;
  }
  return statusCode;
}

module.exports = {
  authenticateRequest,
  mapServiceError
};
