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
  ADMIN_USER, ADMIN_PASSWORD

Examples:
  $0 --db-user netport --db-password "secure123" --admin-password "admin123"
  DB_USER=netport DB_PASSWORD=secure123 ADMIN_PASSWORD=admin123 $0
EOF
    exit 0
}

# Parse command-line arguments
parse_args() {
    # Default values
    DB_USER=""
    DB_PASSWORD=""
    ADMIN_USER="admin"
    ADMIN_PASSWORD=""
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
                ADMIN_USER="$2"
                shift 2
                ;;
            --admin-password)
                ADMIN_PASSWORD="$2"
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
    if [ -z "$ADMIN_PASSWORD" ] && [ -n "$ADMIN_PASSWORD_ENV" ]; then
        ADMIN_PASSWORD="$ADMIN_PASSWORD_ENV"
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
        
        # Admin password
        if [ -z "$ADMIN_PASSWORD" ]; then
            read -sp "Enter admin password for web interface: " ADMIN_PASSWORD
            echo
            if [ -z "$ADMIN_PASSWORD" ]; then
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
        if [ -z "$ADMIN_PASSWORD" ]; then
            error_exit "Admin password is required. Use --admin-password or ADMIN_PASSWORD environment variable."
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
    if [ -z "$ADMIN_PASSWORD" ]; then
        error_exit "Admin password is not set"
    fi
    
    # Log credentials (without passwords) for debugging
    log "Database user: $DB_USER"
    log "Database name: $DB_NAME"
    log "Database host: $DB_HOST:$DB_PORT"
    log "Admin user: $ADMIN_USER"
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
    mkdir -p "$INSTALL_DIR"/{bin,config,web,logs,data,ssl}
    
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

    # Copy binaries
    SERVER_BIN=$(find . -name "module_net_port_server*" -type f ! -name "*.dir" | head -1)
    CLIENT_BIN=$(find . -name "module_net_port_client*" -type f ! -name "*.dir" | head -1)
    
    info "SERVER_BIN: $SERVER_BIN"
    info "CLIENT_BIN: $CLIENT_BIN"

    if [ -n "$SERVER_BIN" ]; then
        cp "$SERVER_BIN" "$INSTALL_DIR/bin/"
    else
        warning "Server binary not found after build"
    fi
    
    if [ -n "$CLIENT_BIN" ]; then
        cp "$CLIENT_BIN" "$INSTALL_DIR/bin/"
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
        cat > .env << EOF
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
NODE_ENV=production
EOF
        success "Backend configuration created"
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
        
        info "Building frontend..."
        npm run build >> "$LOG_FILE" 2>&1 && \
            success "Frontend built successfully" || error_exit "Failed to build frontend"
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
    root $INSTALL_DIR/source/web/frontend_net_port/build;
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
WorkingDirectory=$INSTALL_DIR/source/web/backend_net_port
Environment=NODE_ENV=production
Environment=DB_USER=$DB_USER
Environment=DB_PASSWORD=$DB_PASSWORD
Environment=DB_HOST=$DB_HOST
Environment=DB_PORT=$DB_PORT
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
ExecStart=$SERVER_BIN_PATH --user 1 -v1 --cert $INSTALL_DIR/ssl/server.crt --key $INSTALL_DIR/ssl/server.key --threads 10 --username $DB_USER --password $DB_PASSWORD --host $DB_HOST -p $DB_PORT
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
    
    # Create admin user with provided credentials
    info "Creating admin user..."
    cd "$INSTALL_DIR/source/web/backend_net_port"
    if [ -f "../utils/add_test_user.js" ]; then
        # Create a temporary script to add user with custom password
        cat > /tmp/create_admin.js << EOF
// Script to create admin user with custom password
const app = require('./src/app');
const service = app.service('users');
const crypto = require('crypto');

const hashPassword = (password) => {
    return crypto.createHash('sha256').update(password).digest('hex');
};

const main = async () => {
    try {
        // Check if admin user already exists
        const existing = await service.find({
            query: {
                login: '$ADMIN_USER'
            }
        });
        
        if (existing.total > 0) {
            console.log('Admin user already exists, updating password...');
            const user = existing.data[0];
            await service.patch(user.id, {
                password: hashPassword('$ADMIN_PASSWORD')
            });
            console.log('Admin password updated');
        } else {
            // Create new admin user
            await service.create({
                login: '$ADMIN_USER',
                password: hashPassword('$ADMIN_PASSWORD'),
                email: 'admin@localhost',
                role_name: 'admin',
                username: 'Administrator'
            });
            console.log('Admin user created');
        }
        process.exit(0);
    } catch (error) {
        console.error('Error creating admin user:', error);
        process.exit(1);
    }
};

main();
EOF
        
        # Run the script
        node /tmp/create_admin.js >> "$LOG_FILE" 2>&1 && \
            success "Admin user created/updated" || warning "Failed to create admin user"
        rm -f /tmp/create_admin.js
    else
        warning "add_test_user.js not found, skipping admin user creation"
    fi
    
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
    info "  - Username: $ADMIN_USER"
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
    warning "Database credentials: $INSTALL_DIR/source/web/backend_net_port/.env"
    echo ""
    success "Net Port is now installed and running!"
    log "${GREEN}Installation completed at $(date)${NC}"
}

# Capture environment variables before parsing
DB_USER_ENV="$DB_USER"
DB_PASSWORD_ENV="$DB_PASSWORD"
ADMIN_PASSWORD_ENV="$ADMIN_PASSWORD"

# Run main function
main "$@"