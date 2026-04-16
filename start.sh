#!/bin/bash
set -e

# Set default values if environment variables are not set
DB_USER=${DB_USER:-admin}
DB_PASSWORD=${DB_PASSWORD}
DB_HOST=${DB_HOST:-localhost}
THREADS=${THREADS:-10}

# Create .env file for backend with current environment variables
echo "DB_USER=$DB_USER" > /root/net_port/source/web/backend_net_port/.env
echo "DB_PASSWORD=$DB_PASSWORD" >> /root/net_port/source/web/backend_net_port/.env
echo "DB_HOST=$DB_HOST" >> /root/net_port/source/web/backend_net_port/.env

# Update PostgreSQL configuration to allow remote connections
sed -i 's/#listen_addresses = '\''localhost'\''/listen_addresses = '\''*'\''/' /etc/postgresql/*/main/postgresql.conf
service postgresql restart

# Initialize database from SQL script
su - postgres -c "psql -f /var/lib/postgresql/init_db.sql"

# Create PostgreSQL user with password from environment
su - postgres -c "psql -c \"CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASSWORD';\""
su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE net_port TO $DB_USER;\""
su - postgres -c "psql -d net_port -c \"GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $DB_USER;\""
su - postgres -c "psql -d net_port -c \"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $DB_USER;\""

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
        ./module_net_port_server* --user 1 -v1 --cert server.crt --key server.key --threads $THREADS --username $DB_USER --password $DB_PASSWORD -p 5432 &
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