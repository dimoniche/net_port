CREATE DATABASE net_port;

\c net_port

CREATE TABLE role (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT
);

CREATE TABLE servers (
    user_id INTEGER,
    input_port INTEGER,
    output_port INTEGER,
    enable BOOLEAN,
    enable_ssl BOOLEAN
);

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    login VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    role_name VARCHAR(255),
);
