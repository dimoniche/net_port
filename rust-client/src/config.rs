use clap::Parser;
use std::net::IpAddr;
use std::str::FromStr;

/// Configuration for the network port proxy
#[derive(Debug, Clone, Parser)]
#[command(version, about, long_about = None)]
pub struct Config {
    /// Input host address (net_port service address)
    #[arg(long = "host_in", default_value = "82.146.44.140")]
    pub input_address: String,

    /// Input port (net_port service port)
    #[arg(long = "p_in", default_value = "6000")]
    pub input_port: u16,

    /// Output host address (user device service address)
    #[arg(long = "host_out", default_value = "127.0.0.1")]
    pub output_address: String,

    /// Output port (user device service port)
    #[arg(long = "p_out", default_value = "22")]
    pub output_port: u16,

    /// Number of connections
    #[arg(short = 'c', long = "connections", default_value = "1")]
    pub connections_count: usize,

    /// Timeout in seconds for output threads
    #[arg(short = 't', long = "timeout", default_value = "1200")]
    pub timeout_seconds: u64,
}

impl Config {
    /// Validate the configuration
    pub fn validate(&self) -> Result<(), String> {
        if self.connections_count == 0 {
            return Err("Connections count must be greater than 0".to_string());
        }

        if self.timeout_seconds == 0 {
            return Err("Timeout must be greater than 0".to_string());
        }

        // Validate IP addresses
        if let Err(e) = IpAddr::from_str(&self.input_address) {
            return Err(format!("Invalid input address: {}", e));
        }

        if let Err(e) = IpAddr::from_str(&self.output_address) {
            return Err(format!("Invalid output address: {}", e));
        }

        Ok(())
    }

    /// Get input socket address
    pub fn input_addr(&self) -> Result<std::net::SocketAddr, String> {
        let ip = IpAddr::from_str(&self.input_address)
            .map_err(|e| format!("Invalid input address: {}", e))?;
        Ok(std::net::SocketAddr::new(ip, self.input_port))
    }

    /// Get output socket address
    pub fn output_addr(&self) -> Result<std::net::SocketAddr, String> {
        let ip = IpAddr::from_str(&self.output_address)
            .map_err(|e| format!("Invalid output address: {}", e))?;
        Ok(std::net::SocketAddr::new(ip, self.output_port))
    }
}