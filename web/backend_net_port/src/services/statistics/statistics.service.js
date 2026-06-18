'use strict';

const { Statistics } = require('./statistics.class');
const hooks = require('./statistics.hooks');
const { authenticateRequest, mapServiceError } = require('../../lib/authenticateRequest');

module.exports = function (app) {
  const SERVICE_ENDPOINT = app.get('prefix') + '/statistics';

  app.use(SERVICE_ENDPOINT, new Statistics(app.get('db')));
  const service = app.service(SERVICE_ENDPOINT);
  service.hooks(hooks);

  // Custom route for getting statistics by server and time range
  app.get(`${SERVICE_ENDPOINT}/:serverId/range`, async (req, res) => {
    try {
      const { serverId } = req.params;
      const { startTime, endTime } = req.query;
      const user = await authenticateRequest(app, req);

      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (!serverId || !startTime || !endTime) {
        return res.status(400).json({
          error: 'Missing required parameters: serverId, startTime, endTime'
        });
      }

      const statisticsService = new Statistics(app.get('db'));
      const data = await statisticsService.getByServerAndTimeRange(
        serverId,
        startTime,
        endTime,
        { user }
      );

      // Ensure we return an array
      const result = Array.isArray(data) ? data : (data.rows || []);
      res.json(result);
    } catch (error) {
      console.error('Error in statistics range endpoint:', error);
      res.status(mapServiceError(error)).json({
        error: error.message,
        details: error.message
      });
    }
  });

  // Custom route for resetting statistics by server
  app.delete(`${SERVICE_ENDPOINT}/:serverId/reset`, async (req, res) => {
    try {
      const { serverId } = req.params;
      const user = await authenticateRequest(app, req);

      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (!serverId) {
        return res.status(400).json({
          error: 'Missing required parameter: serverId'
        });
      }

      const statisticsService = new Statistics(app.get('db'));
      const result = await statisticsService.resetByServer(serverId, { user });
      res.json(result);
    } catch (error) {
      console.error('Error in statistics reset endpoint:', error);
      res.status(mapServiceError(error)).json({
        error: error.message,
        details: error.message
      });
    }
  });
};