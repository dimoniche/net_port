'use strict';

const { Client } = require('pg');
const bcrypt = require('bcryptjs');

async function addTestUser() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'net_port'
  });

  try {
    await client.connect();

    const plainPassword = process.env.APP_PASSWORD || '';
    if (!plainPassword) {
      console.warn('APP_PASSWORD environment variable is not set, using empty password');
    }

    const login = process.env.APP_USER || 'admin';
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const existing = await client.query(
      'SELECT id, login FROM users WHERE login = $1 LIMIT 1',
      [login]
    );

    if (existing.rowCount > 0) {
      console.log(`User '${login}' already exists, skipping creation.`);
      return;
    }

    const result = await client.query(
      `INSERT INTO users (login, password, email, role_name, username, phone)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, login`,
      [
        login,
        hashedPassword,
        process.env.APP_EMAIL || 'test@example.com',
        process.env.APP_ROLE || 'admin',
        process.env.APP_USERNAME || '',
        process.env.APP_PHONE || ''
      ]
    );
    console.log('New user added:', result.rows);
    console.log('Login:', login);
  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

addTestUser();
