#!/bin/bash
set -e

# Startup script for net_port server without Docker
# Place this script in the server directory and run: ./start_server.sh

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
    print_warn "Running as root is not recommended. Consider running as a regular user."
fi

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$SCRIPT_DIR/build"
EXECUTABLE_PATTERN="module_net_port_server-*"
DB_USER="${DB_USER:-admin}"
DB_PASSWORD="${DB_PASSWORD:-lbvsx123}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
THREADS="${THREADS:-10}"
CERT_DIR="$PROJECT_ROOT/certs"
SERVER_CERT="$CERT_DIR/server.crt"
SERVER_KEY="$CERT_DIR/server.key"

# Create certificates directory
mkdir -p "$CERT_DIR"

# Function to check command availability
check_command() {
    if ! command -v "$1" &> /dev/null; then
        print_error "Command '$1' not found. Please install it."
        exit 1
    fi
}

# Check required commands
print_info "Checking dependencies..."
check_command "cmake"
check_command "make"
check_command "gcc"
check_command "psql"
check_command "openssl"
check_command "systemctl" || print_warn "systemctl not found (may not be systemd)"

# Check PostgreSQL status
print_info "Checking PostgreSQL..."
if systemctl is-active --quiet postgresql 2>/dev/null || pgrep postgres > /dev/null; then
    print_info "PostgreSQL is running"
else
    print_warn "PostgreSQL is not running. Attempting to start..."
    if command -v systemctl > /dev/null; then
        sudo systemctl start postgresql || {
            print_error "Failed to start PostgreSQL. Please start it manually."
            exit 1
        }
    else
        print_error "Cannot start PostgreSQL automatically. Please start it manually."
        exit 1
    fi
fi

# Wait for PostgreSQL to be ready
print_info "Waiting for PostgreSQL to be ready..."
for i in {1..30}; do
    if pg_isready -h "$DB_HOST" -p "$DB_PORT" > /dev/null 2>&1; then
        print_info "PostgreSQL is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        print_error "PostgreSQL not ready after 30 seconds"
        exit 1
    fi
    sleep 1
done

# Initialize database if needed
print_info "Checking database..."
if ! psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw net_port; then
    print_info "Database 'net_port' not found, initializing..."
    
    # Check for init_db.sql
    INIT_DB_SQL="$PROJECT_ROOT/init_db.sql"
    if [ ! -f "$INIT_DB_SQL" ]; then
        print_error "init_db.sql not found at $INIT_DB_SQL"
        exit 1
    fi
    
    # Create database
    psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "CREATE DATABASE net_port;" || {
        print_error "Failed to create database"
        exit 1
    }
    
    # Initialize schema
    psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -d net_port -f "$INIT_DB_SQL" || {
        print_error "Failed to initialize database schema"
        exit 1
    }
    
    # Create user
    psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASSWORD';" || {
        print_warn "User may already exist, continuing..."
    }
    
    # Grant privileges
    psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE net_port TO $DB_USER;"
    psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -d net_port -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $DB_USER;"
    psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -d net_port -c "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $DB_USER;"
    
    print_info "Database initialized successfully"
else
    print_info "Database 'net_port' already exists"
fi

# Generate SSL certificates if they don't exist
print_info "Checking SSL certificates..."
if [ ! -f "$SERVER_CERT" ] || [ ! -f "$SERVER_KEY" ]; then
    print_info "Generating SSL certificates..."
    openssl genrsa -out "$SERVER_KEY" 2048
    openssl req -new -x509 -key "$SERVER_KEY" -out "$SERVER_CERT" -days 3650 \
        -subj "/C=RU/ST=Moscow/L=Moscow/O=Net Port/CN=localhost"
    print_info "SSL certificates generated at $CERT_DIR"
else
    print_info "SSL certificates already exist"
fi

# Build server if not built
print_info "Checking server build..."
if [ ! -d "$BUILD_DIR" ] || [ ! -f "$BUILD_DIR/$EXECUTABLE_PATTERN" ]; then
    print_info "Building server..."
    mkdir -p "$BUILD_DIR"
    cd "$BUILD_DIR"
    cmake .. || {
        print_error "CMake configuration failed"
        exit 1
    }
    make -j$(nproc) || {
        print_error "Build failed"
        exit 1
    }
    print_info "Server built successfully"
else
    print_info "Server already built"
fi

# Find executable
EXECUTABLE=$(find "$BUILD_DIR" -name "$EXECUTABLE_PATTERN" -type f | head -n 1)
if [ -z "$EXECUTABLE" ]; then
    print_error "Server executable not found"
    exit 1
fi

print_info "Found executable: $(basename "$EXECUTABLE")"

# Start server
print_info "Starting net_port server..."
cd "$BUILD_DIR"
"$EXECUTABLE" --user 1 -v1 --cert "$SERVER_CERT" --key "$SERVER_KEY" \
    --threads "$THREADS" --username "$DB_USER" --password "$DB_PASSWORD" \
    -p "$DB_PORT" -h "$DB_HOST"

# If server exits
print_warn "Server stopped. Exit code: $?"