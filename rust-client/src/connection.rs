use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::TcpStream;
use tokio::sync::Mutex;

/// Buffer size for data transfer (16KB as in C version)
const BUFFER_SIZE: usize = 16384;

/// Connection state for a single proxy connection
#[derive(Debug)]
pub struct Connection {
    pub id: usize,
    
    // Input connection
    pub input_stream: Option<TcpStream>,
    pub input_addr: SocketAddr,
    
    // Output connection  
    pub output_stream: Option<TcpStream>,
    pub output_addr: SocketAddr,
    
    // Buffers for data transfer
    pub receive_input: [u8; BUFFER_SIZE],
    pub receive_output: [u8; BUFFER_SIZE],
    
    // Timing and state
    pub last_exchange_time: Instant,
    pub is_running: bool,
    pub stop_requested: bool,
}

impl Connection {
    /// Create a new connection with the given configuration
    pub fn new(
        id: usize,
        input_addr: SocketAddr,
        output_addr: SocketAddr,
    ) -> Self {
        Self {
            id,
            input_stream: None,
            input_addr,
            output_stream: None,
            output_addr,
            receive_input: [0; BUFFER_SIZE],
            receive_output: [0; BUFFER_SIZE],
            last_exchange_time: Instant::now(),
            is_running: false,
            stop_requested: false,
        }
    }
    
    /// Connect to input server
    pub async fn connect_input(&mut self) -> Result<(), String> {
        match TcpStream::connect(self.input_addr).await {
            Ok(stream) => {
                self.input_stream = Some(stream);
                Ok(())
            }
            Err(e) => Err(format!("Failed to connect to input {}: {}", self.input_addr, e)),
        }
    }
    
    /// Connect to output server
    pub async fn connect_output(&mut self) -> Result<(), String> {
        match TcpStream::connect(self.output_addr).await {
            Ok(stream) => {
                self.output_stream = Some(stream);
                Ok(())
            }
            Err(e) => Err(format!("Failed to connect to output {}: {}", self.output_addr, e)),
        }
    }
    
    /// Check if connection is inactive based on timeout
    pub fn is_inactive(&self, timeout_seconds: u64) -> bool {
        self.last_exchange_time.elapsed() > Duration::from_secs(timeout_seconds)
    }
    
    /// Update last exchange time
    pub fn update_exchange_time(&mut self) {
        self.last_exchange_time = Instant::now();
    }
    
    /// Close both connections gracefully
    pub async fn close(&mut self) {
        if let Some(mut stream) = self.input_stream.take() {
            let _ = stream.shutdown().await;
        }
        
        if let Some(mut stream) = self.output_stream.take() {
            let _ = stream.shutdown().await;
        }
        
        self.is_running = false;
    }
}

/// Thread-safe connection manager
#[derive(Debug)]
pub struct ConnectionManager {
    connections: Vec<Arc<Mutex<Connection>>>,
    timeout_seconds: u64,
}

impl ConnectionManager {
    /// Create a new connection manager
    pub fn new(connections_count: usize, timeout_seconds: u64) -> Self {
        let mut connections = Vec::with_capacity(connections_count);
        
        for id in 0..connections_count {
            // Placeholder addresses - will be configured later
            let conn = Arc::new(Mutex::new(Connection::new(
                id,
                "127.0.0.1:6000".parse().unwrap(),
                "127.0.0.1:22".parse().unwrap(),
            )));
            connections.push(conn);
        }
        
        Self {
            connections,
            timeout_seconds,
        }
    }
    
    /// Get a connection by ID
    pub fn get_connection(&self, id: usize) -> Option<Arc<Mutex<Connection>>> {
        self.connections.get(id).cloned()
    }
    
    /// Get all connections
    pub fn get_connections(&self) -> Vec<Arc<Mutex<Connection>>> {
        self.connections.clone()
    }
    
    /// Configure connection addresses
    pub async fn configure_connection(
        &self,
        id: usize,
        input_addr: SocketAddr,
        output_addr: SocketAddr,
    ) -> Result<(), String> {
        if let Some(conn) = self.connections.get(id) {
            let mut conn = conn.lock().await;
            conn.input_addr = input_addr;
            conn.output_addr = output_addr;
            Ok(())
        } else {
            Err(format!("Connection with id {} not found", id))
        }
    }
    
    /// Start a connection
    pub async fn start_connection(&self, id: usize) -> Result<(), String> {
        if let Some(conn) = self.connections.get(id) {
            let mut conn = conn.lock().await;
            conn.is_running = true;
            conn.stop_requested = false;
            Ok(())
        } else {
            Err(format!("Connection with id {} not found", id))
        }
    }
    
    /// Stop a connection
    pub async fn stop_connection(&self, id: usize) -> Result<(), String> {
        if let Some(conn) = self.connections.get(id) {
            let mut conn = conn.lock().await;
            conn.stop_requested = true;
            Ok(())
        } else {
            Err(format!("Connection with id {} not found", id))
        }
    }
    
    /// Check if any connection is inactive
    pub async fn check_inactive_connections(&self) -> Vec<usize> {
        let mut inactive = Vec::new();
        
        for (id, conn) in self.connections.iter().enumerate() {
            let conn = conn.lock().await;
            if conn.is_running && conn.is_inactive(self.timeout_seconds) {
                inactive.push(id);
            }
        }
        
        inactive
    }
}