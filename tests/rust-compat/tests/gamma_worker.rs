#![cfg(not(windows))]
//! Exercise the actual display worker with a host-only fake driver. This is not
//! a Windows, GPU, visual, HDR, or capture test.

#[path = "../../../src-tauri/src/gamma_logic.rs"]
mod gamma_logic;
#[path = "../../../src-tauri/src/display.rs"]
mod display;
mod diag { pub fn log<T: AsRef<str>>(_message: T) {} }

use std::sync::atomic::Ordering;
use std::thread;
use std::time::{Duration, Instant};

fn until(message: &str, timeout_ms: u64, f: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    while !f() && Instant::now() < deadline { thread::sleep(Duration::from_millis(5)); }
    assert!(f(), "timed out: {message}");
}

#[test]
fn worker_parks_retries_and_restores_after_an_inflight_write() {
    use display::test_driver as d;
    display::set_target(4200, 250);
    until("initial linear transition", 1500, || display::current_kelvin() == 4200);
    assert!(display::gamma_available());
    // Give the final 100ms worker timer time to expire before measuring idle.
    thread::sleep(Duration::from_millis(170));
    let idle_calls = d::CALLS.load(Ordering::SeqCst);
    thread::sleep(Duration::from_millis(350));
    assert_eq!(d::CALLS.load(Ordering::SeqCst), idle_calls, "no driver writes while settled");

    d::FAIL.store(true, Ordering::SeqCst);
    let before_failure = d::CALLS.load(Ordering::SeqCst);
    display::set_target(3000, 250);
    until("failed driver reported", 900, || !display::gamma_available());
    thread::sleep(Duration::from_millis(500));
    let failed_calls = d::CALLS.load(Ordering::SeqCst) - before_failure;
    assert!(failed_calls <= 2, "failed driver must not spin every 100ms: {failed_calls}");
    // An updated target wakes a backoff immediately rather than waiting 2 s.
    d::FAIL.store(false, Ordering::SeqCst);
    display::set_target(3100, 250);
    until("retarget wakes failed worker", 1500, || display::current_kelvin() == 3100);
    assert!(display::gamma_available());

    // Arrange a warm write already in progress when shutdown begins. The
    // serialized neutral write must be the last successful driver operation.
    d::DELAY_MS.store(250, Ordering::SeqCst);
    display::set_target(4500, 250);
    until("warm write entered fake driver", 1200, || d::IN_FLIGHT.load(Ordering::SeqCst));
    assert!(display::stop_and_restore_gamma());
    assert_eq!(display::current_kelvin(), 6500);
    assert!(d::LAST_NEUTRAL.load(Ordering::SeqCst));
    let stopped_calls = d::CALLS.load(Ordering::SeqCst);
    d::DELAY_MS.store(0, Ordering::SeqCst);
    display::set_target(2800, 250); // ignored permanently after shutdown
    thread::sleep(Duration::from_millis(400));
    assert_eq!(d::CALLS.load(Ordering::SeqCst), stopped_calls, "no stale warm write after shutdown");
    assert_eq!(display::current_kelvin(), 6500);
}
