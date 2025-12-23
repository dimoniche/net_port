const jwt = require('jsonwebtoken');

// Данные для токена
const payload = {
  username: 'admin',
  password: 'admin'
};

// Секретный ключ
const secret = '0iJT0OrL0E9yVJwv1q+hQb/ziUc=';

// Опции для токена
const options = {
  expiresIn: '1h' // Срок действия токена - 1 час
};

// Генерация токена
const token = jwt.sign(payload, secret, options);

console.log('Сгенерированный JWT токен:');
console.log(token);