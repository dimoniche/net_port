'use strict';

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

module.exports = {
  isAdminUser,
  canAccessDevice,
  applyDeviceOwnershipFilter
};
