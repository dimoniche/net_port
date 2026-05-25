'use strict';

const SERVER_PORT_MIN = 5000;
const SERVER_PORT_MAX = 5999;
const DEVICE_PORT_MIN = 6000;
const DEVICE_PORT_MAX = 7000;

function portInDeviceRange(port) {
  const value = Number(port);
  return Number.isInteger(value) && value >= DEVICE_PORT_MIN && value <= DEVICE_PORT_MAX;
}

function portInServerRange(port) {
  const value = Number(port);
  return Number.isInteger(value) && value >= SERVER_PORT_MIN && value <= SERVER_PORT_MAX;
}

function validateServerPorts(inputPort, outputPort) {
  const input = Number(inputPort);
  const output = Number(outputPort);

  if (!Number.isInteger(input) || !Number.isInteger(output)) {
    throw new Error('Ports must be integers');
  }

  if (portInDeviceRange(input) || portInDeviceRange(output)) {
    throw new Error(
      `Ports ${DEVICE_PORT_MIN}-${DEVICE_PORT_MAX} are reserved for devices`
    );
  }

  if (!portInServerRange(input) || !portInServerRange(output)) {
    throw new Error(
      `Server ports must be in range ${SERVER_PORT_MIN}-${SERVER_PORT_MAX}`
    );
  }

  if (input === output) {
    throw new Error('Input and output ports must differ');
  }
}

module.exports = {
  SERVER_PORT_MIN,
  SERVER_PORT_MAX,
  DEVICE_PORT_MIN,
  DEVICE_PORT_MAX,
  portInDeviceRange,
  portInServerRange,
  validateServerPorts,
};
