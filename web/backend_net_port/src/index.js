'use strict';

/* eslint-disable no-console */
const logger = require('./logger');
const app = require('./app');
const port = app.get('port');
const server = app.listen(port, 'localhost');

process.on('unhandledRejection', (reason, p) =>
  logger.error('Unhandled Rejection at: Promise ', p, reason)
);

process.on('uncaughtException', (err) => {
  logger.error(err, 'Uncaught Exception thrown');
});

server.on('listening', 'localhost', () =>
  logger.info('Feathers application started on http://%s:%d', app.get('host'), port)
);
