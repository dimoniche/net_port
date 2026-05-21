'use strict';

const users = require('./users/users.service.js');
const role = require('./role/role.service.js');
const servers = require('./servers/servers.service.js');
const statistics = require('./statistics/statistics.service.js');
const { Devices } = require('./devices/devices.service.js');
const hooks = require('./devices/devices.hooks');
const { authenticate } = require('@feathersjs/authentication').hooks;

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

  // Custom routes for devices with authentication
  app.post(`${SERVICE_ENDPOINT}/:deviceId/connect`, async (req, res, next) => {
    try {
      const { deviceId } = req.params;
      
      /*// Authenticate the request
      let user = null;
      const authHeader = req.headers.authorization;
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const token = authHeader.substring(7);
          // Verify the access token - use the correct authentication service path
          const authServicePath = (app.get('prefix') || '') + '/authentication';
          const authResult = await app.service(authServicePath).verifyAccessToken(token);
          user = authResult.user;
        } catch (authError) {
          console.error('Authentication failed:', authError);
          // Continue without user - will be handled by service
        }
      }
      
      // Also check feathers user from middleware
      if (!user && req.feathers?.user) {
        user = req.feathers.user;
      }*/

      if (!deviceId) {
        return res.status(400).json({
          error: 'Missing required parameter: deviceId'
        });
      }

      // Use the registered service instead of creating a new instance
      const devicesService = app.service(SERVICE_ENDPOINT);
      const result = await devicesService.connect(deviceId);
      res.json(result);
    } catch (error) {
      console.error('Error in device connect endpoint:', error);
      
      // Return appropriate status codes based on error message
      let statusCode = 500;
      if (error.message === 'Authentication required') {
        statusCode = 401;
      } else if (error.message === 'Permission denied') {
        statusCode = 403;
      } else if (error.message === 'Device not found') {
        statusCode = 404;
      }
      
      res.status(statusCode).json({
        error: error.message,
        details: error.message
      });
    }
  });

  app.post(`${SERVICE_ENDPOINT}/:deviceId/disconnect`, async (req, res, next) => {
    try {
      const { deviceId } = req.params;
      
      // Authenticate the request
      let user = null;
      const authHeader = req.headers.authorization;
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const token = authHeader.substring(7);
          // Verify the access token - use the correct authentication service path
          const authServicePath = (app.get('prefix') || '') + '/authentication';
          const authResult = await app.service(authServicePath).verifyAccessToken(token);
          user = authResult.user;
        } catch (authError) {
          console.error('Authentication failed:', authError);
          // Continue without user - will be handled by service
        }
      }
      
      // Also check feathers user from middleware
      if (!user && req.feathers?.user) {
        user = req.feathers.user;
      }

      if (!deviceId) {
        return res.status(400).json({
          error: 'Missing required parameter: deviceId'
        });
      }

      // Use the registered service instead of creating a new instance
      const devicesService = app.service(SERVICE_ENDPOINT);
      const result = await devicesService.disconnect(deviceId, { user });
      res.json(result);
    } catch (error) {
      console.error('Error in device disconnect endpoint:', error);
      
      // Return appropriate status codes based on error message
      let statusCode = 500;
      if (error.message === 'Authentication required') {
        statusCode = 401;
      } else if (error.message === 'Permission denied') {
        statusCode = 403;
      } else if (error.message === 'Device not found') {
        statusCode = 404;
      }
      
      res.status(statusCode).json({
        error: error.message,
        details: error.message
      });
    }
  });

  app.post(`${SERVICE_ENDPOINT}/:deviceId/restart`, async (req, res, next) => {
    try {
      const { deviceId } = req.params;
      
      // Authenticate the request
      let user = null;
      const authHeader = req.headers.authorization;
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const token = authHeader.substring(7);
          // Verify the access token - use the correct authentication service path
          const authServicePath = (app.get('prefix') || '') + '/authentication';
          const authResult = await app.service(authServicePath).verifyAccessToken(token);
          user = authResult.user;
        } catch (authError) {
          console.error('Authentication failed:', authError);
          // Continue without user - will be handled by service
        }
      }
      
      // Also check feathers user from middleware
      if (!user && req.feathers?.user) {
        user = req.feathers.user;
      }

      if (!deviceId) {
        return res.status(400).json({
          error: 'Missing required parameter: deviceId'
        });
      }

      // Use the registered service instead of creating a new instance
      const devicesService = app.service(SERVICE_ENDPOINT);
      const result = await devicesService.restart(deviceId, { user });
      res.json(result);
    } catch (error) {
      console.error('Error in device restart endpoint:', error);
      
      // Return appropriate status codes based on error message
      let statusCode = 500;
      if (error.message === 'Authentication required') {
        statusCode = 401;
      } else if (error.message === 'Permission denied') {
        statusCode = 403;
      } else if (error.message === 'Device not found') {
        statusCode = 404;
      }
      
      res.status(statusCode).json({
        error: error.message,
        details: error.message
      });
    }
  });

  app.get(`${SERVICE_ENDPOINT}/:deviceId/ping`, async (req, res, next) => {
    try {
      const { deviceId } = req.params;
      
      // Authenticate the request
      let user = null;
      const authHeader = req.headers.authorization;
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const token = authHeader.substring(7);
          // Verify the access token - use the correct authentication service path
          const authServicePath = (app.get('prefix') || '') + '/authentication';
          const authResult = await app.service(authServicePath).verifyAccessToken(token);
          user = authResult.user;
        } catch (authError) {
          console.error('Authentication failed:', authError);
          // Continue without user - will be handled by service
        }
      }
      
      // Also check feathers user from middleware
      if (!user && req.feathers?.user) {
        user = req.feathers.user;
      }

      if (!deviceId) {
        return res.status(400).json({
          error: 'Missing required parameter: deviceId'
        });
      }

      // Use the registered service instead of creating a new instance
      const devicesService = app.service(SERVICE_ENDPOINT);
      const result = await devicesService.ping(deviceId, { user });
      res.json(result);
    } catch (error) {
      console.error('Error in device ping endpoint:', error);
      
      // Return appropriate status codes based on error message
      let statusCode = 500;
      if (error.message === 'Authentication required') {
        statusCode = 401;
      } else if (error.message === 'Permission denied') {
        statusCode = 403;
      } else if (error.message === 'Device not found') {
        statusCode = 404;
      }
      
      res.status(statusCode).json({
        error: error.message,
        details: error.message
      });
    }
  });
};
