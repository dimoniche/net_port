'use strict';

const { Conflict, BadRequest } = require('@feathersjs/errors');

async function assertLoginAvailable(knex, login, excludeUserId = null) {
  const normalized = (login || '').trim();
  if (!normalized) {
    throw new BadRequest('Login is required');
  }

  let query = knex('users').where({ login: normalized });
  if (excludeUserId != null) {
    query = query.whereNot('id', excludeUserId);
  }

  const existing = await query.first('id');
  if (existing) {
    throw new Conflict(`User with login '${normalized}' already exists`);
  }

  return normalized;
}

module.exports = {
  assertLoginAvailable,
};
