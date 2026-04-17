#!/bin/bash
# Installation script for Net Port Server service
# Run as root: sudo ./install_service.sh

set -e

# Colors
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
if [ "$EUID" -ne 0 ]; then 
    print_error "Please run as root (use sudo)"
    exit 1
fi

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SERVICE_NAME="net_port"
SERVICE_USER="netport"
SERVICE_GROUP="netport"
INSTALL_DIR="/opt/net_port"
INIT_SCRIPT="/etc/init.d/$SERVICE_NAME"
SYSTEMD_SERVICE="/etc/systemd/system/$SERVICE_NAME.service"

# Check if init system is available
if [ -d /etc/init.d ]; then
    INIT_SYSTEM="sysv"
elif command -v systemctl > /dev/null 2>&1; then
    INIT_SYSTEM="systemd"
else
    INIT_SYSTEM="unknown"
fi

print_info "Detected init system: $INIT_SYSTEM"

# Function to check command availability
check_command() {
    if ! command -v "$1" &> /dev/null; then
        print_error "Command '$1' not found. Please install it."
        exit 1
    fi
}

# Check required commands
print_info "Checking dependencies..."
check_command "useradd"
check_command "groupadd"
check_command "openssl"
check_command "cmake"
check_command "make"
check_command "gcc"
check_command "psql"

# Create service user and group
print_info "Creating service user and group..."
if ! getent group "$SERVICE_GROUP" > /dev/null; then
    groupadd "$SERVICE_GROUP"
    print_info "Created group: $SERVICE_GROUP"
else
    print_info "Group $SERVICE_GROUP already exists"
fi

if ! id "$SERVICE_USER" > /dev/null 2>&1; then
    useradd -r -s /bin/bash -g "$SERVICE_GROUP" "$SERVICE_USER"
    print_info "Created user: $SERVICE_USER"
else
    print_info "User $SERVICE_USER already exists"
fi

# Create installation directory
print_info "Creating installation directory..."
mkdir -p "$INSTALL_DIR"
cp -r "$PROJECT_ROOT/server" "$INSTALL_DIR/"
cp -r "$PROJECT_ROOT/web" "$INSTALL_DIR/" 2>/dev/null || true
cp "$PROJECT_ROOT/init_db.sql" "$INSTALL_DIR/" 2>/dev/null || true
cp "$PROJECT_ROOT/nginx.conf" "$INSTALL_DIR/" 2>/dev/null || true

# Set permissions
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
chmod 755 "$INSTALL_DIR"

# Create necessary directories
print_info "Creating service directories..."
mkdir -p /var/log/net_port
mkdir -p /var/run/net_port
mkdir -p "$INSTALL_DIR/certs"
chown -R "$SERVICE_USER:$SERVICE_GROUP" /var/log/net_port /var/run/net_port "$INSTALL_DIR/certs"

# Install init script based on init system
case "$INIT_SYSTEM" in
    "sysv")
        print_info "Installing SysV init script..."
        cp "$SCRIPT_DIR/net_port_init.sh" "$INIT_SCRIPT"
        chmod 755 "$INIT_SCRIPT"
        chown root:root "$INIT_SCRIPT"
        
        # Install LSB headers if needed
        if [ -x /usr/lib/lsb/install_initd ]; then
            /usr/lib/lsb/install_initd "$INIT_SCRIPT"
        fi
        
        # Enable service at boot
        if command -v update-rc.d > /dev/null 2>&1; then
            update-rc.d "$SERVICE_NAME" defaults
        elif command -v chkconfig > /dev/null 2>&1; then
            chkconfig --add "$SERVICE_NAME"
        fi
        
        print_info "SysV init script installed to $INIT_SCRIPT"
        ;;
    "systemd")
        print_info "Installing systemd service..."
        cat > "$SYSTEMD_SERVICE" << EOF
[Unit]
Description=Net Port Server
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$INSTALL_DIR/server
Environment="DB_USER=admin"
Environment="DB_PASSWORD=lbvsx123"
Environment="DB_HOST=localhost"
Environment="DB_PORT=5432"
Environment="THREADS=10"
ExecStart=$INSTALL_DIR/server/start_server.sh
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=net_port

[Install]
WantedBy=multi-user.target
EOF
        
        chmod 644 "$SYSTEMD_SERVICE"
        systemctl daemon-reload
        systemctl enable "$SERVICE_NAME"
        print_info "systemd service installed to $SYSTEMD_SERVICE"
        ;;
    *)
        print_warn "Unknown init system. Manual installation required."
        print_info "Init script is at: $SCRIPT_DIR/net_port_init.sh"
        print_info "Please install it manually to your init system."
        ;;
esac

# Create environment file
print_info "Creating environment configuration..."
cat > /etc/default/net_port << EOF
# Net Port Server environment variables
# Uncomment and modify as needed

# DB_USER="admin"
# DB_PASSWORD="lbvsx123"
# DB_HOST="localhost"
# DB_PORT="5432"
# THREADS="10"
EOF

chmod 644 /etc/default/net_port

# Initialize database
print_info "Checking PostgreSQL database..."
if systemctl is-active --quiet postgresql 2>/dev/null || pgrep postgres > /dev/null; then
    print_info "PostgreSQL is running"
    
    # Check if database exists
    if ! psql -h localhost -p 5432 -U postgres -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw net_port; then
        print_info "Initializing database..."
        
        if [ -f "$INSTALL_DIR/init_db.sql" ]; then
            psql -h localhost -p 5432 -U postgres -c "CREATE DATABASE net_port;" 2>/dev/null || true
            psql -h localhost -p 5432 -U postgres -d net_port -f "$INSTALL_DIR/init_db.sql" 2>/dev/null || true
            psql -h localhost -p 5432 -U postgres -c "CREATE ROLE admin WITH LOGIN PASSWORD 'lbvsx123';" 2>/dev/null || true
            psql -h localhost -p 5432 -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE net_port TO admin;" 2>/dev/null || true
            print_info "Database initialized"
        else
            print_warn "init_db.sql not found, database not initialized"
        fi
    else
        print_info "Database 'net_port' already exists"
    fi
else
    print_warn "PostgreSQL is not running. Database initialization skipped."
fi

# Build server
print_info "Building server..."
cd "$INSTALL_DIR/server"
if [ ! -d build ]; then
    mkdir build
fi
cd build
cmake .. > /dev/null 2>&1 || print_warn "CMake configuration had warnings"
make -j$(nproc) > /dev/null 2>&1 || {
    print_error "Build failed. Please check dependencies."
    exit 1
}
print_info "Server built successfully"

print_info ""
print_info "================================================"
print_info "Installation completed successfully!"
print_info "================================================"
print_info ""
print_info "Service configuration:"
print_info "  - Service user: $SERVICE_USER"
print_info "  - Installation directory: $INSTALL_DIR"
print_info "  - Log directory: /var/log/net_port"
print_info "  - PID directory: /var/run/net_port"
print_info "  - Certificates: $INSTALL_DIR/certs"
print_info ""
print_info "Environment configuration: /etc/default/net_port"
print_info ""
print_info "To start the service:"

case "$INIT_SYSTEM" in
    "sysv")
        print_info "  $INIT_SCRIPT start"
        print_info "  or: service $SERVICE_NAME start"
        ;;
    "systemd")
        print_info "  systemctl start $SERVICE_NAME"
        ;;
    *)
        print_info "  Manual start required"
        ;;
esac

print_info ""
print_info "To check service status:"
case "$INIT_SYSTEM" in
    "sysv")
        print_info "  $INIT_SCRIPT status"
        print_info "  or: service $SERVICE_NAME status"
        ;;
    "systemd")
        print_info "  systemctl status $SERVICE_NAME"
        ;;
esac

print_info ""
print_info "To enable automatic startup at boot:"
case "$INIT_SYSTEM" in
    "sysv")
        print_info "  update-rc.d $SERVICE_NAME defaults"
        ;;
    "systemd")
        print_info "  systemctl enable $SERVICE_NAME (already done)"
        ;;
esac

print_info ""
print_info "Server will be available on ports 6000-6999 (proxy)"
print_info "and port 8080 (web interface if installed)"