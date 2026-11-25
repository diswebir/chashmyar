#![cfg(not(windows))]
//! Production logger exercised in a temporary directory, not the real user log.
#[path = "../../../src-tauri/src/diag.rs"] mod diag;

#[test]
fn a_second_launch_keeps_the_previous_session_in_the_bounded_log() {
    if std::env::var_os("CHASHMYAR_DIAG_CHILD").is_some() {
        for i in 0..140 {
            diag::log(format!("crossproc_{}_{}:{}", std::process::id(), i, "z".repeat(64)));
        }
        return;
    }
    let dir = std::env::temp_dir().join(format!("chashmyar-log-retention-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::env::set_var("LOCALAPPDATA", &dir);
    diag::init();
    diag::log("unique-first-session-evidence");
    diag::init();
    diag::log("unique-second-session-evidence");
    let contents = std::fs::read_to_string(diag::log_path()).unwrap();
    assert!(contents.contains("unique-first-session-evidence"), "a later launch erased the previous evidence");
    assert!(contents.contains("unique-second-session-evidence"));
    let workers: Vec<_> = (0..8).map(|_| std::thread::spawn(|| {
        for _ in 0..30 { diag::log("worker-entry"); }
    })).collect();
    for worker in workers { worker.join().unwrap(); }
    let contents = std::fs::read_to_string(diag::log_path()).unwrap();
    assert_eq!(contents.matches("worker-entry").count(), 240, "concurrent appends remain intact");
    // A second launch and the watchdog can append in distinct processes. This
    // probes line integrity without rotation; cross-process rotation itself is
    // still deliberately documented as best effort.
    let executable = std::env::current_exe().unwrap();
    let mut children: Vec<_> = (0..8).map(|_| std::process::Command::new(&executable)
        .args(["--exact", "a_second_launch_keeps_the_previous_session_in_the_bounded_log"])
        .env("CHASHMYAR_DIAG_CHILD", "1")
        .env("LOCALAPPDATA", &dir)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn().unwrap()).collect();
    for child in &mut children { assert!(child.wait().unwrap().success()); }
    let contents = std::fs::read_to_string(diag::log_path()).unwrap();
    let entries: Vec<_> = contents.lines().filter(|line| line.contains("crossproc_")).collect();
    assert_eq!(entries.len(), 8 * 140, "cross-process entries must remain separate lines");
    for entry in entries {
        assert!(entry.starts_with('[') && entry.ends_with(&"z".repeat(64)));
        assert_eq!(entry.matches("crossproc_").count(), 1);
    }
    // Rotation retains the previous file rather than truncating it.
    diag::log("x".repeat(263_000));
    diag::log("after-rotation");
    let previous = std::fs::read_to_string(diag::log_dir().join("startup.previous.log")).unwrap();
    assert!(previous.contains("unique-first-session-evidence"));
    assert!(std::fs::read_to_string(diag::log_path()).unwrap().contains("after-rotation"));
    let _ = std::fs::remove_dir_all(dir);
}
