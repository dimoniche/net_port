'use strict';

import { CLIENT_BINARY_NAME } from '../consts/client';

const DEFAULT_REGISTRATION_PORT = 8443;
const DEFAULT_PORT_HOST_BASE = 49000;

export function buildDeviceClientCommand({
  deviceId,
  token,
  internalPort,
  internalAddress,
  registrationPort = DEFAULT_REGISTRATION_PORT,
  portHostBase = DEFAULT_PORT_HOST_BASE,
}) {
  let base = `./${CLIENT_BINARY_NAME} --device-id ${deviceId} --device-token ${token} --registration-server SERVER_IP --registration-port ${registrationPort}`;
  if (portHostBase) {
    base += ` --port-host-base ${portHostBase}`;
  }

  if (internalPort) {
    if (internalAddress && internalAddress !== '127.0.0.1') {
      return `${base} --host_out ${internalAddress}`;
    }
    return base;
  }

  return `${base} --host_out ${internalAddress || '127.0.0.1'} -p_out 22`;
}

export {
  DEFAULT_REGISTRATION_PORT,
  DEFAULT_PORT_HOST_BASE,
};
