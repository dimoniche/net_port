export const API_BASE_URL = (process.env.NODE_ENV === 'development') ?
    'http://localhost:8080/api/v1' :
    '/api/v1';

export const API_TIMEOUT = 300000;
export const AUTH_STRATEGY = 'local';
export const VERSION = '0.0.1';