require('dotenv').config();
'use strict';

/* eslint-disable no-console */
const logger = require('./logger');
const app = require('./app');
const startDeviceStatusWatcher = require('./device-status-watcher');
const startDeviceAutoConnect = require('./device-auto-connect');
const port = app.get('port');

process.on('unhandledRejection', (reason, p) =>
  logger.error('Unhandled Rejection at: Promise ', p, reason)
);

process.on('uncaughtException', (err) => {
  logger.error(err, 'Uncaught Exception thrown');
});

app.listen(port, '0.0.0.0')
  .then(() => {
    logger.info('Feathers application started on http://%s:%d', app.get('host'), port);
    startDeviceStatusWatcher(app);
    startDeviceAutoConnect(app);
  })
  .catch((error) => {
    logger.error('Failed to start Feathers application: %s', error.message);
    process.exit(1);
  });
