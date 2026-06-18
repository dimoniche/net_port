'use strict';

async function authenticateRequest(app, req) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.substring(7);
      const authServicePath = (app.get('prefix') || '') + '/authentication';
      const authResult = await app.service(authServicePath).verifyAccessToken(token);
      const payload = authResult.user || authResult;
      const userId = payload.id || payload.sub;

      if (userId != null) {
        return app.get('db')('users').where('id', Number(userId)).first();
      }
    } catch (error) {
      return null;
    }
  }

  return req.feathers?.user || null;
}

module.exports = function configureSettingsService(app) {
  const prefix = app.get('prefix') || '';
  const endpoint = `${prefix}/settings/auto-connect`;

  app.get(endpoint, async (req, res) => {
    try {
      const user = await authenticateRequest(app, req);
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const row = await app.get('db')('users')
        .where('id', user.id)
        .select('auto_connect_enabled')
        .first();

      res.json({
        enabled: row?.auto_connect_enabled !== false
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch(endpoint, async (req, res) => {
    try {
      const user = await authenticateRequest(app, req);
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const enabled = req.body?.enabled !== false;

      await app.get('db')('users')
        .where('id', user.id)
        .update({ auto_connect_enabled: enabled });

      res.json({ enabled });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
};
