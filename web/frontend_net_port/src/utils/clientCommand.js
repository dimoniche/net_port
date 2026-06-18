'use strict';

import { CLIENT_BINARY_NAME } from '../consts/client';

const DEFAULT_REGISTRATION_PORT = 8443;
const DEFAULT_PORT_HOST_BASE = 49000;
const DEFAULT_CONNECTIONS = 1;
const MAX_CONNECTIONS = 32;

function normalizeConnections(connections) {
  const value = Number(connections);
  if (!Number.isFinite(value) || value < 1) {
    return DEFAULT_CONNECTIONS;
  }
  return Math.min(Math.floor(value), MAX_CONNECTIONS);
}

export function buildDeviceClientCommand({
  deviceId,
  token,
  internalPort,
  internalAddress,
  registrationPort = DEFAULT_REGISTRATION_PORT,
  portHostBase = DEFAULT_PORT_HOST_BASE,
  connections = DEFAULT_CONNECTIONS,
}) {
  const parallelConnections = normalizeConnections(connections);

  let cmd = `./${CLIENT_BINARY_NAME} --device-id ${deviceId} --device-token ${token} --registration-server SERVER_IP --registration-port ${registrationPort} --registration-ca-file server.crt`;
  if (portHostBase) {
    cmd += ` --port-host-base ${portHostBase}`;
  }
  cmd += ` --connections ${parallelConnections}`;

  if (internalPort) {
    if (internalAddress && internalAddress !== '127.0.0.1') {
      return `${cmd} --host_out ${internalAddress}`;
    }
    return cmd;
  }

  return `${cmd} --host_out ${internalAddress || '127.0.0.1'} -p_out 22`;
}

export {
  DEFAULT_REGISTRATION_PORT,
  DEFAULT_PORT_HOST_BASE,
  DEFAULT_CONNECTIONS,
  MAX_CONNECTIONS,
};
