'use strict';

const fs = require('fs');
const path = require('path');

const LOG_DIRS = [
  '/root/net_port/logs',
  path.join(__dirname, '../../../logs'),
  path.join(__dirname, '../../../../logs')
];

const FAILURE_PATTERNS = [
  /Authentication failed/i,
  /Failed to register device session/i,
  /JSON parse error/i,
  /Missing or invalid 'action'/i,
  /Failed to allocate port/i,
  /Failed to update device after registration/i,
  /Failed to bind to port 8443/i
];

const fileOffsets = new Map();
let registrationErrorsTotal = 0;

function lineMatchesFailure(line) {
  return FAILURE_PATTERNS.some((pattern) => pattern.test(line));
}

function scrapeLogFile(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return;
  }

  if (!stat.isFile()) {
    return;
  }

  let offset = fileOffsets.get(filePath) || 0;
  if (offset > stat.size) {
    offset = 0;
  }

  const length = stat.size - offset;
  if (length <= 0) {
    fileOffsets.set(filePath, stat.size);
    return;
  }

  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buffer, 0, length, offset);
  } finally {
    fs.closeSync(fd);
  }

  const chunk = buffer.toString('utf8');
  const lines = chunk.split('\n');
  for (const line of lines) {
    if (line && lineMatchesFailure(line)) {
      registrationErrorsTotal += 1;
    }
  }

  fileOffsets.set(filePath, stat.size);
}

function scrapeRegistrationLogs() {
  for (const dir of LOG_DIRS) {
    if (!fs.existsSync(dir)) {
      continue;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }

    for (const name of entries) {
      if (!/net_port|server|device/i.test(name)) {
        continue;
      }
      scrapeLogFile(path.join(dir, name));
    }
  }

  return registrationErrorsTotal;
}

function resetRegistrationLogMetricsForTests() {
  fileOffsets.clear();
  registrationErrorsTotal = 0;
}

module.exports = {
  scrapeRegistrationLogs,
  resetRegistrationLogMetricsForTests
};
