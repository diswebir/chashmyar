#![cfg(not(windows))]
//! Fault injection into the actual Gamma interpolation worker. The backend is
//! fake; this is not a Windows, WebView2, GPU, or physical-display test.

#[path = "../../../src-tauri/src/gamma_logic.rs"] mod gamma_logic;
#[path = "../../../src-tauri/src/display.rs"] mod display;
mod diag { pub fn log<T: AsRef<str>>(_: T) {} pub fn try_log_panic<T: AsRef<str>>(_: T) {} }

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

fn wait(label: &str, timeout: Duration, f: impl Fn() -> bool) {
    let end = Instant::now() + timeout;
    while !f() && Instant::now() < end { std::thread::sleep(Duration::from_millis(5)); }
    assert!(f(), "timed out: {label}");
}

#[test]
fn transient_worker_panic_must_not_permanently_disable_later_gamma_updates() {
    use display::test_driver as d;
    display::set_target(4200, 100);
    wait("initial warm target", Duration::from_secs(3), || display::current_kelvin() == 4200);
    let before = d::CALLS.load(Ordering::SeqCst);
    d::PANIC_NEXT.store(true, Ordering::SeqCst);
    display::set_target(3000, 100);
    wait("the injected panic was reached", Duration::from_secs(2), || {
        d::CALLS.load(Ordering::SeqCst) > before && !d::PANIC_NEXT.load(Ordering::SeqCst)
    });
    wait("worker recovered the requested target", Duration::from_secs(5), || display::current_kelvin() == 3000);
    assert!(!d::LAST_NEUTRAL.load(Ordering::SeqCst));
    display::set_target(3900, 100);
    wait("recovered worker processes a later change", Duration::from_secs(3), || display::current_kelvin() == 3900);
    assert!(display::stop_and_restore_gamma());
}
