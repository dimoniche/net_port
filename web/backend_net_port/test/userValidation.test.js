'use strict';

const { assertLoginAvailable } = require('../src/services/users/userValidation');

describe('userValidation', () => {
  test('assertLoginAvailable rejects empty login', async () => {
    const knex = () => ({ where: () => ({ first: async () => null }) });
    await expect(assertLoginAvailable(knex(), '   ')).rejects.toThrow(/Login is required/);
  });

  test('assertLoginAvailable rejects duplicate login', async () => {
    const knex = () => ({
      where: () => ({
        first: async () => ({ id: 2 }),
      }),
    });

    await expect(assertLoginAvailable(knex, 'admin')).rejects.toThrow(/already exists/);
  });

  test('assertLoginAvailable trims login', async () => {
    const knex = () => ({
      where: () => ({
        first: async () => null,
      }),
    });

    await expect(assertLoginAvailable(knex, '  alice  ')).resolves.toBe('alice');
  });
});
