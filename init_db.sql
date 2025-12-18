CREATE DATABASE net_port;

\c net_port

CREATE TABLE servers (
    user_id INTEGER,
    input_port INTEGER,
    output_port INTEGER,
    enable BOOLEAN,
    enable_ssl BOOLEAN
);

ALTER USER postgres WITH PASSWORD 'ghbdtnjvktn';
