#![cfg(not(windows))]
//! Regression: an unwound/caught panic on an unrelated thread is not an app
//! exit. This runs the production hook and Gamma worker with a fake driver.
//! It does not test Windows crash handling, the GPU, or visual color.

#[path = "../../../src-tauri/src/gamma_logic.rs"] mod gamma_logic;
#[path = "../../../src-tauri/src/display.rs"] mod display;
mod diag { pub fn log<T: AsRef<str>>(_: T) {} pub fn try_log_panic<T: AsRef<str>>(_: T) {} }

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

fn wait(label: &str, f: impl Fn() -> bool) {
    let end = Instant::now() + Duration::from_secs(3);
    while !f() && Instant::now() < end { std::thread::sleep(Duration::from_millis(5)); }
    assert!(f(), "timed out: {label}");
}

#[test]
fn caught_panic_in_another_thread_must_not_neutralize_or_stop_a_healthy_gamma_worker() {
    display::install_panic_hook();
    display::set_target(3300, 100);
    wait("initial warm target", || display::current_kelvin() == 3300);
    assert!(!display::test_driver::LAST_NEUTRAL.load(Ordering::SeqCst));

    let thread = std::thread::spawn(|| std::panic::catch_unwind(|| panic!("caught unrelated panic")));
    assert!(thread.join().unwrap().is_err());
    assert_eq!(display::target_kelvin(), 3300, "an unwind must not erase the requested target");
    assert_eq!(display::current_kelvin(), 3300, "an unwind must not reset a live screen");
    assert!(!display::test_driver::LAST_NEUTRAL.load(Ordering::SeqCst));

    display::set_target(3600, 100);
    wait("gamma still accepts later changes", || display::current_kelvin() == 3600);
    assert!(display::stop_and_restore_gamma());
    assert!(display::test_driver::LAST_NEUTRAL.load(Ordering::SeqCst));
}
