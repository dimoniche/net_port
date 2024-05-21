'use strict';

const { createLogger, format, transports } = require('winston');
const { printf } = format;

const uspdFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} ${level}: ${message}`;
});

// Winston logger. Documentation https://github.com/winstonjs/winston
const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.splat(),
    format.simple(),
    format.timestamp(),
    uspdFormat
  ),
  transports: [
    new transports.File({ filename: 'error.log', level: 'error' }),
    new transports.File({ filename: 'combined.log' })
  ],
});

module.exports = logger;
