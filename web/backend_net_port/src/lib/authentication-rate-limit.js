'use strict';

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX = 20;

const buckets = new Map();

function parsePositiveInt(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseEnvFlag(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return null;
}

function isRateLimitEnabled() {
  const override = parseEnvFlag(process.env.AUTH_RATE_LIMIT_ENABLED);
  if (override === true) {
    return true;
  }
  if (override === false) {
    return false;
  }

  return process.env.NODE_ENV !== 'test';
}

function resolveAuthenticationRateLimitOptions() {
  return {
    windowMs: parsePositiveInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS),
    max: parsePositiveInt(process.env.AUTH_RATE_LIMIT_MAX, DEFAULT_MAX)
  };
}

function resolveClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0]).trim();
  }

  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function pruneBucket(bucket, now, windowMs) {
  bucket.hits = bucket.hits.filter((timestamp) => now - timestamp < windowMs);
}

function createAuthenticationRateLimiter(options = {}) {
  if (!isRateLimitEnabled()) {
    return function authenticationRateLimitDisabled(req, res, next) {
      next();
    };
  }

  const { windowMs, max } = {
    ...resolveAuthenticationRateLimitOptions(),
    ...options
  };

  return function authenticationRateLimit(req, res, next) {
    if (req.method !== 'POST') {
      return next();
    }

    const ip = resolveClientIp(req);
    const now = Date.now();
    let bucket = buckets.get(ip);
    if (!bucket) {
      bucket = { hits: [] };
      buckets.set(ip, bucket);
    }

    pruneBucket(bucket, now, windowMs);

    if (bucket.hits.length >= max) {
      return res.status(429).json({
        name: 'TooManyRequests',
        message: 'Too many login attempts. Please try again later.',
        code: 429
      });
    }

    bucket.hits.push(now);
    return next();
  };
}

module.exports = {
  createAuthenticationRateLimiter,
  resolveAuthenticationRateLimitOptions,
  isRateLimitEnabled
};
