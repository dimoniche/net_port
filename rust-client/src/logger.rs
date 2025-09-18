use log::{Level, LevelFilter, Log, Metadata, Record};
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Log priority levels matching the C version
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogPriority {
    Emerg = 0,
    Alert = 1,
    Crit = 2,
    Err = 3,
    Warning = 4,
    Notice = 5,
    Info = 6,
    Debug = 7,
}

impl From<LogPriority> for LevelFilter {
    fn from(priority: LogPriority) -> Self {
        match priority {
            LogPriority::Emerg => LevelFilter::Off,
            LogPriority::Alert => LevelFilter::Error,
            LogPriority::Crit => LevelFilter::Error,
            LogPriority::Err => LevelFilter::Error,
            LogPriority::Warning => LevelFilter::Warn,
            LogPriority::Notice => LevelFilter::Info,
            LogPriority::Info => LevelFilter::Info,
            LogPriority::Debug => LevelFilter::Debug,
        }
    }
}

impl From<Level> for LogPriority {
    fn from(level: Level) -> Self {
        match level {
            Level::Error => LogPriority::Err,
            Level::Warn => LogPriority::Warning,
            Level::Info => LogPriority::Info,
            Level::Debug => LogPriority::Debug,
            Level::Trace => LogPriority::Debug,
        }
    }
}

/// Logger configuration
pub struct Logger {
    log_file: Mutex<File>,
    priority: Mutex<LogPriority>,
    record_counter: Mutex<u64>,
}

impl Logger {
    /// Create a new logger instance
    pub fn new(log_path: &str) -> io::Result<Self> {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)?;

        Ok(Self {
            log_file: Mutex::new(file),
            priority: Mutex::new(LogPriority::Debug),
            record_counter: Mutex::new(0),
        })
    }

    /// Set log priority level
    pub fn set_priority(&self, priority: LogPriority) {
        let mut current_priority = self.priority.lock().unwrap();
        *current_priority = priority;
        
        // Update global log level filter
        log::set_max_level(priority.into());
    }

    /// Get current log priority
    pub fn get_priority(&self) -> LogPriority {
        *self.priority.lock().unwrap()
    }

    /// Write log message with timestamp and formatting
    fn write_log(&self, priority: LogPriority, message: &str) -> io::Result<()> {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();

        let mut counter = self.record_counter.lock().unwrap();
        *counter = (*counter + 1) % 100000;

        let priority_str = match priority {
            LogPriority::Emerg => "EMRG",
            LogPriority::Alert => "ALRT",
            LogPriority::Crit => "CRIT",
            LogPriority::Err => "ERR ",
            LogPriority::Warning => "WARN",
            LogPriority::Notice => "NOTC",
            LogPriority::Info => "INFO",
            LogPriority::Debug => "DBUG",
        };

        let log_line = format!(
            "{:05} {} : {} [{}]: {}\n",
            *counter,
            timestamp,
            "main", // thread label placeholder
            priority_str,
            message
        );

        let mut file = self.log_file.lock().unwrap();
        file.write_all(log_line.as_bytes())?;
        file.flush()?;

        Ok(())
    }

    /// Initialize logger with default settings
    pub fn init(log_path: &str) -> io::Result<()> {
        let logger = Self::new(log_path)?;
        
        // Set default priority
        logger.set_priority(LogPriority::Debug);
        
        // Set as global logger
        log::set_boxed_logger(Box::new(logger))
            .map(|()| log::set_max_level(LevelFilter::Debug))?;
            
        Ok(())
    }
}

impl Log for Logger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        let current_priority = self.get_priority();
        let record_priority = LogPriority::from(metadata.level());
        record_priority as u8 <= current_priority as u8
    }

    fn log(&self, record: &Record) {
        if self.enabled(record.metadata()) {
            let priority = LogPriority::from(record.level());
            let message = format!("{}", record.args());
            
            if let Err(e) = self.write_log(priority, &message) {
                eprintln!("Failed to write log: {}", e);
            }
        }
    }

    fn flush(&self) {
        let _ = self.log_file.lock().unwrap().flush();
    }
}

/// Initialize logging system
pub fn init_logger() {
    let log_path = "logs/net_port_proxy.log";
    
    // Create logs directory if it doesn't exist
    if let Some(parent) = Path::new(log_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    
    if let Err(e) = Logger::init(log_path) {
        eprintln!("Failed to initialize logger: {}", e);
    }
    
    log::info!("Logger initialized successfully");
}

/// Log macros for convenience
#[macro_export]
macro_rules! log_emerg {
    ($($arg:tt)*) => {
        log::error!(target: "proxy", $($arg)*)
    };
}

#[macro_export]
macro_rules! log_alert {
    ($($arg:tt)*) => {
        log::error!(target: "proxy", $($arg)*)
    };
}

#[macro_export]
macro_rules! log_crit {
    ($($arg:tt)*) => {
        log::error!(target: "proxy", $($arg)*)
    };
}

#[macro_export]
macro_rules! log_err {
    ($($arg:tt)*) => {
        log::error!(target: "proxy", $($arg)*)
    };
}

#[macro_export]
macro_rules! log_warning {
    ($($arg:tt)*) => {
        log::warn!(target: "proxy", $($arg)*)
    };
}

#[macro_export]
macro_rules! log_notice {
    ($($arg:tt)*) => {
        log::info!(target: "proxy", $($arg)*)
    };
}

#[macro_export]
macro_rules! log_info {
    ($($arg:tt)*) => {
        log::info!(target: "proxy", $($arg)*)
    };
}

#[macro_export]
macro_rules! log_debug {
    ($($arg:tt)*) => {
        log::debug!(target: "proxy", $($arg)*)
    };
}