'use strict';

const { NotAuthenticated, Forbidden } = require('@feathersjs/errors');

function isAdminUser(user) {
  return user?.role === 'admin' || user?.role_name === 'admin';
}

function canAccessDevice(user, device) {
  if (!user || !device) {
    return false;
  }
  if (isAdminUser(user)) {
    return true;
  }
  if (device.user_id == null) {
    return false;
  }
  return Number(device.user_id) === Number(user.id);
}

function applyDeviceOwnershipFilter(knexQuery, user, column = 'devices.user_id') {
  if (!user || isAdminUser(user)) {
    return knexQuery;
  }

  return knexQuery.where(column, user.id);
}

function canAccessLegacyServers(user) {
  return isAdminUser(user);
}

function assertLegacyServersAccess(user) {
  if (!canAccessLegacyServers(user)) {
    throw new Forbidden('Permission denied');
  }
}

function assertSelfOrAdmin(user, targetUserId) {
  if (!user) {
    throw new NotAuthenticated('Authentication required');
  }
  if (isAdminUser(user)) {
    return;
  }
  if (Number(user.id) !== Number(targetUserId)) {
    throw new Forbidden('Permission denied');
  }
}

/** Skip ownership checks for internal service calls (e.g. local login). */
function isExternalProvider(context) {
  return Boolean(context.params?.provider);
}

function stripPrivilegedUserFields(data, user) {
  if (!data || isAdminUser(user)) {
    return data;
  }
  const sanitized = { ...data };
  delete sanitized.role_name;
  delete sanitized.role;
  return sanitized;
}

module.exports = {
  isAdminUser,
  canAccessDevice,
  canAccessLegacyServers,
  assertLegacyServersAccess,
  assertSelfOrAdmin,
  isExternalProvider,
  stripPrivilegedUserFields,
  applyDeviceOwnershipFilter
};
