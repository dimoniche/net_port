use thiserror::Error;

/// Custom error type for the proxy application
#[derive(Error, Debug)]
pub enum ProxyError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Socket error: {0}")]
    Socket(String),

    #[error("Connection error: {0}")]
    Connection(String),

    #[error("Timeout error: {0}")]
    Timeout(String),

    #[error("Thread error: {0}")]
    Thread(String),
}

/// Result type alias for the proxy application
pub type Result<T> = std::result::Result<T, ProxyError>;