#!/bin/bash
set -e

# Net Port Installation Script
# This script installs the Net Port system (web interface, server, database) without Docker

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Installation directory
INSTALL_DIR="/opt/net_port"
LOG_FILE="/var/log/net_port_install.log"

# Default configuration (can be overridden by parameters)
DB_NAME="net_port"
DB_HOST="localhost"
DB_PORT="5432"

# Function for logging
log() {
    echo -e "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# Function for colored output
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Function for error handling
error_exit() {
    log "${RED}ERROR: $1${NC}"
    error "$1"
    exit 1
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Display usage information
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Install Net Port system (web interface, server, database) without Docker.

Options:
  --db-user USER         PostgreSQL database user (required)
  --db-password PASSWORD PostgreSQL database password (required)
  --db-name NAME         Database name (default: net_port)
  --db-host HOST         Database host (default: localhost)
  --db-port PORT         Database port (default: 5432)
  --admin-user USER      Admin user for web interface (default: admin)
  --admin-password PASS  Admin password for web interface (required)
  --no-prompt            Do not prompt for missing credentials
  --help                 Display this help message

Environment variables (alternative to command-line arguments):
  DB_USER, DB_PASSWORD, DB_NAME, DB_HOST, DB_PORT
  APP_USER, APP_PASSWORD, JWT_SECRET, JWT_SECRET_PREVIOUS

Examples:
  $0 --db-user netport --db-password "secure123" --admin-password "admin123"
  DB_USER=netport DB_PASSWORD=secure123 APP_PASSWORD=admin123 $0
EOF
    exit 0
}

# Parse command-line arguments
parse_args() {
    # Default values
    DB_USER=""
    DB_PASSWORD=""
    APP_USER="admin"
    APP_PASSWORD=""
    NO_PROMPT=false
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --db-user)
                DB_USER="$2"
                shift 2
                ;;
            --db-password)
                DB_PASSWORD="$2"
                shift 2
                ;;
            --db-name)
                DB_NAME="$2"
                shift 2
                ;;
            --db-host)
                DB_HOST="$2"
                shift 2
                ;;
            --db-port)
                DB_PORT="$2"
                shift 2
                ;;
            --admin-user)
                APP_USER="$2"
                shift 2
                ;;
            --admin-password)
                APP_PASSWORD="$2"
                shift 2
                ;;
            --no-prompt)
                NO_PROMPT=true
                shift
                ;;
            --help)
                usage
                ;;
            *)
                error_exit "Unknown option: $1"
                ;;
        esac
    done
    
    # Check environment variables if not provided via command line
    if [ -z "$DB_USER" ] && [ -n "$DB_USER_ENV" ]; then
        DB_USER="$DB_USER_ENV"
    fi
    if [ -z "$DB_PASSWORD" ] && [ -n "$DB_PASSWORD_ENV" ]; then
        DB_PASSWORD="$DB_PASSWORD_ENV"
    fi
    if [ -z "$APP_USER" ] && [ -n "$APP_USER_ENV" ]; then
        APP_USER="$APP_USER_ENV"
    fi
    if [ -z "$APP_PASSWORD" ] && [ -n "$APP_PASSWORD_ENV" ]; then
        APP_PASSWORD="$APP_PASSWORD_ENV"
    fi
}

# Prompt for missing credentials
prompt_credentials() {
    if [ "$NO_PROMPT" = false ]; then
        # Database user
        if [ -z "$DB_USER" ]; then
            read -p "Enter PostgreSQL database user [admin]: " DB_USER
            DB_USER=${DB_USER:-admin}
        fi
        
        # Database password
        if [ -z "$DB_PASSWORD" ]; then
            read -sp "Enter PostgreSQL database password: " DB_PASSWORD
            echo
            if [ -z "$DB_PASSWORD" ]; then
                error_exit "Database password is required"
            fi
        fi
        
        # Admin user (optional prompt, defaults to admin)
        if [ -z "$APP_USER" ]; then
            read -p "Enter admin username for web interface [admin]: " APP_USER
            APP_USER=${APP_USER:-admin}
        fi
        
        # Admin password
        if [ -z "$APP_PASSWORD" ]; then
            read -sp "Enter admin password for web interface: " APP_PASSWORD
            echo
            if [ -z "$APP_PASSWORD" ]; then
                error_exit "Admin password is required"
            fi
        fi
    else
        # In no-prompt mode, exit if credentials are missing
        if [ -z "$DB_USER" ]; then
            error_exit "Database user is required. Use --db-user or DB_USER environment variable."
        fi
        if [ -z "$DB_PASSWORD" ]; then
            error_exit "Database password is required. Use --db-password or DB_PASSWORD environment variable."
        fi
        if [ -z "$APP_USER" ]; then
            error_exit "Admin username is required. Use --admin-user or APP_USER environment variable."
        fi
        if [ -z "$APP_PASSWORD" ]; then
            error_exit "Admin password is required. Use --admin-password or APP_PASSWORD environment variable."
        fi
    fi
}

# Validate credentials
validate_credentials() {
    if [ -z "$DB_USER" ]; then
        error_exit "Database user is not set"
    fi
    if [ -z "$DB_PASSWORD" ]; then
        error_exit "Database password is not set"
    fi
    if [ -z "$APP_PASSWORD" ]; then
        error_exit "Admin password is not set"
    fi
    
    # Log credentials (without passwords) for debugging
    log "Database user: $DB_USER"
    log "Database name: $DB_NAME"
    log "Database host: $DB_HOST:$DB_PORT"
    log "Admin user: $APP_USER"
}

# Detect OS and package manager
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        VERSION=$VERSION_ID
    else
        error_exit "Cannot detect OS. This script supports Debian/Ubuntu and RHEL/CentOS."
    fi
}

# Install packages based on OS
install_packages() {
    case $OS in
        ubuntu|debian)
            log "Installing packages using apt..."
            
            # Set non-interactive mode for apt
            export DEBIAN_FRONTEND=noninteractive
            
            # Update package list with retry
            info "Updating package list..."
            for i in {1..3}; do
                apt-get update >> "$LOG_FILE" 2>&1 && break
                if [ $i -eq 3 ]; then
                    warning "Failed to update package list after 3 attempts, continuing anyway"
                else
                    warning "Failed to update package list, retrying ($i/3)..."
                    sleep 2
                fi
            done
            
            # Install basic dependencies first
            info "Installing basic dependencies..."
            apt-get install -y --no-install-recommends \
                curl \
                >> "$LOG_FILE" 2>&1 || warning "Some basic packages failed to install"
            
            # Add NodeSource repository for Node.js 14
            if ! command_exists node || [[ $(node --version | cut -d'.' -f1 | tr -d 'v') -lt 14 ]]; then
                info "Adding NodeSource repository..."
                curl -fsSL https://deb.nodesource.com/setup_14.x | bash - >> "$LOG_FILE" 2>&1 || \
                    warning "Failed to add NodeSource repository"
            fi
            
            # Install packages in groups for better error handling
            info "Installing build tools..."
            apt-get install -y --no-install-recommends \
                build-essential \
                cmake \
                git \
                >> "$LOG_FILE" 2>&1 || warning "Some build tools failed to install"
            
            info "Installing PostgreSQL..."
            apt-get install -y --no-install-recommends \
                postgresql \
                postgresql-contrib \
                libpq-dev \
                >> "$LOG_FILE" 2>&1 || warning "PostgreSQL installation had issues"
            
            info "Installing web server and runtime..."
            apt-get install -y --no-install-recommends \
                nginx \
                nodejs \
                >> "$LOG_FILE" 2>&1 || warning "Web server/runtime installation had issues"
            
            # npm comes with nodejs on newer versions, but install separately if needed
            if ! command_exists npm; then
                apt-get install -y --no-install-recommends npm >> "$LOG_FILE" 2>&1 || \
                    warning "npm installation failed"
            fi
            
            info "Installing additional dependencies..."
            apt-get install -y --no-install-recommends \
                openssl \
                libssl-dev \
                >> "$LOG_FILE" 2>&1 || warning "Some additional dependencies failed to install"
            
            # Verify critical packages
            for pkg in nodejs postgresql nginx; do
                if dpkg -l | grep -q "^ii.*$pkg"; then
                    log "Package $pkg installed successfully"
                else
                    warning "Package $pkg may not be installed properly"
                fi
            done
            ;;
        centos|rhel|fedora)
            log "Installing packages using yum/dnf..."
            if command_exists dnf; then
                PKG_MGR="dnf"
            else
                PKG_MGR="yum"
            fi
            
            # Install EPEL repository for additional packages
            if [ "$OS" = "centos" ] || [ "$OS" = "rhel" ]; then
                info "Installing EPEL repository..."
                $PKG_MGR install -y epel-release >> "$LOG_FILE" 2>&1 || \
                    warning "Failed to install EPEL repository"
            fi
            
            # Add NodeSource repository
            if ! command_exists node || [[ $(node --version | cut -d'.' -f1 | tr -d 'v') -lt 14 ]]; then
                info "Adding NodeSource repository..."
                curl -fsSL https://rpm.nodesource.com/setup_14.x | bash - >> "$LOG_FILE" 2>&1 || \
                    warning "Failed to add NodeSource repository"
            fi
            
            info "Installing packages..."
            $PKG_MGR install -y \
                gcc \
                gcc-c++ \
                make \
                cmake \
                git \
                postgresql-server \
                postgresql-contrib \
                nginx \
                nodejs \
                openssl \
                openssl-devel \
                curl \
                libpq-dev \
                >> "$LOG_FILE" 2>&1 || warning "Some packages failed to install"
            
            # Initialize PostgreSQL if needed
            if [ ! -d /var/lib/pgsql/data ]; then
                postgresql-setup --initdb >> "$LOG_FILE" 2>&1 || \
                    warning "PostgreSQL initialization failed"
            fi
            ;;
        *)
            error_exit "Unsupported OS: $OS"
            ;;
    esac
    
    # Final check for critical commands
    for cmd in node psql nginx; do
        if command_exists "$cmd"; then
            log "Command $cmd is available"
        else
            warning "Command $cmd is not available after installation"
        fi
    done
}

# Check for --help before root check
for arg in "$@"; do
    if [ "$arg" = "--help" ]; then
        usage
    fi
done

# Main installation function
main() {
    # Check if running as root
    if [[ $EUID -ne 0 ]]; then
        error_exit "This script must be run as root. Use sudo."
    fi
    
    # Create log file
    touch "$LOG_FILE" 2>/dev/null || error_exit "Cannot create log file. Check permissions."
    chmod 644 "$LOG_FILE"
    
    # Parse arguments
    parse_args "$@"
    
    # Prompt for missing credentials
    prompt_credentials
    
    # Validate credentials
    validate_credentials
    
    log "${GREEN}Starting Net Port installation...${NC}"
    info "Installation log: $LOG_FILE"
    
    # Detect OS
    detect_os
    info "Detected OS: $OS $VERSION"
    
    # Install system dependencies
    info "Installing system dependencies..."
    install_packages
    
    # Create installation directory
    info "Creating installation directory at $INSTALL_DIR..."
    mkdir -p "$INSTALL_DIR"/{bin,logs,ssl}
    
    # Copy source files
    info "Copying source files..."
    cp -r . "$INSTALL_DIR/source" 2>/dev/null || error_exit "Failed to copy source files"
    
    # Build C server and client
    info "Building C server and client..."
    cd "$INSTALL_DIR/source"
        
    info "Building from source..."
    mkdir -p build
    
    cmake "$INSTALL_DIR/source/CMakeLists.txt" >> "$LOG_FILE" 2>&1 || error_exit "CMake configuration failed"
    cmake --build "$INSTALL_DIR/source" >> "$LOG_FILE" 2>&1 || error_exit "Build failed"

    # Stop existing services if they are running (to avoid "Text file busy" error)
    info "Checking for running Net Port services..."
    if systemctl is-active --quiet net-port-server.service 2>/dev/null; then
        info "Stopping net-port-server.service..."
        systemctl stop net-port-server.service >> "$LOG_FILE" 2>&1 || warning "Failed to stop net-port-server.service"
    fi
    if systemctl is-active --quiet net-port-backend.service 2>/dev/null; then
        info "Stopping net-port-backend.service..."
        systemctl stop net-port-backend.service >> "$LOG_FILE" 2>&1 || warning "Failed to stop net-port-backend.service"
    fi
    # Give time for processes to release file handles
    sleep 3
    
    # Copy binaries
    SERVER_BIN=$(find . -name "module_net_port_server*" -type f ! -name "*.dir" | head -1)
    CLIENT_BIN=$(find . -name "module_net_port_client*" -type f ! -name "*.dir" | head -1)
    
    info "SERVER_BIN: $SERVER_BIN"
    info "CLIENT_BIN: $CLIENT_BIN"

    if [ -n "$SERVER_BIN" ]; then
        # Use install command which can handle busy files better than cp
        install -m 755 "$SERVER_BIN" "$INSTALL_DIR/bin/" || {
            # If install fails, try cp with a small delay
            warning "install failed, trying cp with retry..."
            sleep 2
            cp -f "$SERVER_BIN" "$INSTALL_DIR/bin/" || error_exit "Failed to copy server binary (file may be busy)"
        }
    else
        warning "Server binary not found after build"
    fi
    
    if [ -n "$CLIENT_BIN" ]; then
        install -m 755 "$CLIENT_BIN" "$INSTALL_DIR/bin/" || {
            warning "install failed, trying cp with retry..."
            sleep 2
            cp -f "$CLIENT_BIN" "$INSTALL_DIR/bin/" || warning "Failed to copy client binary"
        }
    else
        warning "Client binary not found after build"
    fi
    
    # Set executable permissions
    chmod +x "$INSTALL_DIR/bin/"* 2>/dev/null || warning "Failed to set executable permissions on binaries"

    cp "$INSTALL_DIR/source/init_db.sql" /etc/postgresql/init_db.sql
    chown postgres:postgres /etc/postgresql/init_db.sql

    # Database setup
    info "Setting up PostgreSQL database..."
        
    # Start and enable PostgreSQL
    if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
        service postgresql start
    elif [ "$OS" = "centos" ] || [ "$OS" = "rhel" ]; then
        systemctl start postgresql >> "$LOG_FILE" 2>&1 || error_exit "Failed to start PostgreSQL"
        systemctl enable postgresql >> "$LOG_FILE" 2>&1 || error_exit "Failed to enable PostgreSQL"
    fi
    
    # Wait for PostgreSQL to start
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
    
    # Update PostgreSQL configuration to allow connections
    if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
        PG_CONF=$(find /etc/postgresql -name "postgresql.conf" | head -1)
        PG_HBA=$(find /etc/postgresql -name "pg_hba.conf" | head -1)
    elif [ "$OS" = "centos" ] || [ "$OS" = "rhel" ]; then
        PG_CONF="/var/lib/pgsql/data/postgresql.conf"
        PG_HBA="/var/lib/pgsql/data/pg_hba.conf"
    fi
    
    if [ -f "$PG_CONF" ]; then
        sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" "$PG_CONF" 2>/dev/null || \
            echo "listen_addresses = '*'" >> "$PG_CONF"
    fi
    
    if [ -f "$PG_HBA" ]; then
        # Add line if not already present
        if ! grep -q "host.*all.*all.*0.0.0.0/0.*md5" "$PG_HBA"; then
            echo "host    all             all             0.0.0.0/0               md5" >> "$PG_HBA"
        fi
    fi
    
    # Restart PostgreSQL
    service postgresql restart >> "$LOG_FILE" 2>&1 && \
        success "PostgreSQL configured and restarted" || error_exit "Failed to restart PostgreSQL"
    
    # Node.js backend setup
    info "Setting up Node.js backend..."
    cd "$INSTALL_DIR/source/web/backend_net_port"
    
    if [ -f "package.json" ]; then
        info "Installing backend dependencies..."
        npm install >> "$LOG_FILE" 2>&1 && \
            success "Backend dependencies installed" || error_exit "Failed to install backend dependencies"
        
        # Create .env file for backend
        if [ -z "${JWT_SECRET:-}" ]; then
            JWT_SECRET="$(openssl rand -base64 32)"
            info "Generated JWT_SECRET for this installation"
        fi
        cat > .env << EOF
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
JWT_SECRET=$JWT_SECRET
NODE_ENV=production
EOF
        if [ -n "${JWT_SECRET_PREVIOUS:-}" ]; then
            echo "JWT_SECRET_PREVIOUS=$JWT_SECRET_PREVIOUS" >> .env
        fi
        success "Backend configuration created"
        
        # Copy backend to bin folder
        info "Copying backend to bin folder..."
        mkdir -p "$INSTALL_DIR/bin/backend"
        cp -r . "$INSTALL_DIR/bin/backend/" && \
            success "Backend copied to bin folder" || error_exit "Failed to copy backend to bin folder"
    else
        warning "Backend package.json not found, skipping backend setup"
    fi
    
    # React frontend setup
    info "Setting up React frontend..."
    cd "$INSTALL_DIR/source/web/frontend_net_port"
    
    if [ -f "package.json" ]; then
        info "Installing frontend dependencies..."
        npm install >> "$LOG_FILE" 2>&1 && \
            success "Frontend dependencies installed" || error_exit "Failed to install frontend dependencies"
        npm install bcryptjs >> "$LOG_FILE" 2>&1 && \
            success "bcryptjs installed" || error_exit "Failed to install bcryptjs"
        
        info "Building frontend..."
        npm run build >> "$LOG_FILE" 2>&1 && \
            success "Frontend built successfully" || error_exit "Failed to build frontend"
        
        # Copy built frontend to bin folder
        info "Copying frontend build to bin folder..."
        mkdir -p "$INSTALL_DIR/bin/frontend"
        cp -r build/* "$INSTALL_DIR/bin/frontend/" && \
            success "Frontend copied to bin folder" || error_exit "Failed to copy frontend to bin folder"
    else
        warning "Frontend package.json not found, skipping frontend setup"
    fi
    
    # Nginx configuration
    info "Configuring nginx..."
    
    # Create nginx site configuration
    cat > /etc/nginx/sites-available/net_port << EOF
server {
    listen 80;
    server_name _;
    root $INSTALL_DIR/bin/frontend;
    index index.html;

    # Serve frontend
    location / {
        try_files \$uri /index.html;
    }

    # Proxy API requests to backend
    location /api {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
    }

    # Proxy authentication
    location /authentication {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    # Proxy other backend endpoints
    location ~ ^/(servers|statistics|users|roles|files) {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF
    
    # Enable site
    ln -sf /etc/nginx/sites-available/net_port /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
    
    # Test nginx configuration
    nginx -t >> "$LOG_FILE" 2>&1 && \
        success "Nginx configuration test passed" || error_exit "Nginx configuration test failed"
    
    # Restart nginx
    systemctl restart nginx >> "$LOG_FILE" 2>&1 && \
        success "Nginx restarted" || error_exit "Failed to restart nginx"

    # Add admin user with hashed password from environment
    info "Adding admin user..."
    cd "$INSTALL_DIR/source/web/backend_net_port"
    APP_USER="$APP_USER" APP_PASSWORD="$APP_PASSWORD" DB_USER="$DB_USER" DB_PASSWORD="$DB_PASSWORD" DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_NAME="$DB_NAME" node src/add-test-user.js >> "$LOG_FILE" 2>&1 && \
        success "Admin user added" || error_exit "Failed to add admin user"
    info "Admin user added"

    rm -rf "$INSTALL_DIR/source"

    # Generate SSL certificates (self-signed for development)
    info "Generating SSL certificates..."
    cd "$INSTALL_DIR/ssl"
    if [ ! -f server.crt ] || [ ! -f server.key ]; then
        openssl genrsa -out server.key 2048 >> "$LOG_FILE" 2>&1
        openssl req -new -x509 -key server.key -out server.crt -days 3650 \
            -subj "/C=RU/ST=Moscow/L=Moscow/O=Net Port/CN=localhost" >> "$LOG_FILE" 2>&1
        success "SSL certificates generated"
    else
        info "SSL certificates already exist, skipping generation"
    fi
    
    # Create systemd service for backend
    info "Creating systemd services..."
    
    # Find server binary
    SERVER_BIN_PATH=$(find "$INSTALL_DIR/bin" -name "module_net_port_server*" -type f | head -1)
    if [ -z "$SERVER_BIN_PATH" ]; then
        SERVER_BIN_PATH="$INSTALL_DIR/bin/module_net_port_server"
        warning "Server binary not found, using default path: $SERVER_BIN_PATH"
    fi
    
    # Backend service
    cat > /etc/systemd/system/net-port-backend.service << EOF
[Unit]
Description=Net Port Backend API
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR/bin/backend
Environment=NODE_ENV=production
Environment=DB_USER=$DB_USER
Environment=DB_PASSWORD=$DB_PASSWORD
Environment=DB_HOST=$DB_HOST
Environment=DB_PORT=$DB_PORT
Environment=JWT_SECRET=$JWT_SECRET
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
    
    # Server (C application) service
    cat > /etc/systemd/system/net-port-server.service << EOF
[Unit]
Description=Net Port Server (C Application)
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
Environment=DB_USER=$DB_USER
Environment=DB_PASSWORD=$DB_PASSWORD
Environment=DB_HOST=$DB_HOST
Environment=DB_PORT=$DB_PORT
Environment=THREADS=10
ExecStart=$SERVER_BIN_PATH --user 1 -v1 --cert $INSTALL_DIR/ssl/server.crt --key $INSTALL_DIR/ssl/server.key --threads 10 --username $DB_USER --password $DB_PASSWORD --host $DB_HOST -p $DB_PORT --enable-device-management --device-control-port 8443
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
    
    # Reload systemd and enable services
    systemctl daemon-reload >> "$LOG_FILE" 2>&1
    systemctl enable net-port-backend.service >> "$LOG_FILE" 2>&1
    systemctl enable net-port-server.service >> "$LOG_FILE" 2>&1
    
    # Start services
    info "Starting services..."
    systemctl start net-port-backend.service >> "$LOG_FILE" 2>&1 && \
        success "Backend service started" || error_exit "Failed to start backend service"
    systemctl start net-port-server.service >> "$LOG_FILE" 2>&1 && \
        success "Server service started" || error_exit "Failed to start server service"
        
    # Set permissions
    chmod -R 755 "$INSTALL_DIR"
    chown -R root:root "$INSTALL_DIR"
    
    # Create uninstall script
    cat > "$INSTALL_DIR/uninstall.sh" << EOF
#!/bin/bash
set -e

echo "=== Net Port Uninstaller ==="
echo ""
echo "This will remove Net Port from your system."
echo -n "Are you sure? (y/N): "
read -r confirm
if [[ ! \$confirm =~ ^[Yy]$ ]]; then
    echo "Uninstall cancelled."
    exit 0
fi

echo "Stopping services..."
systemctl stop net-port-backend.service 2>/dev/null || true
systemctl stop net-port-server.service 2>/dev/null || true
systemctl disable net-port-backend.service 2>/dev/null || true
systemctl disable net-port-server.service 2>/dev/null || true

echo "Removing services..."
rm -f /etc/systemd/system/net-port-backend.service
rm -f /etc/systemd/system/net-port-server.service
systemctl daemon-reload

echo "Removing nginx configuration..."
rm -f /etc/nginx/sites-available/net_port
rm -f /etc/nginx/sites-enabled/net_port
systemctl restart nginx 2>/dev/null || true

echo "Removing installation directory..."
rm -rf $INSTALL_DIR

echo "Net Port has been uninstalled."
echo ""
echo "Note: PostgreSQL database and user were not removed."
echo "To remove database manually: sudo -u postgres psql -c 'DROP DATABASE $DB_NAME;'"
echo "To remove user manually: sudo -u postgres psql -c 'DROP USER $DB_USER;'"
EOF
    
    chmod +x "$INSTALL_DIR/uninstall.sh"
    
    # Create management script
    cat > "$INSTALL_DIR/manage.sh" << EOF
#!/bin/bash

case "\$1" in
    start)
        systemctl start net-port-backend net-port-server
        echo "Services started"
        ;;
    stop)
        systemctl stop net-port-backend net-port-server
        echo "Services stopped"
        ;;
    restart)
        systemctl restart net-port-backend net-port-server
        echo "Services restarted"
        ;;
    status)
        systemctl status net-port-backend net-port-server --no-pager
        ;;
    logs)
        journalctl -u net-port-backend -u net-port-server -f
        ;;
    *)
        echo "Usage: \$0 {start|stop|restart|status|logs}"
        exit 1
        ;;
esac
EOF
    
    chmod +x "$INSTALL_DIR/manage.sh"
    
    # Final output
    echo ""
    success "================================================"
    success "Net Port Installation Completed Successfully!"
    success "================================================"
    echo ""
    info "Installation Directory: $INSTALL_DIR"
    info "Database:"
    info "  - Name: $DB_NAME"
    info "  - User: $DB_USER"
    info "  - Host: $DB_HOST:$DB_PORT"
    echo ""
    info "Web Interface Credentials:"
    info "  - Username: $APP_USER"
    info "  - Password: [provided during installation]"
    echo ""
    info "Web Interface: http://$(hostname -I | awk '{print $1}')"
    info "Backend API: http://$(hostname -I | awk '{print $1}'):8080"
    echo ""
    info "Services:"
    info "  - net-port-backend.service: Node.js backend (port 8080)"
    info "  - net-port-server.service: C server application"
    echo ""
    info "Management Commands:"
    info "  Start:   systemctl start net-port-backend net-port-server"
    info "  Stop:    systemctl stop net-port-backend net-port-server"
    info "  Restart: systemctl restart net-port-backend net-port-server"
    info "  Status:  systemctl status net-port-backend net-port-server"
    info "  Logs:    journalctl -u net-port-backend -u net-port-server -f"
    echo ""
    info "Quick Management: $INSTALL_DIR/manage.sh {start|stop|restart|status|logs}"
    info "Uninstall: $INSTALL_DIR/uninstall.sh"
    echo ""
    warning "Important: Keep your credentials secure!"
    warning "Database credentials: $INSTALL_DIR/bin/backend/.env"
    echo ""
    success "Net Port is now installed and running!"
    log "${GREEN}Installation completed at $(date)${NC}"
}

# Capture environment variables before parsing (preserve original env vars)
DB_USER_ENV="${DB_USER:-}"
DB_PASSWORD_ENV="${DB_PASSWORD:-}"
APP_USER_ENV="${APP_USER:-}"
APP_PASSWORD_ENV="${APP_PASSWORD:-}"

# Run main function
main "$@"