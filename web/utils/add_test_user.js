const knex = require('knex');
const bcrypt = require('bcryptjs');

// Подключение к базе данных
const dbConfig = {
  client: 'pg',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgre',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'net_port'
  }
};

const db = knex(dbConfig);

// Добавление тестового пользователя
async function addTestUser() {
  try {
    // Получаем пароль из переменной окружения APP_PASSWORD
    const plainPassword = process.env.APP_PASSWORD || '';
    if (!plainPassword) {
      console.warn('APP_PASSWORD environment variable is not set, using empty password');
    }
    // Хэшируем пароль
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(plainPassword, saltRounds);
    
    // Получаем логин из переменной окружения APP_USER (по умолчанию admin)
    const login = process.env.APP_USER || 'admin';
    
    // Добавляем пользователя в базу данных
    const newUser = {
      login: login,
      password: hashedPassword,
      email: process.env.APP_EMAIL || 'test@example.com',
      role_name: process.env.APP_ROLE || 'admin',
      username: process.env.APP_USERNAME || '',
      phone: process.env.APP_PHONE || ''
    };
    
    const result = await db.insert(newUser).into('users').returning(['id', 'login']);
    console.log('New user added:');
    console.log(result);
    console.log('Login:', newUser.login);
    console.log('Password:', plainPassword);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await db.destroy();
  }
}

addTestUser();