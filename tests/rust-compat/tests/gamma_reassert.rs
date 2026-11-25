#![cfg(not(windows))]
//! Reassertion uses the real serialized worker; the 10-second production period
//! is shortened only in this fake-driver host test. No Windows/GPU is exercised.
#[path = "../../../src-tauri/src/gamma_logic.rs"] mod gamma_logic;
#[path = "../../../src-tauri/src/display.rs"] mod display;
mod diag { pub fn log<T: AsRef<str>>(_: T) {} pub fn try_log_panic<T: AsRef<str>>(_: T) {} }

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
fn wait(label: &str, ms: u64, f: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_millis(ms);
    while !f() && Instant::now() < deadline { std::thread::sleep(Duration::from_millis(5)); }
    assert!(f(), "timed out: {label}");
}

#[test]
fn settled_warmth_is_reasserted_recovers_after_panic_and_parks_on_neutral_hold() {
    use display::test_driver as d;
    d::REASSERT_INTERVAL_MS.store(250, Ordering::SeqCst);
    display::set_target(3200, 80);
    wait("warmth settles", 2000, || display::current_kelvin() == 3200);
    let count = d::CALLS.load(Ordering::SeqCst);
    // Model an external reset. This is not evidence of actual Windows behavior.
    d::LAST_NEUTRAL.store(true, Ordering::SeqCst);
    wait("periodic reassert", 1500, || d::CALLS.load(Ordering::SeqCst) > count
        && !d::LAST_NEUTRAL.load(Ordering::SeqCst));
    d::PANIC_NEXT.store(true, Ordering::SeqCst);
    wait("panic on a periodic write", 1500, || !d::PANIC_NEXT.load(Ordering::SeqCst));
    let count = d::CALLS.load(Ordering::SeqCst);
    d::LAST_NEUTRAL.store(true, Ordering::SeqCst);
    wait("reassert resumes after panic", 3000, || d::CALLS.load(Ordering::SeqCst) > count
        && !d::LAST_NEUTRAL.load(Ordering::SeqCst));
    display::hold_neutral_for_fullscreen(80);
    wait("neutral ack", 1500, display::fullscreen_neutral_ready);
    let held = d::CALLS.load(Ordering::SeqCst);
    std::thread::sleep(Duration::from_millis(800)); // > 3 shortened periods
    assert_eq!(d::CALLS.load(Ordering::SeqCst), held, "no reassertion during fullscreen hold");
    assert!(d::LAST_NEUTRAL.load(Ordering::SeqCst));
    assert!(display::stop_and_restore_gamma());
}
