'use strict';

const {
  normalizePreferredPort,
  validateDeviceId,
  validateDeviceType,
  validateInternalPort,
  deviceIdConflictError
} = require('../src/services/devices/deviceValidation');

describe('deviceValidation', () => {
  describe('normalizePreferredPort', () => {
    it('accepts even ports in range', () => {
      expect(normalizePreferredPort(6000)).toBe(6000);
      expect(normalizePreferredPort('6010')).toBe(6010);
    });

    it('normalizes empty values to null', () => {
      expect(normalizePreferredPort(null)).toBeNull();
      expect(normalizePreferredPort('')).toBeNull();
      expect(normalizePreferredPort(undefined)).toBeNull();
    });

    it('rejects odd ports', () => {
      expect(() => normalizePreferredPort(6001)).toThrow(/even integer/);
    });

    it('rejects out-of-range ports', () => {
      expect(() => normalizePreferredPort(5998)).toThrow(/6000 and 6998/);
      expect(() => normalizePreferredPort(7000)).toThrow(/6000 and 6998/);
    });
  });

  describe('validateDeviceId', () => {
    it('accepts valid ids', () => {
      expect(() => validateDeviceId('test-device_01')).not.toThrow();
    });

    it('rejects short ids', () => {
      expect(() => validateDeviceId('ab')).toThrow(/3 and 64/);
    });

    it('rejects unsafe characters', () => {
      expect(() => validateDeviceId('bad;drop')).toThrow(/invalid characters/);
    });
  });

  describe('validateDeviceType', () => {
    it('accepts known types', () => {
      expect(() => validateDeviceType('iot_gateway')).not.toThrow();
    });

    it('rejects unknown types', () => {
      expect(() => validateDeviceType('unknown')).toThrow(/Invalid device type/);
    });
  });

  describe('deviceIdConflictError', () => {
    it('returns Conflict with device id in message', () => {
      const err = deviceIdConflictError('my-device');
      expect(err.name).toBe('Conflict');
      expect(err.message).toMatch(/my-device/);
      expect(err.message).toMatch(/already exists/);
    });
  });

  describe('validateInternalPort', () => {
    it('accepts valid ports', () => {
      expect(validateInternalPort(22)).toBe(22);
    });

    it('rejects invalid ports', () => {
      expect(() => validateInternalPort(70000)).toThrow(/1 and 65535/);
    });
  });
});
