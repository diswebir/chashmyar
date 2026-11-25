#![cfg(not(windows))]
//! Exercise the real Gamma worker and dimming policy with a host-only driver.
//! No Win32 API or physical display is touched. This test is process-isolated
//! because the worker has process-global state and stops permanently at exit.
#[path = "../../../src-tauri/src/gamma_logic.rs"] mod gamma_logic;
#[path = "../../../src-tauri/src/overlay_policy.rs"] mod overlay_policy;
#[path = "../../../src-tauri/src/display.rs"] mod display;
mod diag { pub fn log<T: AsRef<str>>(_: T) {} pub fn try_log_panic<T: AsRef<str>>(_: T) {} }

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

fn until(what: &str, done: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !done() {
        assert!(Instant::now() < deadline, "timed out: {what}");
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn intermittent_gamma_failure_never_enables_a_warmth_overlay() {
    use display::test_driver as driver;
    display::set_target(4500, 100);
    until("initial Gamma write", || display::current_kelvin() == 4500 && display::last_gamma_result() == (true, true));
    assert!(!driver::LAST_NEUTRAL.load(Ordering::SeqCst));
    assert!(!overlay_policy::needs_overlay(true, false, 100));

    // The old warm LUT remains in this fake when the next write is rejected.
    // No orange fallback is allowed to stack on it, at any requested Kelvin.
    driver::FAIL.store(true, Ordering::SeqCst);
    display::set_target(3000, 100);
    until("Gamma rejection", || display::last_gamma_result() == (false, false));
    assert_eq!(display::target_kelvin(), 3000);
    assert_eq!(display::current_kelvin(), 4500);
    assert!(!driver::LAST_NEUTRAL.load(Ordering::SeqCst));
    assert!(!overlay_policy::needs_overlay(true, false, 100));
    assert!(overlay_policy::needs_overlay(true, false, 82), "dimming is still independent");

    // A changed target wakes the hardware retry. There is still no warmth
    // fallback before, during or after the driver resumes reporting success.
    driver::FAIL.store(false, Ordering::SeqCst);
    display::set_target(3100, 100);
    until("Gamma recovery", || display::current_kelvin() == 3100 && display::last_gamma_result() == (true, true));
    assert!(!overlay_policy::needs_overlay(true, false, 100));
    assert!(overlay_policy::needs_overlay(true, false, 82));

    // A single accepted call must not hide another call's rejection in the UI.
    // Partial failure also cannot summon software warmth.
    driver::PARTIAL.store(true, Ordering::SeqCst);
    display::set_target(3600, 100);
    until("partial Gamma failure", || display::last_gamma_result() == (true, false));
    assert!(!overlay_policy::needs_overlay(true, false, 100));
    assert!(overlay_policy::needs_overlay(true, false, 82));
    driver::PARTIAL.store(false, Ordering::SeqCst);

    driver::FAIL.store(true, Ordering::SeqCst);
    display::set_target(4200, 100);
    until("second Gamma rejection", || display::last_gamma_result() == (false, false));
    assert_eq!(display::target_kelvin(), 4200);
    assert!(!overlay_policy::needs_overlay(true, false, 100));
    driver::FAIL.store(false, Ordering::SeqCst);
    assert!(display::stop_and_restore_gamma());
    assert!(driver::LAST_NEUTRAL.load(Ordering::SeqCst));
}
