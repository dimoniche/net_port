'use strict';

const users = require('./users/users.service.js');
const role = require('./role/role.service.js');
const servers = require('./servers/servers.service.js');
const statistics = require('./statistics/statistics.service.js');
const { Devices } = require('./devices/devices.service.js');
const hooks = require('./devices/devices.hooks');

// eslint-disable-next-line no-unused-vars
module.exports = function (app) {
  app.configure(users);
  app.configure(role);
  app.configure(servers);
  app.configure(statistics);
  
  // Configure devices service
  const SERVICE_ENDPOINT = (app.get('prefix') || '') + '/devices';
  const options = {
    Model: app.get('db'),
    paginate: app.get('paginate')
  };
  app.use(SERVICE_ENDPOINT, new Devices(options, app));
  const service = app.service(SERVICE_ENDPOINT);
  service.hooks(hooks);

  // Custom routes for devices
  app.post(`${SERVICE_ENDPOINT}/:deviceId/connect`, async (req, res, next) => {
    try {
      const { deviceId } = req.params;
      const user = req.feathers?.user || req.user;

      if (!deviceId) {
        return res.status(400).json({
          error: 'Missing required parameter: deviceId'
        });
      }

      const devicesService = new Devices(options, app);
      const result = await devicesService.connect(deviceId, { user });
      res.json(result);
    } catch (error) {
      console.error('Error in device connect endpoint:', error);
      res.status(500).json({
        error: 'Internal server error',
        details: error.message
      });
    }
  });

  app.post(`${SERVICE_ENDPOINT}/:deviceId/disconnect`, async (req, res, next) => {
    try {
      const { deviceId } = req.params;
      const user = req.feathers?.user || req.user;

      if (!deviceId) {
        return res.status(400).json({
          error: 'Missing required parameter: deviceId'
        });
      }

      const devicesService = new Devices(options, app);
      const result = await devicesService.disconnect(deviceId, { user });
      res.json(result);
    } catch (error) {
      console.error('Error in device disconnect endpoint:', error);
      res.status(500).json({
        error: 'Internal server error',
        details: error.message
      });
    }
  });

  app.post(`${SERVICE_ENDPOINT}/:deviceId/restart`, async (req, res, next) => {
    try {
      const { deviceId } = req.params;
      const user = req.feathers?.user || req.user;

      if (!deviceId) {
        return res.status(400).json({
          error: 'Missing required parameter: deviceId'
        });
      }

      const devicesService = new Devices(options, app);
      const result = await devicesService.restart(deviceId, { user });
      res.json(result);
    } catch (error) {
      console.error('Error in device restart endpoint:', error);
      res.status(500).json({
        error: 'Internal server error',
        details: error.message
      });
    }
  });

  app.get(`${SERVICE_ENDPOINT}/:deviceId/ping`, async (req, res, next) => {
    try {
      const { deviceId } = req.params;
      const user = req.feathers?.user || req.user;

      if (!deviceId) {
        return res.status(400).json({
          error: 'Missing required parameter: deviceId'
        });
      }

      const devicesService = new Devices(options, app);
      const result = await devicesService.ping(deviceId, { user });
      res.json(result);
    } catch (error) {
      console.error('Error in device ping endpoint:', error);
      res.status(500).json({
        error: 'Internal server error',
        details: error.message
      });
    }
  });
};
