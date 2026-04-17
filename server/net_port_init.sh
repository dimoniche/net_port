#!/bin/bash
### BEGIN INIT INFO
# Provides:          net_port
# Required-Start:    $network $local_fs $remote_fs postgresql
# Required-Stop:     $network $local_fs $remote_fs postgresql
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: Net Port Server
# Description:       Net Port proxy server with PostgreSQL backend
### END INIT INFO

# Author: Net Port Team
# License: MIT

# Configuration
NAME="net_port"
DESC="Net Port Server"
USER="netport"
GROUP="netport"
INSTALL_DIR="/opt/net_port"
SERVER_DIR="$INSTALL_DIR/server"
BUILD_DIR="$SERVER_DIR/build"
CERT_DIR="$INSTALL_DIR/certs"
PIDFILE="/var/run/$NAME.pid"
LOGFILE="/var/log/$NAME.log"

# Environment variables
export DB_USER="${DB_USER:-admin}"
export DB_PASSWORD="${DB_PASSWORD:-lbvsx123}"
export DB_HOST="${DB_HOST:-localhost}"
export DB_PORT="${DB_PORT:-5432}"
export THREADS="${THREADS:-10}"

# Find server executable
find_executable() {
    # Look for the server executable in build directory
    EXECUTABLE=$(find "$BUILD_DIR" -name "module_net_port_server-*" -type f 2>/dev/null | head -n 1)
    if [ -z "$EXECUTABLE" ]; then
        # Try to build it
        echo "Server executable not found, attempting to build..."
        build_server
        EXECUTABLE=$(find "$BUILD_DIR" -name "module_net_port_server-*" -type f 2>/dev/null | head -n 1)
    fi
    echo "$EXECUTABLE"
}

# Build server
build_server() {
    if [ ! -d "$BUILD_DIR" ]; then
        mkdir -p "$BUILD_DIR"
    fi
    cd "$BUILD_DIR" || return 1
    cmake .. >/dev/null 2>&1 && make -j$(nproc) >/dev/null 2>&1
    return $?
}

# Generate SSL certificates
generate_certificates() {
    if [ ! -d "$CERT_DIR" ]; then
        mkdir -p "$CERT_DIR"
        chown "$USER:$GROUP" "$CERT_DIR"
    fi
    
    if [ ! -f "$CERT_DIR/server.crt" ] || [ ! -f "$CERT_DIR/server.key" ]; then
        openssl genrsa -out "$CERT_DIR/server.key" 2048 2>/dev/null
        openssl req -new -x509 -key "$CERT_DIR/server.key" -out "$CERT_DIR/server.crt" \
            -days 3650 -subj "/C=RU/ST=Moscow/L=Moscow/O=Net Port/CN=localhost" 2>/dev/null
        chown "$USER:$GROUP" "$CERT_DIR/server.crt" "$CERT_DIR/server.key"
    fi
}

# Check PostgreSQL is running
check_postgresql() {
    if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" >/dev/null 2>&1; then
        echo "PostgreSQL is not running on $DB_HOST:$DB_PORT"
        return 1
    fi
    return 0
}

# Start the service
start() {
    echo -n "Starting $DESC: "
    
    # Check if already running
    if [ -f "$PIDFILE" ]; then
        PID=$(cat "$PIDFILE")
        if kill -0 "$PID" 2>/dev/null; then
            echo "$NAME is already running (pid $PID)"
            return 0
        else
            # Remove stale PID file
            rm -f "$PIDFILE"
        fi
    fi
    
    # Check PostgreSQL
    if ! check_postgresql; then
        echo "failed (PostgreSQL not available)"
        return 1
    fi
    
    # Generate certificates
    generate_certificates
    
    # Find or build executable
    EXECUTABLE=$(find_executable)
    if [ -z "$EXECUTABLE" ] || [ ! -x "$EXECUTABLE" ]; then
        echo "failed (server executable not found)"
        return 1
    fi
    
    # Create directories and set permissions
    mkdir -p "$(dirname "$PIDFILE")" "$(dirname "$LOGFILE")"
    chown "$USER:$GROUP" "$(dirname "$PIDFILE")" "$(dirname "$LOGFILE")" 2>/dev/null || true
    
    # Start server
    cd "$BUILD_DIR" || return 1
    su -s /bin/bash -c "exec $EXECUTABLE --user 1 -v1 --cert $CERT_DIR/server.crt --key $CERT_DIR/server.key --threads $THREADS --username $DB_USER --password $DB_PASSWORD -p $DB_PORT >> $LOGFILE 2>&1 & echo \$!" "$USER" > "$PIDFILE"
    
    # Check if started successfully
    sleep 2
    if [ -f "$PIDFILE" ] && kill -0 $(cat "$PIDFILE") 2>/dev/null; then
        echo "$NAME started with pid $(cat "$PIDFILE")"
        return 0
    else
        echo "failed"
        rm -f "$PIDFILE"
        return 1
    fi
}

# Stop the service
stop() {
    echo -n "Stopping $DESC: "
    
    if [ ! -f "$PIDFILE" ]; then
        echo "not running"
        return 0
    fi
    
    PID=$(cat "$PIDFILE")
    if kill -0 "$PID" 2>/dev/null; then
        kill "$PID" 2>/dev/null
        sleep 2
        if kill -0 "$PID" 2>/dev/null; then
            kill -9 "$PID" 2>/dev/null
            sleep 1
        fi
        echo "stopped"
        rm -f "$PIDFILE"
        return 0
    else
        echo "not running (stale pid file)"
        rm -f "$PIDFILE"
        return 0
    fi
}

# Restart the service
restart() {
    stop
    sleep 2
    start
}

# Check service status
status() {
    if [ -f "$PIDFILE" ]; then
        PID=$(cat "$PIDFILE")
        if kill -0 "$PID" 2>/dev/null; then
            echo "$DESC is running (pid $PID)"
            return 0
        else
            echo "$DESC is not running (stale pid $PID)"
            return 1
        fi
    else
        echo "$DESC is not running"
        return 3
    fi
}

# Reload configuration (not supported, restart instead)
reload() {
    echo "Reloading $DESC configuration..."
    restart
}

# Case statement for init actions
case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    reload)
        reload
        ;;
    status)
        status
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|reload|status}"
        exit 1
        ;;
esac

exit $?