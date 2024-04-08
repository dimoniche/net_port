'use strict';

const knex = require('knex');

const { types } = require('pg');
const TIMESTAMPTZ_OID = 1184;
const TIMESTAMP_OID = 1114;
types.setTypeParser(TIMESTAMPTZ_OID, val => val);
types.setTypeParser(TIMESTAMP_OID, val => val);

module.exports = function (app) {
  const client = 'pg';
  const connection = 'postgresql://postgres:ghbdtnjvktnGHBDTNJVKTN@localhost:5432/net_port';
  const db = knex({client, connection});

  app.set('db', db);
};
