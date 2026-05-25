export const SERVER_PORT_MIN = 5000;
export const SERVER_PORT_MAX = 5999;
export const DEVICE_PORT_MIN = 6000;
export const DEVICE_PORT_MAX = 7000;

export function portInServerRange(port) {
  const value = Number(port);
  return Number.isInteger(value) && value >= SERVER_PORT_MIN && value <= SERVER_PORT_MAX;
}

export function portInDeviceRange(port) {
  const value = Number(port);
  return Number.isInteger(value) && value >= DEVICE_PORT_MIN && value <= DEVICE_PORT_MAX;
}
