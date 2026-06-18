'use strict';

const {
  createAuthenticationRateLimiter,
  resolveAuthenticationRateLimitOptions,
  isRateLimitEnabled
} = require('../src/lib/authentication-rate-limit');

describe('authentication-rate-limit', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('isRateLimitEnabled', () => {
    it('is disabled in test NODE_ENV by default', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.AUTH_RATE_LIMIT_ENABLED;
      expect(isRateLimitEnabled()).toBe(false);
    });

    it('can be forced on in test', () => {
      process.env.NODE_ENV = 'test';
      process.env.AUTH_RATE_LIMIT_ENABLED = 'true';
      expect(isRateLimitEnabled()).toBe(true);
    });

    it('can be disabled explicitly', () => {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_RATE_LIMIT_ENABLED = 'false';
      expect(isRateLimitEnabled()).toBe(false);
    });
  });

  describe('resolveAuthenticationRateLimitOptions', () => {
    it('uses defaults when env is invalid', () => {
      process.env.AUTH_RATE_LIMIT_WINDOW_MS = 'nope';
      process.env.AUTH_RATE_LIMIT_MAX = '-1';
      expect(resolveAuthenticationRateLimitOptions()).toEqual({
        windowMs: 15 * 60 * 1000,
        max: 20
      });
    });

    it('reads env overrides', () => {
      process.env.AUTH_RATE_LIMIT_WINDOW_MS = '60000';
      process.env.AUTH_RATE_LIMIT_MAX = '5';
      expect(resolveAuthenticationRateLimitOptions()).toEqual({
        windowMs: 60000,
        max: 5
      });
    });
  });

  describe('createAuthenticationRateLimiter', () => {
    it('returns a no-op middleware when disabled', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.AUTH_RATE_LIMIT_ENABLED;
      const middleware = createAuthenticationRateLimiter();
      const next = jest.fn();
      middleware({}, {}, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
