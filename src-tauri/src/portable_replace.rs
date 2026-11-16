//! In-place portable update. Only bytes already verified by the Tauri updater
//! may reach this module. No shell or batch file is used, and application data
//! is never touched. Windows ReplaceFileW keeps a same-directory backup.
use std::ffi::OsString;
use std::path::{Path, PathBuf};

const WAIT_FLAG: &str = "--chashmyar-update-wait";

#[cfg(all(windows, not(test)))]
fn log(message: String) { crate::diag::log(message); }
#[cfg(all(windows, test))]
fn log(_message: String) {}

fn valid_token(token: &str) -> bool {
    !token.is_empty() && token.len() <= 39 && token.bytes().all(|c| c.is_ascii_digit())
}

fn sibling(exe: &Path, suffix: &str) -> Result<PathBuf, String> {
    let name = exe.file_name().ok_or("Executable has no filename")?;
    let parent = exe.parent().ok_or("Executable has no parent folder")?;
    let mut filename = OsString::from(name);
    filename.push(suffix);
    Ok(parent.join(filename))
}

fn update_paths(exe: &Path, pid: u32, nonce: &str) -> Result<(PathBuf, PathBuf), String> {
    if pid == 0 || !valid_token(nonce) { return Err("Invalid update token".into()); }
    Ok((
        sibling(exe, &format!(".chashmyar-update-{pid}-{nonce}.tmp"))?,
        sibling(exe, &format!(".chashmyar-backup-{pid}-{nonce}"))?,
    ))
}

#[cfg(windows)]
fn replace_file(original: &Path, replacement: &Path, backup: &Path) -> std::io::Result<()> {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn ReplaceFileW(original: *const u16, replacement: *const u16, backup: *const u16,
                        flags: u32, exclude: *mut c_void, reserved: *mut c_void) -> i32;
    }
    fn wide(path: &Path) -> Vec<u16> { path.as_os_str().encode_wide().chain(Some(0)).collect() }
    let (original, replacement, backup) = (wide(original), wide(replacement), wide(backup));
    // No IGNORE_ACL/MERGE flags: fail rather than silently change permissions.
    let ok = unsafe { ReplaceFileW(original.as_ptr(), replacement.as_ptr(), backup.as_ptr(), 0,
                                    std::ptr::null_mut(), std::ptr::null_mut()) };
    if ok != 0 { Ok(()) } else { Err(std::io::Error::last_os_error()) }
}

#[cfg(windows)]
fn stage_and_replace(exe: &Path, bytes: &[u8], pid: u32, nonce: &str) -> Result<PathBuf, String> {
    use std::fs::{self, OpenOptions};
    use std::io::Write;
    let (stage, backup) = update_paths(exe, pid, nonce)?;
    // Do not overwrite any pre-existing backup, including a dangling symlink.
    if fs::symlink_metadata(&backup).is_ok() { return Err("Update backup name already exists".into()); }
    let mut file = OpenOptions::new().write(true).create_new(true).open(&stage)
        .map_err(|e| format!("Cannot write next to portable executable: {e}"))?;
    if let Err(e) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&stage);
        return Err(format!("Cannot save portable update: {e}"));
    }
    drop(file);
    if let Err(e) = replace_file(exe, &stage, &backup) {
        // ReplaceFileW can report an ambiguous failure (e.g. ERROR 1177).
        // Restore only if the original name is missing; otherwise preserve the
        // backup for manual recovery and never overwrite a file blindly.
        if !exe.exists() && backup.exists() {
            if let Err(restore) = fs::rename(&backup, exe) {
                return Err(format!("Replacement failed ({e}); restore the backup at {} ({restore})", backup.display()));
            }
        }
        if exe.exists() { let _ = fs::remove_file(&stage); }
        return Err(format!("Windows could not replace the portable file: {e}"));
    }
    Ok(backup)
}

#[cfg(windows)]
fn rollback_after_spawn_failure(exe: &Path, backup: &Path, pid: u32, nonce: &str) -> Result<(), String> {
    use std::fs;
    let rejected = sibling(exe, &format!(".chashmyar-rejected-{pid}-{nonce}"))?;
    if fs::symlink_metadata(&rejected).is_ok() { return Err("Rollback name already exists".into()); }
    fs::rename(exe, &rejected).map_err(|e| format!("Could not move the new file aside: {e}"))?;
    if let Err(e) = fs::rename(backup, exe) {
        // Best effort to keep the original launch path populated, and preserve
        // the old backup untouched for a manual recovery.
        if !exe.exists() { let _ = fs::rename(&rejected, exe); }
        return Err(format!("Could not restore {}: {e}", backup.display()));
    }
    let _ = fs::remove_file(rejected);
    Ok(())
}

/// Called only after the user confirms and signature verification succeeds.
/// Returns only after the new process has been spawned; the caller must then
/// restore gamma/unlock the keyboard and exit so the child can continue.
#[cfg(windows)]
pub fn install_and_start(bytes: &[u8]) -> Result<(), String> {
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let pid = std::process::id();
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos().to_string();
    let backup = stage_and_replace(&exe, bytes, pid, &nonce)?;
    match Command::new(&exe).arg(WAIT_FLAG).arg(pid.to_string()).arg(&nonce).spawn() {
        Ok(_) => Ok(()),
        Err(e) => match rollback_after_spawn_failure(&exe, &backup, pid, &nonce) {
            Ok(()) => Err(format!("Updated app could not start; the previous file was restored: {e}")),
            Err(rollback) => Err(format!("Updated app could not start ({e}); backup retained at {}. {rollback}", backup.display())),
        },
    }
}

#[cfg(windows)]
fn wait_for_process(pid: u32) -> Result<(), String> {
    use std::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
        fn WaitForSingleObject(handle: *mut c_void, milliseconds: u32) -> u32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }
    if pid == 0 || pid == std::process::id() { return Err("Invalid previous process".into()); }
    const SYNCHRONIZE: u32 = 0x0010_0000;
    let handle = unsafe { OpenProcess(SYNCHRONIZE, 0, pid) };
    if handle.is_null() {
        let error = std::io::Error::last_os_error();
        // ERROR_INVALID_PARAMETER: the old process already exited.
        return if error.raw_os_error() == Some(87) { Ok(()) } else { Err(format!("Cannot wait for previous app: {error}")) };
    }
    let result = unsafe { WaitForSingleObject(handle, 120_000) };
    unsafe { CloseHandle(handle); }
    if result == 0 { Ok(()) } else { Err(format!("Previous app did not exit (wait result {result})")) }
}

#[cfg(windows)]
static PENDING_BACKUP: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Before Tauri and the single-instance plugin initialize, wait for the old
/// process. A failed wait exits without deleting the backup or starting hooks.
#[cfg(windows)]
pub fn wait_before_startup() {
    let args: Vec<OsString> = std::env::args_os().collect();
    if args.get(1).and_then(|s| s.to_str()) != Some(WAIT_FLAG) { return; }
    let parsed = (|| -> Result<PathBuf, String> {
        if args.len() != 4 { return Err("Invalid update restart arguments".into()); }
        let pid = args[2].to_str().ok_or("Invalid process id")?.parse::<u32>().map_err(|_| "Invalid process id")?;
        let nonce = args[3].to_str().ok_or("Invalid update token")?;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let (_, backup) = update_paths(&exe, pid, nonce)?;
        wait_for_process(pid)?;
        Ok(backup)
    })();
    match parsed {
        Ok(backup) => { let _ = PENDING_BACKUP.set(backup); }
        Err(error) => {
            log(format!("portable update restart failed: {error}"));
            std::process::exit(3);
        }
    }
}

/// Delete only the exact backup from this restart, after setup succeeded.
/// Locked backup files are retried briefly and otherwise preserved.
#[cfg(windows)]
pub fn cleanup_after_successful_start() {
    if let Some(backup) = PENDING_BACKUP.get().cloned() {
        std::thread::spawn(move || {
            for _ in 0..10 {
                match std::fs::remove_file(&backup) {
                    Ok(()) => return,
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
                    Err(_) => std::thread::sleep(std::time::Duration::from_secs(1)),
                }
            }
            log(format!("portable update backup retained: {}", backup.display()));
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_are_siblings_and_tokens_are_strict() {
        let exe = Path::new("folder/نام برنامه.exe");
        let (stage, backup) = update_paths(exe, 123, "456").unwrap();
        assert_eq!(stage.parent(), exe.parent());
        assert_eq!(backup.parent(), exe.parent());
        assert!(stage.to_string_lossy().contains("نام برنامه.exe.chashmyar-update-123-456.tmp"));
        assert!(backup.to_string_lossy().contains("نام برنامه.exe.chashmyar-backup-123-456"));
        for bad in ["", "../x", "1/2", "-1", "x", "1234567890123456789012345678901234567890"] {
            assert!(update_paths(exe, 1, bad).is_err());
        }
        assert!(update_paths(exe, 0, "1").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn windows_running_image_can_be_replaced_with_backup() {
        use std::fs;
        use std::process::Command;
        if std::env::var_os("CHASHMYAR_SWAP_TEST_CHILD").is_some() {
            let exe = std::env::current_exe().unwrap();
            let old = fs::read(&exe).unwrap();
            let backup = stage_and_replace(&exe, &old, std::process::id(), "42").unwrap();
            assert_eq!(fs::read(&exe).unwrap(), old);
            assert_eq!(fs::read(&backup).unwrap(), old);
            return;
        }
        let dir = std::env::temp_dir().join(format!("chashmyar-running-swap-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let copy = dir.join("نام portable with spaces.exe");
        fs::copy(std::env::current_exe().unwrap(), &copy).unwrap();
        let result = Command::new(&copy)
            .args(["--exact", "tests::windows_running_image_can_be_replaced_with_backup", "--nocapture"])
            .env("CHASHMYAR_SWAP_TEST_CHILD", "1").status().unwrap();
        assert!(result.success(), "the child must replace its running image");
        assert!(fs::read_dir(&dir).unwrap().any(|entry| entry.unwrap().file_name().to_string_lossy().contains(".chashmyar-backup-")));
        fs::remove_dir_all(dir).unwrap();
    }
}
