'use strict';

const { Servers } = require('./servers.class');
const hooks = require('./servers.hooks');

module.exports = function (app) {
  const SERVICE_ENDPOINT = app.get('prefix') + '/servers';

  app.use(SERVICE_ENDPOINT, new Servers(app.get('db')));
  const service = app.service(SERVICE_ENDPOINT);
  service.hooks(hooks);

  // Custom route for restarting a server
  app.post(`${SERVICE_ENDPOINT}/:serverId/restart`, async (req, res, next) => {
    try {
      const { serverId } = req.params;

      if (!serverId) {
        return res.status(400).json({
          error: 'Missing required parameter: serverId'
        });
      }

      const serversService = new Servers(app.get('db'));
      const result = await serversService.restart(serverId);
      res.json(result);
    } catch (error) {
      console.error('Error in server restart endpoint:', error);
      res.status(500).json({
        error: 'Internal server error',
        details: error.message
      });
    }
  });
};
