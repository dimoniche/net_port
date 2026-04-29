CREATE DATABASE net_port;

\c net_port

CREATE TABLE role (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT
);

-- Insert default admin role
INSERT INTO role (id, name, description) VALUES (1, 'admin', '');

CREATE TABLE servers (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    input_port INTEGER,
    output_port INTEGER,
    enable BOOLEAN,
    enable_ssl BOOLEAN,
    enable_input_ssl BOOLEAN,
    description TEXT
);

-- Insert default server for user 1
INSERT INTO servers (user_id, input_port, output_port, enable, enable_ssl, enable_input_ssl, description)
VALUES (1, 6000, 6001, true, false, false, 'Default server');

CREATE TABLE statistic (
    id SERIAL PRIMARY KEY,
    server_id INTEGER,
    bytes_received BIGINT DEFAULT 0,
    bytes_sent BIGINT DEFAULT 0,
    connections_count INTEGER DEFAULT 0,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    login VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    role_name VARCHAR(255),
    username VARCHAR(255),
    phone VARCHAR(255)
);

