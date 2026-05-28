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

    # Device management schema (tables, functions, port pool 6000-7000)
    if ! su - postgres -c "psql -d net_port -tAc \"SELECT 1 FROM information_schema.tables WHERE table_name='devices'\"" 2>/dev/null | grep -q 1; then
        echo "Running init_device_db.sql..."
        su - postgres -c "psql -d net_port -f /etc/postgresql/init_device_db.sql" || echo "Warning: init_device_db.sql failed"
        su - postgres -c "psql -d net_port -c \"GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $DB_USER;\""
        su - postgres -c "psql -d net_port -c \"GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO $DB_USER;\""
    else
        echo "Device tables already exist, skipping init_device_db.sql."
    fi

    # Legacy rows in device port range — disable and move to placeholder ports
    su - postgres -c "psql -d net_port -c \"UPDATE servers SET input_port=5998, output_port=5999, enable=false WHERE input_port BETWEEN 6000 AND 7000 OR output_port BETWEEN 6000 AND 7000;\"" 2>/dev/null || true
else
    echo "Using external PostgreSQL at $DB_HOST:$DB_PORT, initializing database if needed."
    
    # Wait for external PostgreSQL to be reachable
    echo "Waiting for PostgreSQL to be reachable at $DB_HOST:$DB_PORT..."
    for i in {1..30}; do
        if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
            echo "PostgreSQL is reachable."
            break
        fi
        if [ $i -eq 30 ]; then
            echo "Warning: Could not connect to PostgreSQL after 30 attempts. Database initialization may fail."
        fi
        sleep 2
    done
    
    # Check if net_port database exists
    if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "SELECT 1 FROM pg_database WHERE datname='net_port';" 2>/dev/null | grep -q 1; then
        echo "Database 'net_port' already exists."
    else
        echo "Database 'net_port' not found, attempting to create..."
        # Try to create database (requires CREATEDB privilege)
        if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "CREATE DATABASE net_port;" 2>/dev/null; then
            echo "Database 'net_port' created successfully."
        else
            echo "Warning: Could not create database 'net_port'. It may already exist or user lacks privileges."
            echo "Assuming database exists or will be created manually."
        fi
    fi
    
    # Initialize database schema if database exists
    if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -c "SELECT 1;" >/dev/null 2>&1; then
        echo "Initializing database schema..."
        
        # Check if main tables already exist
        if ! PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -c "SELECT 1 FROM information_schema.tables WHERE table_name='users';" 2>/dev/null | grep -q 1; then
            echo "Running init_db.sql (schema only)..."
            sed -e '/^CREATE DATABASE/d' -e '/^\\c/d' /etc/postgresql/init_db.sql | \
                PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -v ON_ERROR_STOP=1 \
                || echo "Warning: Failed to run init_db.sql"
        else
            echo "Main tables already exist, skipping init_db.sql."
        fi
        
        # Check if device tables already exist
        if ! PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -c "SELECT 1 FROM information_schema.tables WHERE table_name='devices';" 2>/dev/null | grep -q 1; then
            echo "Running init_device_db.sql..."
            # Try multiple possible locations for init_device_db.sql
            if [ -f /etc/postgresql/init_device_db.sql ]; then
                sed -e '/^\\c/d' /etc/postgresql/init_device_db.sql | \
                    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -v ON_ERROR_STOP=1 \
                    || echo "Warning: Failed to run init_device_db.sql"
            elif [ -f /root/net_port/source/init_device_db.sql ]; then
                sed -e '/^\\c/d' /root/net_port/source/init_device_db.sql | \
                    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -v ON_ERROR_STOP=1 \
                    || echo "Warning: Failed to run init_device_db.sql"
            else
                echo "Warning: init_device_db.sql not found. Device tables may not be created."
            fi
        else
            echo "Device tables already exist, skipping init_device_db.sql."
        fi

        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port \
            -c "UPDATE servers SET input_port=5998, output_port=5999, enable=false WHERE input_port BETWEEN 6000 AND 7000 OR output_port BETWEEN 6000 AND 7000;" 2>/dev/null || true

        # Ensure user has privileges
        echo "Ensuring user '$DB_USER' has proper privileges..."
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $DB_USER;" 2>/dev/null || true
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -c "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $DB_USER;" 2>/dev/null || true
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -c "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO $DB_USER;" 2>/dev/null || true
    else
        echo "Warning: Cannot connect to database 'net_port'. Schema initialization skipped."
    fi
    
    echo "External PostgreSQL initialization completed."
fi

apply_port_release_fix() {
    local fix=""
    if [ -f /etc/postgresql/port_release_fix.sql ]; then
        fix="/etc/postgresql/port_release_fix.sql"
    elif [ -f /root/net_port/source/sql/port_release_fix.sql ]; then
        fix="/root/net_port/source/sql/port_release_fix.sql"
    else
        return 0
    fi
    echo "Applying port release migration..."
    if [ "$USE_LOCAL_DB" = "true" ]; then
        su - postgres -c "psql -d net_port -f $fix" 2>/dev/null || true
    elif PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -c "SELECT 1;" >/dev/null 2>&1; then
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -f "$fix" 2>/dev/null || true
    fi
}
apply_port_release_fix

apply_server_port_separation() {
    local fix=""
    if [ -f /etc/postgresql/server_port_separation.sql ]; then
        fix="/etc/postgresql/server_port_separation.sql"
    elif [ -f /root/net_port/source/sql/server_port_separation.sql ]; then
        fix="/root/net_port/source/sql/server_port_separation.sql"
    else
        return 0
    fi
    echo "Applying server/device port separation migration..."
    if [ "$USE_LOCAL_DB" = "true" ]; then
        su - postgres -c "psql -d net_port -f $fix" 2>/dev/null || true
    elif PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -c "SELECT 1;" >/dev/null 2>&1; then
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -f "$fix" 2>/dev/null || true
    fi
}
apply_server_port_separation

apply_internal_port_range_fix() {
    local fix=""
    if [ -f /etc/postgresql/internal_port_range_fix.sql ]; then
        fix="/etc/postgresql/internal_port_range_fix.sql"
    elif [ -f /root/net_port/source/sql/internal_port_range_fix.sql ]; then
        fix="/root/net_port/source/sql/internal_port_range_fix.sql"
    else
        return 0
    fi
    echo "Applying internal_port range migration..."
    if [ "$USE_LOCAL_DB" = "true" ]; then
        su - postgres -c "psql -d net_port -f $fix" 2>/dev/null || true
    elif PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -c "SELECT 1;" >/dev/null 2>&1; then
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -f "$fix" 2>/dev/null || true
    fi
}
apply_internal_port_range_fix

apply_device_traffic_samples() {
    local fix=""
    if [ -f /etc/postgresql/device_traffic_samples.sql ]; then
        fix="/etc/postgresql/device_traffic_samples.sql"
    elif [ -f /root/net_port/source/sql/device_traffic_samples.sql ]; then
        fix="/root/net_port/source/sql/device_traffic_samples.sql"
    else
        return 0
    fi
    echo "Applying device traffic samples migration..."
    if [ "$USE_LOCAL_DB" = "true" ]; then
        su - postgres -c "psql -d net_port -f $fix" 2>/dev/null || true
    elif PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -c "SELECT 1;" >/dev/null 2>&1; then
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -f "$fix" 2>/dev/null || true
    fi
}
apply_device_traffic_samples

apply_device_preferred_port() {
    local fix=""
    if [ -f /etc/postgresql/device_preferred_port.sql ]; then
        fix="/etc/postgresql/device_preferred_port.sql"
    elif [ -f /root/net_port/source/sql/device_preferred_port.sql ]; then
        fix="/root/net_port/source/sql/device_preferred_port.sql"
    else
        return 0
    fi
    echo "Applying device preferred port migration..."
    if [ "$USE_LOCAL_DB" = "true" ]; then
        su - postgres -c "psql -d net_port -f $fix" 2>/dev/null || true
    elif PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -c "SELECT 1;" >/dev/null 2>&1; then
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -f "$fix" 2>/dev/null || true
    fi
}
apply_device_preferred_port

apply_user_auto_connect() {
    local fix=""
    if [ -f /etc/postgresql/user_auto_connect.sql ]; then
        fix="/etc/postgresql/user_auto_connect.sql"
    elif [ -f /root/net_port/source/sql/user_auto_connect.sql ]; then
        fix="/root/net_port/source/sql/user_auto_connect.sql"
    else
        return 0
    fi
    echo "Applying user auto-connect migration..."
    if [ "$USE_LOCAL_DB" = "true" ]; then
        su - postgres -c "psql -d net_port -f $fix" 2>/dev/null || true
    elif PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -c "SELECT 1;" >/dev/null 2>&1; then
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -f "$fix" 2>/dev/null || true
    fi
}
apply_user_auto_connect

apply_device_delete_notify() {
    local fix=""
    if [ -f /etc/postgresql/device_delete_notify.sql ]; then
        fix="/etc/postgresql/device_delete_notify.sql"
    elif [ -f /root/net_port/source/sql/device_delete_notify.sql ]; then
        fix="/root/net_port/source/sql/device_delete_notify.sql"
    else
        return 0
    fi
    echo "Applying device delete notify migration..."
    if [ "$USE_LOCAL_DB" = "true" ]; then
        su - postgres -c "psql -d net_port -f $fix" 2>/dev/null || true
    elif PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -c "SELECT 1;" >/dev/null 2>&1; then
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -f "$fix" 2>/dev/null || true
    fi
}
apply_device_delete_notify

apply_statistic_empty_snapshot_cleanup() {
    local fix=""
    if [ -f /etc/postgresql/statistic_empty_snapshot_cleanup.sql ]; then
        fix="/etc/postgresql/statistic_empty_snapshot_cleanup.sql"
    elif [ -f /root/net_port/source/sql/statistic_empty_snapshot_cleanup.sql ]; then
        fix="/root/net_port/source/sql/statistic_empty_snapshot_cleanup.sql"
    else
        return 0
    fi
    echo "Cleaning duplicate empty statistic snapshots..."
    if [ "$USE_LOCAL_DB" = "true" ]; then
        su - postgres -c "psql -d net_port -f $fix" 2>/dev/null || true
    elif PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -c "SELECT 1;" >/dev/null 2>&1; then
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -f "$fix" 2>/dev/null || true
    fi
}
apply_statistic_empty_snapshot_cleanup

apply_cumulative_statistics_totals() {
    local fix=""
    if [ -f /etc/postgresql/cumulative_statistics_totals.sql ]; then
        fix="/etc/postgresql/cumulative_statistics_totals.sql"
    elif [ -f /root/net_port/source/sql/cumulative_statistics_totals.sql ]; then
        fix="/root/net_port/source/sql/cumulative_statistics_totals.sql"
    else
        return 0
    fi
    echo "Applying cumulative statistics totals migration..."
    if [ "$USE_LOCAL_DB" = "true" ]; then
        su - postgres -c "psql -d net_port -f $fix" 2>/dev/null || true
    elif PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -c "SELECT 1;" >/dev/null 2>&1; then
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -f "$fix" 2>/dev/null || true
    fi
}
apply_cumulative_statistics_totals

apply_app_grants() {
    echo "Granting application privileges to '$DB_USER'..."
    if [ "$USE_LOCAL_DB" = "true" ]; then
        su - postgres -c "psql -d net_port -v ON_ERROR_STOP=1 -c \"
            GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO \\\"$DB_USER\\\";
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO \\\"$DB_USER\\\";
            GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO \\\"$DB_USER\\\";
        \"" 2>/dev/null || true
    elif PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -c "SELECT 1;" >/dev/null 2>&1; then
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d net_port -v ON_ERROR_STOP=0 -c "
            GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO \"$DB_USER\";
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO \"$DB_USER\";
            GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO \"$DB_USER\";
        " 2>/dev/null || true
        if [ -n "${DB_SUPERUSER:-}" ] && [ -n "${DB_SUPERUSER_PASSWORD:-}" ]; then
            PGPASSWORD="$DB_SUPERUSER_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_SUPERUSER" -d net_port -v ON_ERROR_STOP=0 -c "
                GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO \"$DB_USER\";
                GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO \"$DB_USER\";
                GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO \"$DB_USER\";
            " 2>/dev/null || true
        fi
    fi
}
apply_app_grants

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
resolve_server_binary() {
    if [ -n "${NET_PORT_SERVER_BIN:-}" ] && [ -x "${NET_PORT_SERVER_BIN}" ]; then
        echo "${NET_PORT_SERVER_BIN}"
        return 0
    fi

    cd /root/net_port
    if [ -x ./module_net_port_server-0.0.4 ]; then
        echo ./module_net_port_server-0.0.4
    elif [ -x ./module_net_port_server ]; then
        echo ./module_net_port_server
    else
        echo "ERROR: net_port server binary not found in /root/net_port" >&2
        return 1
    fi
}

start_server() {
    while true; do
        echo "Starting net_port server..."
        cd /root/net_port
        SERVER_BIN="$(resolve_server_binary)" || exit 1
        echo "Using server binary: ${SERVER_BIN}"
        "${SERVER_BIN}" --user 1 -v7 --cert server.crt --key server.key --threads $THREADS --username $DB_USER --password $DB_PASSWORD --host $DB_HOST -p $DB_PORT --enable-device-management --device-control-port 8443 &
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