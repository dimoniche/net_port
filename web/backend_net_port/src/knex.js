'use strict';

const knex = require('knex');

const { types } = require('pg');
const TIMESTAMPTZ_OID = 1184;
const TIMESTAMP_OID = 1114;
types.setTypeParser(TIMESTAMPTZ_OID, val => val);
types.setTypeParser(TIMESTAMP_OID, val => val);

module.exports = function (app) {
  const client = 'pg';
  const connection = {
    host: process.env.DB_HOST || 'localhost',
    port: 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'net_port'
  };
  const db = knex({client, connection});

  app.set('db', db);
};
