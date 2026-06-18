'use strict';

const users = require('./users/users.service.js');
const role = require('./role/role.service.js');
const servers = require('./servers/servers.service.js');
const statistics = require('./statistics/statistics.service.js');
const configureSettings = require('./settings/settings.service.js');
const { Devices } = require('./devices/devices.service.js');
const hooks = require('./devices/devices.hooks');
const { authenticate } = require('@feathersjs/authentication').hooks;
const { listClientDownloads } = require('../client-downloads');
const { getLatestClientRelease, checkClientUpdate } = require('../client-releases');
const { configureClientRuntimeConfig } = require('../client-runtime-config');
const { authenticateRequest, mapServiceError } = require('../lib/authenticateRequest');

// eslint-disable-next-line no-unused-vars
module.exports = function (app) {
  app.configure(users);
  app.configure(role);
  app.configure(servers);
  app.configure(statistics);
  configureSettings(app);
  configureClientRuntimeConfig(app);
  
  // Configure devices service
  const SERVICE_ENDPOINT = (app.get('prefix') || '') + '/devices';
  const options = {
    Model: app.get('db'),
    paginate: app.get('paginate')
  };
  app.use(SERVICE_ENDPOINT, new Devices(options, app));
  const service = app.service(SERVICE_ENDPOINT);
  service.hooks(hooks);

  const authenticateDeviceRequest = (req) => authenticateRequest(app, req);

  app.get(`${SERVICE_ENDPOINT}/statistics/summary`, async (req, res) => {
    try {
      const user = await authenticateDeviceRequest(req);
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const devicesService = app.service(SERVICE_ENDPOINT);
      const result = await devicesService.getStatisticsSummary({ user, query: req.query });
      res.json(result);
    } catch (error) {
      console.error('Error in device statistics summary endpoint:', error);
      res.status(mapServiceError(error)).json({
        error: error.message,
        details: error.message
      });
    }
  });

  app.get(`${SERVICE_ENDPOINT}/:deviceId/statistics`, async (req, res) => {
    try {
      const user = await authenticateDeviceRequest(req);
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { deviceId } = req.params;
      const devicesService = app.service(SERVICE_ENDPOINT);
      const result = await devicesService.getDeviceStatistics(deviceId, {
        user,
        query: req.query
      });
      res.json(result);
    } catch (error) {
      console.error('Error in device statistics endpoint:', error);
      res.status(mapServiceError(error)).json({
        error: error.message,
        details: error.message
      });
    }
  });

  app.delete(`${SERVICE_ENDPOINT}/:deviceId/statistics/reset`, async (req, res) => {
    try {
      const user = await authenticateDeviceRequest(req);
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { deviceId } = req.params;
      const devicesService = app.service(SERVICE_ENDPOINT);
      const result = await devicesService.resetDeviceStatistics(deviceId, { user });
      res.json(result);
    } catch (error) {
      console.error('Error in device statistics reset endpoint:', error);
      res.status(mapServiceError(error)).json({
        error: error.message,
        details: error.message
      });
    }
  });

  // Custom routes for devices with authentication
  app.post(`${SERVICE_ENDPOINT}/:deviceId/connect`, async (req, res, next) => {
    try {
      const { deviceId } = req.params;
      const user = await authenticateDeviceRequest(req);
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (!deviceId) {
        return res.status(400).json({
          error: 'Missing required parameter: deviceId'
        });
      }

      const devicesService = app.service(SERVICE_ENDPOINT);
      const result = await devicesService.connect(deviceId, { user });
      res.json(result);
    } catch (error) {
      console.error('Error in device connect endpoint:', error);
      res.status(mapServiceError(error)).json({
        error: error.message,
        details: error.message
      });
    }
  });

  app.post(`${SERVICE_ENDPOINT}/:deviceId/disconnect`, async (req, res, next) => {
    try {
      const { deviceId } = req.params;
      const user = await authenticateDeviceRequest(req);
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
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
      res.status(mapServiceError(error)).json({
        error: error.message,
        details: error.message
      });
    }
  });

  app.post(`${SERVICE_ENDPOINT}/:deviceId/restart`, async (req, res, next) => {
    try {
      const { deviceId } = req.params;
      const user = await authenticateDeviceRequest(req);
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
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
      res.status(mapServiceError(error)).json({
        error: error.message,
        details: error.message
      });
    }
  });

  app.get(`${SERVICE_ENDPOINT}/:deviceId/ping`, async (req, res, next) => {
    try {
      const { deviceId } = req.params;
      const user = await authenticateDeviceRequest(req);
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
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
      res.status(mapServiceError(error)).json({
        error: error.message,
        details: error.message
      });
    }
  });

  const prefix = app.get('prefix') || '';
  app.get(`${prefix}/clients/downloads`, (req, res) => {
    const downloads = listClientDownloads();
    res.json({
      downloads,
      files: downloads.map((item) => item.filename)
    });
  });

  app.get(`${prefix}/clients/latest`, (req, res) => {
    const latest = getLatestClientRelease(req.query);
    if (!latest) {
      res.status(503).json({ error: 'Published version is not configured' });
      return;
    }
    if (!latest.available) {
      res.status(404).json({
        error: 'Client binary not found on server',
        ...latest
      });
      return;
    }
    res.json(latest);
  });

  app.get(`${prefix}/clients/latest/check`, (req, res) => {
    const result = checkClientUpdate(req.query);
    if (!result.latest && result.reason === 'version_unavailable') {
      res.status(503).json(result);
      return;
    }
    res.json(result);
  });
};
