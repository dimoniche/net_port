'use strict';

/* eslint-disable no-console */
module.exports = function (app) {
  const db = app.get('db');

  return db;
};
