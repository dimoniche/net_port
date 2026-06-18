'use strict';

const jwt = require('jsonwebtoken');
const feathers = require('@feathersjs/feathers');
const {
  configureJwtSecrets,
  parseSecretList,
  resolveJwtSecrets,
  RotatingAuthenticationService,
  DEV_FALLBACK_SECRET,
} = require('../src/jwt-config');

describe('jwt-config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.JWT_SECRET;
    delete process.env.JWT_SECRET_PREVIOUS;
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('parseSecretList splits comma-separated values', () => {
    expect(parseSecretList('a,b, c')).toEqual(['a', 'b', 'c']);
    expect(parseSecretList('')).toEqual([]);
  });

  test('resolveJwtSecrets requires JWT_SECRET in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => resolveJwtSecrets()).toThrow(/JWT_SECRET environment variable is required/);
  });

  test('resolveJwtSecrets uses development fallback outside production', () => {
    const secrets = resolveJwtSecrets();
    expect(secrets.current).toBe(DEV_FALLBACK_SECRET);
    expect(secrets.verifySecrets).toEqual([DEV_FALLBACK_SECRET]);
  });

    test('configureJwtSecrets stores current secret in app config', () => {
    process.env.JWT_SECRET = 'current-secret-with-enough-length-for-tests';
    process.env.JWT_SECRET_PREVIOUS = 'old-secret-one, old-secret-two';
    const app = {
      config: {},
      get(key) {
        return this.config[key];
      },
      set(key, value) {
        this.config[key] = value;
      },
    };
    app.set('authentication', { jwtOptions: { algorithm: 'HS256' } });

    const result = configureJwtSecrets(app);
    expect(app.get('authentication').secret).toBe(process.env.JWT_SECRET);
    expect(result.verifySecrets).toEqual([
      process.env.JWT_SECRET,
      'old-secret-one',
      'old-secret-two',
    ]);
  });

  test('RotatingAuthenticationService verifies tokens signed with previous secret', async () => {
    const currentSecret = 'current-secret-with-enough-length-for-tests';
    const previousSecret = 'previous-secret-with-enough-length-for-tests';
    process.env.JWT_SECRET = currentSecret;
    process.env.JWT_SECRET_PREVIOUS = previousSecret;

    const app = feathers();
    app.set('authentication', {
      jwtOptions: {
        algorithm: 'HS256',
        expiresIn: '1h',
      },
    });

    const { verifySecrets, RotatingAuthenticationService: RotatingService } = configureJwtSecrets(app);
    const authentication = new RotatingService(app, verifySecrets);

    const oldToken = jwt.sign({ sub: '1' }, previousSecret, { algorithm: 'HS256' });
    const newToken = jwt.sign({ sub: '1' }, currentSecret, { algorithm: 'HS256' });

    await expect(authentication.verifyAccessToken(oldToken)).resolves.toMatchObject({ sub: '1' });
    await expect(authentication.verifyAccessToken(newToken)).resolves.toMatchObject({ sub: '1' });

    const signedWithUnknown = jwt.sign({ sub: '1' }, 'unknown-secret-with-enough-length-here', {
      algorithm: 'HS256',
    });
    await expect(authentication.verifyAccessToken(signedWithUnknown)).rejects.toThrow();
  });
});
