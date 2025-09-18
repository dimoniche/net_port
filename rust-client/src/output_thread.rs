use crate::connection::ConnectionManager;
use crate::logger::{log_debug, log_err, log_info};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

/// Output thread handler
pub struct OutputThread {
    connection_manager: Arc<ConnectionManager>,
    connection_id: usize,
}

impl OutputThread {
    /// Create a new output thread
    pub fn new(connection_manager: Arc<ConnectionManager>, connection_id: usize) -> Self {
        Self {
            connection_manager,
            connection_id,
        }
    }

    /// Start the output thread
    pub async fn start(&self) -> Result<(), String> {
        log_info!("Starting output thread for connection {}", self.connection_id);

        let conn = self
            .connection_manager
            .get_connection(self.connection_id)
            .ok_or_else(|| format!("Connection {} not found", self.connection_id))?;

        // Main output thread loop
        loop {
            let mut conn_guard = conn.lock().await;

            // Check if we should stop
            if conn_guard.stop_requested {
                log_info!("Stop requested for output thread {}", self.connection_id);
                break;
            }

            // Try to connect if not connected
            if conn_guard.output_stream.is_none() {
                if let Err(e) = conn_guard.connect_output().await {
                    log_err!("Failed to connect output for connection {}: {}", self.connection_id, e);
                    sleep(Duration::from_secs(1)).await;
                    continue;
                }
                log_info!("Connected output for connection {}", self.connection_id);
            }

            // Read data from output
            if let Some(ref mut output_stream) = conn_guard.output_stream {
                let mut buffer = [0u8; 16384];
                
                match output_stream.read(&mut buffer).await {
                    Ok(0) => {
                        log_info!("Output connection {} closed by peer", self.connection_id);
                        conn_guard.output_stream = None;
                        continue;
                    }
                    Ok(bytes_read) => {
                        log_info!(
                            "Received {} bytes from output for connection {}",
                            bytes_read,
                            self.connection_id
                        );

                        // Update last exchange time
                        conn_guard.update_exchange_time();

                        // Forward to input
                        if let Some(ref mut input_stream) = conn_guard.input_stream {
                            if let Err(e) = self.forward_data(input_stream, &buffer[..bytes_read]).await {
                                log_err!("Failed to forward data for connection {}: {}", self.connection_id, e);
                                conn_guard.input_stream = None;
                            }
                        } else {
                            log_info!("Input not connected for connection {}, data dropped", self.connection_id);
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        // No data available, continue
                        sleep(Duration::from_millis(10)).await;
                    }
                    Err(e) => {
                        log_err!("Output read error for connection {}: {}", self.connection_id, e);
                        conn_guard.output_stream = None;
                        sleep(Duration::from_secs(1)).await;
                    }
                }
            }

            // Check for inactivity timeout
            if conn_guard.is_inactive(self.connection_manager.timeout_seconds) {
                log_info!("Inactivity timeout for connection {}", self.connection_id);
                conn_guard.close().await;
                break;
            }

            // Release lock before sleeping
            drop(conn_guard);
            sleep(Duration::from_millis(10)).await;
        }

        log_info!("Output thread {} stopped", self.connection_id);
        Ok(())
    }

    /// Forward data to input stream
    async fn forward_data(
        &self,
        input_stream: &mut TcpStream,
        data: &[u8],
    ) -> Result<(), std::io::Error> {
        let mut remaining = data;
        
        while !remaining.is_empty() {
            match input_stream.write(remaining).await {
                Ok(bytes_written) => {
                    if bytes_written == 0 {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::ConnectionAborted,
                            "Input connection closed",
                        ));
                    }
                    remaining = &remaining[bytes_written..];
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    // Wait for socket to become writable
                    sleep(Duration::from_millis(10)).await;
                }
                Err(e) => {
                    return Err(e);
                }
            }
        }
        
        input_stream.flush().await?;
        Ok(())
    }
}

/// Start all output threads
pub async fn start_output_threads(connection_manager: Arc<ConnectionManager>) -> Vec<tokio::task::JoinHandle<()>> {
    let mut handles = Vec::new();
    let connections_count = connection_manager.get_connections().len();

    for connection_id in 0..connections_count {
        let manager_clone = connection_manager.clone();
        let handle = tokio::spawn(async move {
            let output_thread = OutputThread::new(manager_clone, connection_id);
            if let Err(e) = output_thread.start().await {
                log_err!("Output thread {} failed: {}", connection_id, e);
            }
        });
        handles.push(handle);
    }

    handles
}