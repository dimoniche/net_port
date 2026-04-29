#!/bin/bash
set -e

# Set default values if environment variables are not set
DB_USER=${DB_USER:-admin}
DB_PASSWORD=${DB_PASSWORD}
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
THREADS=${THREADS:-10}

# Determine if we are using local PostgreSQL (localhost or 127.0.0.1)
if [ "$DB_HOST" = "localhost" ] || [ "$DB_HOST" = "127.0.0.1" ]; then
    USE_LOCAL_DB=true
else
    USE_LOCAL_DB=false
fi

# Create .env file for backend with current environment variables
echo "DB_USER=$DB_USER" > /root/net_port/source/web/backend_net_port/.env
echo "DB_PASSWORD=$DB_PASSWORD" >> /root/net_port/source/web/backend_net_port/.env
echo "DB_HOST=$DB_HOST" >> /root/net_port/source/web/backend_net_port/.env
echo "DB_PORT=$DB_PORT" >> /root/net_port/source/web/backend_net_port/.env

# Only initialize and start local PostgreSQL if using local DB
if [ "$USE_LOCAL_DB" = "true" ]; then
    # Check if PostgreSQL data directory is initialized
    if [ ! -d /var/lib/postgresql/14/main ] || [ ! -f /var/lib/postgresql/14/main/PG_VERSION ]; then
        echo "PostgreSQL data directory not found, initializing..."
        # Ensure directory exists with proper permissions
        mkdir -p /var/lib/postgresql/14
        chown -R postgres:postgres /var/lib/postgresql/14
        # Initialize PostgreSQL database cluster
        su - postgres -c "/usr/lib/postgresql/14/bin/initdb -D /var/lib/postgresql/14/main --encoding=UTF8 --locale=C"
    fi

    # Update PostgreSQL configuration to allow remote connections
    sed -i 's/#listen_addresses = '\''localhost'\''/listen_addresses = '\''*'\''/' /etc/postgresql/*/main/postgresql.conf

    # Start PostgreSQL
    service postgresql start

    # Wait for PostgreSQL to be ready
    sleep 5

    # Check if database already exists
    if su - postgres -c "psql -lqt" 2>/dev/null | cut -d \| -f 1 | grep -qw net_port; then
        echo "Database 'net_port' already exists, skipping initialization."
    else
        echo "Database 'net_port' not found, initializing..."
        # Initialize database from SQL script
        su - postgres -c "psql -f /etc/postgresql/init_db.sql"
    fi

    # Check if user already exists
    if su - postgres -c "psql -c \"SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'\"" 2>/dev/null | grep -q 1; then
        echo "User '$DB_USER' already exists, skipping creation."
    else
        echo "Creating PostgreSQL user '$DB_USER'..."
        # Create PostgreSQL user with password from environment
        su - postgres -c "psql -c \"CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASSWORD';\""
    fi

    # Grant privileges (these are idempotent, safe to run multiple times)
    su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE net_port TO $DB_USER;\""
    su - postgres -c "psql -d net_port -c \"GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $DB_USER;\""
    su - postgres -c "psql -d net_port -c \"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $DB_USER;\""
else
    echo "Using external PostgreSQL at $DB_HOST:$DB_PORT, skipping local PostgreSQL initialization."
    # Wait a moment for external DB to be reachable (optional)
    sleep 2
fi

# Add admin user with hashed password from environment
cd /root/net_port/source/web/backend_net_port && bash -c "source $NVM_DIR/nvm.sh && NODE_PATH=/root/net_port/source/web/backend_net_port/node_modules node ../utils/add_test_user.js"

# Generate SSL certificates if they don't exist
if [ ! -f /root/net_port/server.crt ] || [ ! -f /root/net_port/server.key ]; then
    mkdir -p /root/net_port
    cd /root/net_port
    openssl genrsa -out server.key 2048
    openssl req -new -x509 -key server.key -out server.crt -days 3650 -subj "/C=RU/ST=Moscow/L=Moscow/O=Net Port/CN=localhost"
fi

service nginx start

# Trap signals for graceful shutdown
terminate() {
    echo "Received signal, terminating all child processes..."
    # Kill all child processes of this script
    pkill -P $$ 2>/dev/null
    exit 0
}
trap terminate SIGTERM SIGINT

# Function to start server with restart loop
start_server() {
    while true; do
        echo "Starting net_port server..."
        cd /root/net_port
        ./module_net_port_server* --user 1 -v1 --cert server.crt --key server.key --threads $THREADS --username $DB_USER --password $DB_PASSWORD --host $DB_HOST -p $DB_PORT &
        server_pid=$!
        wait $server_pid || true
        server_exit_code=$?
        echo "Server exited with code $server_exit_code. Restarting in 5 seconds..."
        sleep 5
    done
}

# Function to start Node.js backend with restart loop
start_backend() {
    while true; do
        echo "Starting Node.js backend..."
        cd /root/net_port/source/web/backend_net_port
        bash -c "source $NVM_DIR/nvm.sh && npm start" &
        backend_pid=$!
        wait $backend_pid || true
        backend_exit_code=$?
        echo "Backend exited with code $backend_exit_code. Restarting in 5 seconds..."
        sleep 5
    done
}

# Start server and backend in background
start_server &
server_supervisor_pid=$!
start_backend &
backend_supervisor_pid=$!

# Wait for supervisor processes (they should run forever)
wait $server_supervisor_pid $backend_supervisor_pid