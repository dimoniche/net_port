'use strict';

function normalizePreferredPort(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  const port = Number(value);
  if (!Number.isInteger(port)) {
    throw new Error('Fixed port must be an even integer between 6000 and 6998');
  }
  if (port < 6000 || port > 6998) {
    throw new Error('Fixed port must be an even integer between 6000 and 6998');
  }
  if (port % 2 !== 0) {
    throw new Error('Fixed port must be an even integer between 6000 and 6998');
  }

  return port;
}

function validateDeviceId(deviceId) {
  if (typeof deviceId !== 'string') {
    throw new Error('device_id must be a string');
  }
  if (deviceId.length < 3 || deviceId.length > 64) {
    throw new Error('device_id must be between 3 and 64 characters');
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(deviceId)) {
    throw new Error('device_id contains invalid characters');
  }
}

function validateDeviceType(type) {
  const allowed = ['iot_gateway', 'sensor', 'camera', 'router', 'other'];
  if (type !== undefined && type !== null && !allowed.includes(type)) {
    throw new Error('Invalid device type');
  }
}

function validateInternalPort(port) {
  if (port === null || port === undefined || port === '') {
    return null;
  }

  const value = Number(port);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error('internal_port must be an integer between 1 and 65535');
  }

  return value;
}

module.exports = {
  normalizePreferredPort,
  validateDeviceId,
  validateDeviceType,
  validateInternalPort
};
