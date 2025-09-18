use crate::connection::ConnectionManager;
use crate::logger::{log_info, log_warning};
use std::sync::Arc;
use tokio::signal;
use tokio::sync::broadcast;
use tokio::time::{sleep, Duration};

/// Graceful shutdown manager
pub struct ShutdownManager {
    shutdown_tx: broadcast::Sender<()>,
    connection_manager: Arc<ConnectionManager>,
}

impl ShutdownManager {
    /// Create a new shutdown manager
    pub fn new(connection_manager: Arc<ConnectionManager>) -> Self {
        let (shutdown_tx, _) = broadcast::channel(1);
        Self {
            shutdown_tx,
            connection_manager,
        }
    }

    /// Get a receiver for shutdown signals
    pub fn subscribe(&self) -> broadcast::Receiver<()> {
        self.shutdown_tx.subscribe()
    }

    /// Initiate graceful shutdown
    pub async fn shutdown(&self) {
        log_info!("Initiating graceful shutdown...");

        // Signal all connections to stop
        self.stop_all_connections().await;

        // Wait for connections to complete shutdown
        self.wait_for_shutdown().await;

        log_info!("Graceful shutdown completed");
    }

    /// Stop all connections
    async fn stop_all_connections(&self) {
        let connections = self.connection_manager.get_connections();
        
        for (id, conn) in connections.iter().enumerate() {
            if let Err(e) = self.connection_manager.stop_connection(id).await {
                log_warning!("Failed to stop connection {}: {}", id, e);
            }
            
            // Close the connection gracefully
            let mut conn_guard = conn.lock().await;
            conn_guard.close().await;
        }
    }

    /// Wait for all connections to complete shutdown
    async fn wait_for_shutdown(&self) {
        const MAX_WAIT_TIME: Duration = Duration::from_secs(30);
        const CHECK_INTERVAL: Duration = Duration::from_millis(100);
        
        let start_time = std::time::Instant::now();
        
        while start_time.elapsed() < MAX_WAIT_TIME {
            let all_stopped = self.are_all_connections_stopped().await;
            
            if all_stopped {
                log_info!("All connections stopped successfully");
                return;
            }
            
            sleep(CHECK_INTERVAL).await;
        }
        
        log_warning!("Shutdown timeout reached, some connections may not have stopped cleanly");
    }

    /// Check if all connections are stopped
    async fn are_all_connections_stopped(&self) -> bool {
        let connections = self.connection_manager.get_connections();
        
        for conn in connections {
            let conn_guard = conn.lock().await;
            if conn_guard.is_running {
                return false;
            }
        }
        
        true
    }

    /// Handle system signals (SIGINT, SIGTERM)
    pub async fn handle_signals(&self) {
        let ctrl_c = async {
            signal::ctrl_c()
                .await
                .expect("Failed to install Ctrl+C handler");
        };

        #[cfg(unix)]
        let terminate = async {
            signal::unix::signal(signal::unix::SignalKind::terminate())
                .expect("Failed to install signal handler")
                .recv()
                .await;
        };

        #[cfg(not(unix))]
        let terminate = std::future::pending::<()>();

        tokio::select! {
            _ = ctrl_c => {
                log_info!("Received Ctrl+C, initiating shutdown");
            }
            _ = terminate => {
                log_info!("Received SIGTERM, initiating shutdown");
            }
        }

        self.shutdown().await;
    }

    /// Start signal handling in background
    pub fn spawn_signal_handler(self) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            self.handle_signals().await;
        })
    }
}

/// Graceful shutdown helper functions
pub async fn graceful_shutdown(connection_manager: Arc<ConnectionManager>) {
    let shutdown_manager = ShutdownManager::new(connection_manager);
    let signal_handler = shutdown_manager.spawn_signal_handler();
    
    // Wait for shutdown signal
    signal_handler.await.unwrap();
}

/// Emergency shutdown function
pub async fn emergency_shutdown(connection_manager: Arc<ConnectionManager>) {
    log_warning!("Emergency shutdown initiated");
    
    let connections = connection_manager.get_connections();
    
    for conn in connections {
        let mut conn_guard = conn.lock().await;
        conn_guard.close().await;
    }
    
    log_warning!("Emergency shutdown completed");
}