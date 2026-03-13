const knex = require('knex');
const bcrypt = require('bcryptjs');

// Подключение к базе данных
const db = knex({
  client: 'pg',
  connection: {
    host: 'localhost',
    port: 5432,
    user: 'postgre',
    password: '',
    database: 'net_port'
  }
});

// Добавление тестового пользователя
async function addTestUser() {
  try {
    // Хэшируем пароль
    const saltRounds = 10;
    const plainPassword = '';
    const hashedPassword = await bcrypt.hash(plainPassword, saltRounds);
    
    // Добавляем пользователя в базу данных
    const newUser = {
      login: 'admin',
      password: hashedPassword,
      email: 'test@example.com',
      role: 'admin'
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