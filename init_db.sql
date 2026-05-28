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
    description TEXT,
    total_bytes_received BIGINT NOT NULL DEFAULT 0,
    total_bytes_sent BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT servers_input_port_range CHECK (input_port IS NULL OR (input_port >= 5000 AND input_port <= 5999)),
    CONSTRAINT servers_output_port_range CHECK (output_port IS NULL OR (output_port >= 5000 AND output_port <= 5999))
);

-- Default server disabled: ports 6000-7000 are reserved for dynamic device allocation
INSERT INTO servers (user_id, input_port, output_port, enable, enable_ssl, enable_input_ssl, description)
VALUES (1, 5998, 5999, false, false, false, 'Legacy placeholder (disabled)');

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
    phone VARCHAR(255),
    auto_connect_enabled BOOLEAN DEFAULT TRUE
);

