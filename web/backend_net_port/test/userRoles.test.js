'use strict';

const {
  isAdminUser,
  canAccessDevice,
  applyDeviceOwnershipFilter
} = require('../src/lib/userRoles');

describe('userRoles', () => {
  describe('isAdminUser', () => {
    it('detects admin by role_name', () => {
      expect(isAdminUser({ role_name: 'admin' })).toBe(true);
    });

    it('detects admin by role', () => {
      expect(isAdminUser({ role: 'admin' })).toBe(true);
    });

    it('rejects regular users', () => {
      expect(isAdminUser({ role_name: 'user' })).toBe(false);
    });
  });

  describe('canAccessDevice', () => {
    it('allows admin for any device', () => {
      expect(canAccessDevice({ role_name: 'admin' }, { user_id: 99 })).toBe(true);
    });

    it('allows owner devices', () => {
      expect(canAccessDevice({ id: 1, role_name: 'user' }, { user_id: 1 })).toBe(true);
    });

    it('allows devices without owner', () => {
      expect(canAccessDevice({ id: 1, role_name: 'user' }, { user_id: null })).toBe(true);
    });

    it('denies other users devices', () => {
      expect(canAccessDevice({ id: 1, role_name: 'user' }, { user_id: 2 })).toBe(false);
    });
  });

  describe('applyDeviceOwnershipFilter', () => {
    it('does not scope admin queries', () => {
      const calls = [];
      const query = {
        where(fn) {
          calls.push('where');
          fn.call({ where: () => {}, orWhereNull: () => {} });
          return query;
        }
      };
      applyDeviceOwnershipFilter(query, { role_name: 'admin' });
      expect(calls).toHaveLength(0);
    });

    it('scopes regular user queries', () => {
      const calls = [];
      const query = {
        where(fn) {
          calls.push('where');
          fn.call({
            where(col, id) {
              calls.push(['where', col, id]);
              return {
                orWhereNull(nullCol) {
                  calls.push(['orWhereNull', nullCol]);
                }
              };
            }
          });
          return query;
        }
      };
      applyDeviceOwnershipFilter(query, { id: 5, role_name: 'user' }, 'devices.user_id');
      expect(calls).toEqual([
        'where',
        ['where', 'devices.user_id', 5],
        ['orWhereNull', 'devices.user_id']
      ]);
    });
  });
});
