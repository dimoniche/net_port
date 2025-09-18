mod config;
mod connection;
mod error;
mod input_thread;
mod logger;
mod output_thread;
mod shutdown;

use crate::config::Config;
use crate::connection::ConnectionManager;
use crate::logger::{init_logger, log_err, log_info};
use crate::shutdown::graceful_shutdown;
use std::sync::Arc;
use tokio::sync::Mutex;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logger
    init_logger();
    log_info!("Starting net-port-proxy application");

    // Parse command line arguments
    let config = Config::parse();
    
    // Validate configuration
    if let Err(e) = config.validate() {
        log_err!("Configuration error: {}", e);
        return Err(e.into());
    }

    log_info!("Configuration loaded: {:?}", config);

    // Create connection manager
    let connection_manager = Arc::new(ConnectionManager::new(
        config.connections_count,
        config.timeout_seconds,
    ));

    // Configure all connections with the correct addresses
    let input_addr = config.input_addr()?;
    let output_addr = config.output_addr()?;
    
    for id in 0..config.connections_count {
        if let Err(e) = connection_manager.configure_connection(id, input_addr, output_addr).await {
            log_err!("Failed to configure connection {}: {}", id, e);
            return Err(e.into());
        }
    }

    log_info!("Starting {} connections", config.connections_count);

    // Start all input threads
    let input_handles = input_thread::start_input_threads(connection_manager.clone()).await;
    log_info!("Started {} input threads", input_handles.len());

    // Start all output threads  
    let output_handles = output_thread::start_output_threads(connection_manager.clone()).await;
    log_info!("Started {} output threads", output_handles.len());

    // Start graceful shutdown handler
    let shutdown_manager = connection_manager.clone();
    let shutdown_handle = tokio::spawn(async move {
        graceful_shutdown(shutdown_manager).await;
    });

    log_info!("Proxy server started successfully");
    log_info!("Forwarding: {}:{} -> {}:{}", 
        config.input_address, config.input_port,
        config.output_address, config.output_port);

    // Wait for all threads to complete or shutdown signal
    tokio::select! {
        _ = async {
            let mut all_handles = input_handles;
            all_handles.extend(output_handles);
            
            for handle in all_handles {
                let _ = handle.await;
            }
        } => {
            log_info!("All threads completed normally");
        }
        _ = shutdown_handle => {
            log_info!("Shutdown signal received");
        }
    }

    log_info!("Application exiting");
    Ok(())
}