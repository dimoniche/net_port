'use strict';

const crypto = require('crypto');
const { AuthenticationService } = require('@feathersjs/authentication');

const DEV_FALLBACK_SECRET = 'dev-only-jwt-secret-do-not-use-in-production';

function parseSecretList(value) {
  if (!value || typeof value !== 'string') {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveJwtSecrets() {
  const current = (process.env.JWT_SECRET || '').trim();
  const previous = parseSecretList(process.env.JWT_SECRET_PREVIOUS);
  const isProduction = process.env.NODE_ENV === 'production';

  if (current) {
    return {
      current,
      verifySecrets: [current, ...previous.filter((secret) => secret !== current)],
    };
  }

  if (isProduction) {
    throw new Error(
      'JWT_SECRET environment variable is required when NODE_ENV=production'
    );
  }

  console.warn(
    '[jwt-config] JWT_SECRET is not set; using development fallback secret. '
      + 'Set JWT_SECRET for this environment.'
  );

  return {
    current: DEV_FALLBACK_SECRET,
    verifySecrets: [DEV_FALLBACK_SECRET],
  };
}

class RotatingAuthenticationService extends AuthenticationService {
  constructor(app, verifySecrets) {
    super(app);
    this.verifySecrets = verifySecrets;
  }

  async verifyAccessToken(accessToken, optsOverride, secretOverride) {
    if (secretOverride) {
      return super.verifyAccessToken(accessToken, optsOverride, secretOverride);
    }

    const secrets = this.verifySecrets.length
      ? this.verifySecrets
      : [this.configuration.secret];

    let lastError;
    for (const secret of secrets) {
      try {
        return await super.verifyAccessToken(accessToken, optsOverride, secret);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  }
}

function configureJwtSecrets(app) {
  const { current, verifySecrets } = resolveJwtSecrets();

  if (current.length < 32) {
    console.warn(
      '[jwt-config] JWT_SECRET is shorter than 32 characters; '
        + 'use at least 32 bytes for production deployments.'
    );
  }

  const authConfig = app.get('authentication') || {};
  app.set('authentication', {
    ...authConfig,
    secret: current,
  });

  if (process.env.JWT_SECRET_PREVIOUS) {
    console.log(
      `[jwt-config] JWT verification accepts ${verifySecrets.length} secret(s) `
        + '(current + previous for rotation).'
    );
  }

  return {
    current,
    verifySecrets,
    RotatingAuthenticationService,
  };
}

function generateJwtSecret() {
  return crypto.randomBytes(32).toString('base64');
}

module.exports = {
  configureJwtSecrets,
  generateJwtSecret,
  parseSecretList,
  resolveJwtSecrets,
  RotatingAuthenticationService,
  DEV_FALLBACK_SECRET,
};
