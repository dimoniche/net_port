'use strict';

const { Servers } = require('./servers.class');
const hooks = require('./servers.hooks');
const { authenticateRequest, mapServiceError } = require('../../lib/authenticateRequest');

module.exports = function (app) {
  const SERVICE_ENDPOINT = app.get('prefix') + '/servers';

  app.use(SERVICE_ENDPOINT, new Servers(app.get('db')));
  const service = app.service(SERVICE_ENDPOINT);
  service.hooks(hooks);

  app.post(`${SERVICE_ENDPOINT}/:serverId/restart`, async (req, res) => {
    try {
      const { serverId } = req.params;
      const user = await authenticateRequest(app, req);

      if (!user) {
        return res.status(401).json({
          error: 'Authentication required'
        });
      }

      if (!serverId) {
        return res.status(400).json({
          error: 'Missing required parameter: serverId'
        });
      }

      const serversService = app.service(SERVICE_ENDPOINT);
      const result = await serversService.restart(serverId, { user });
      res.json(result);
    } catch (error) {
      console.error('Error in server restart endpoint:', error);
      res.status(mapServiceError(error)).json({
        error: error.message,
        details: error.message
      });
    }
  });
};
