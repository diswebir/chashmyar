//! Lightweight startup / runtime diagnostics.
//!
//! Runtime diagnostics live in `%LOCALAPPDATA%\ChashmYar\startup.log`.
//! A new launch appends a session header instead of erasing the last session.
//! When the file exceeds the limit it is moved to `startup.previous.log`.
//! The two files are bounded on a best-effort basis; disk/rename errors can
//! prevent rotation. No foreground window names or titles are logged.

use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock, TryLockError};

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
static LOG_LOCK: Mutex<()> = Mutex::new(());
const LOG_LIMIT: u64 = 262_144;

fn base_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("APPDATA"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}

pub fn log_dir() -> PathBuf {
    LOG_DIR
        .get_or_init(|| {
            let dir = base_dir().join("ChashmYar");
            let _ = std::fs::create_dir_all(&dir);
            dir
        })
        .clone()
}

pub fn log_path() -> PathBuf {
    log_dir().join("startup.log")
}

/// A second process/launch must not erase evidence from the previous one.
pub fn init() {
    log(format!(
        "SESSION START v{} exe={}",
        env!("CARGO_PKG_VERSION"),
        std::env::current_exe()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| "?".into()),
    ));
}

// Caller holds LOG_LOCK. Never discard the current log if rotation fails.
fn write_line(message: &str) {
    let path = log_path();
    if std::fs::metadata(&path).is_ok_and(|meta| meta.len() > LOG_LIMIT) {
        let previous = log_dir().join("startup.previous.log");
        // Rust's rename replaces an existing file where supported. Do not
        // pre-delete the previous log: if replacement fails (e.g. a sharing or
        // filesystem error), retain both files and keep appending to current.
        // Different processes do not share LOG_LOCK; rotation is best effort.
        let _ = std::fs::rename(&path, &previous);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        // Format first so a normal append is one write, rather than a series
        // of formatting writes that can interleave with another process. An
        // I/O error or partial write still cannot be ruled out across systems.
        let line = format!("[{} pid={}] {}\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
            std::process::id(), message);
        let _ = file.write_all(line.as_bytes());
    }
}

pub fn log(message: impl AsRef<str>) {
    let _guard = LOG_LOCK.lock().unwrap_or_else(|poison| poison.into_inner());
    write_line(message.as_ref());
}

/// Panic hooks may run while this same thread holds LOG_LOCK. Never wait there.
/// The watchdog still handles an actual process death if logging is unavailable.
pub fn try_log_panic(message: impl AsRef<str>) {
    match LOG_LOCK.try_lock() {
        Ok(_guard) => write_line(message.as_ref()),
        Err(TryLockError::Poisoned(poison)) => { let _guard = poison.into_inner(); write_line(message.as_ref()); }
        Err(TryLockError::WouldBlock) => {}
    }
}

/// Last-resort native message box for failures that happen before/while the
/// webview exists (a GUI-subsystem binary has no console to print to).
pub fn fatal_box(message: &str) {
    log(format!("FATAL: {message}"));
    #[cfg(windows)]
    {
        use windows::core::HSTRING;
        use windows::Win32::UI::WindowsAndMessaging::{
            MessageBoxW, MB_ICONERROR, MB_OK, MB_SETFOREGROUND,
        };
        let text = HSTRING::from(message);
        let title = HSTRING::from("ChashmYar — خطای اجرا");
        let _ = unsafe { MessageBoxW(None, &text, &title, MB_OK | MB_ICONERROR | MB_SETFOREGROUND) };
    }
}

/// Opens the log folder in Explorer (used by the settings panel).
pub fn reveal_log_folder() {
    let dir = log_dir();
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer.exe").arg(dir).spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
    }
}
