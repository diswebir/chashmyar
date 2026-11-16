//! Serial full-screen Magnification API worker.
//!
//! Never initialize the API on a default/off installation. All Win32 calls
//! happen on this one thread; the runtime mutex is not held while they run.
//! Refreshes only publish a target. Identical snapshots cause no writes.

use std::sync::{Condvar, Mutex};
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::Duration;

use crate::color_vision::{Profile, Status, Target};
#[cfg(any(windows, test))]
use crate::color_vision::Controller;

struct Control {
    target: Target,
    revision: u64,
    retries: u64,
    started: bool,
    stopped: bool,
    done: bool,
    shutdown_ok: bool,
}

static CONTROL: Mutex<Control> = Mutex::new(Control {
    target: Target::OFF, revision: 0, retries: 0, started: false,
    stopped: false, done: false, shutdown_ok: true,
});
static WAKE: Condvar = Condvar::new();
static STATUS: AtomicU8 = AtomicU8::new(Status::Off as u8);

fn lock_control() -> std::sync::MutexGuard<'static, Control> {
    CONTROL.lock().unwrap_or_else(|poison| poison.into_inner())
}
fn set_status(status: Status) { STATUS.store(status as u8, Ordering::SeqCst); }
pub fn status() -> Status { Status::from_u8(STATUS.load(Ordering::SeqCst)) }
fn inactive_status(target: Target) -> Status {
    if target.profile != Profile::Off && target.strength > 0 && target.paused { Status::Paused }
    else { Status::Off }
}

/// Publish the latest desired target; coalesce rapid profile/slider updates.
pub fn set_target(profile: Profile, strength: u32, paused: bool) {
    let target = Target::new(profile, strength, paused);
    let mut ctl = lock_control();
    if ctl.stopped || ctl.target == target { return; }
    ctl.target = target;
    ctl.revision = ctl.revision.saturating_add(1);
    if ctl.started {
        set_status(Status::Pending);
        WAKE.notify_all();
    } else if target.wants_effect() {
        #[cfg(any(windows, test))]
        {
            ctl.started = true;
            set_status(Status::Pending);
            if std::thread::Builder::new().name("chashmyar-color-vision".into()).spawn(worker).is_err() {
                ctl.started = false;
                set_status(Status::Error);
            }
        }
        #[cfg(all(not(windows), not(test)))]
        set_status(Status::Unsupported);
    } else {
        set_status(inactive_status(target));
    }
}

/// Explicitly retry after a conflicting effect has been turned off.
pub fn retry() {
    let mut ctl = lock_control();
    if ctl.stopped || !ctl.target.wants_effect() { return; }
    // A rare thread-creation failure must also be recoverable on retry.
    if !ctl.started {
        #[cfg(any(windows, test))]
        {
            ctl.started = true;
            set_status(Status::Pending);
            if std::thread::Builder::new().name("chashmyar-color-vision".into()).spawn(worker).is_err() {
                ctl.started = false;
                set_status(Status::Error);
            }
        }
        return;
    }
    ctl.retries = ctl.retries.saturating_add(1);
    ctl.revision = ctl.revision.saturating_add(1);
    set_status(Status::Pending);
    WAKE.notify_all();
}

#[cfg(any(windows, test))]
fn worker() {
    let mut controller = Controller::new(native::NativeBackend);
    let mut seen_retries = 0;
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| loop {
        let (target, revision, retries) = {
            let ctl = lock_control();
            if ctl.stopped { break; }
            (ctl.target, ctl.revision, ctl.retries)
        };
        let status = controller.step(target, retries != seen_retries);
        seen_retries = retries;
        let ctl = lock_control();
        if ctl.stopped { break; }
        if ctl.revision != revision { continue; } // stale operation: process latest immediately
        set_status(status);
        if matches!(status, Status::Active | Status::Error | Status::RestoreError) {
            // Detect external takeovers and retry recoverable failures, but do
            // not reassert over a conflicting writer.
            drop(WAKE.wait_timeout(ctl, Duration::from_secs(2)).unwrap_or_else(|e| e.into_inner()));
        } else {
            drop(WAKE.wait(ctl).unwrap_or_else(|e| e.into_inner()));
        }
    }));
    let shutdown_ok = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| controller.shutdown()))
        .unwrap_or(false);
    if result.is_err() || !shutdown_ok { crate::diag::log("color vision worker or restoration failed"); }
    let mut ctl = lock_control();
    ctl.done = true;
    ctl.stopped = true;
    ctl.shutdown_ok = shutdown_ok && result.is_ok();
    if !ctl.shutdown_ok { set_status(Status::RestoreError); }
    WAKE.notify_all();
}

/// Stop before the app exits; wait for any in-flight write to finish and the
/// guarded restore to run. A timeout remains a reported, best-effort failure.
pub fn stop_and_restore() -> bool {
    let ctl = lock_control();
    if !ctl.started { return true; }
    let mut ctl = ctl;
    ctl.stopped = true;
    WAKE.notify_all();
    let (ctl, _) = WAKE.wait_timeout_while(ctl, Duration::from_secs(3), |state| !state.done)
        .unwrap_or_else(|e| e.into_inner());
    ctl.done && ctl.shutdown_ok
}

/// Panic hooks cannot wait or acquire a lock already held on the panic thread.
/// If available, ask the worker to restore; process crashes remain best effort.
pub fn panic_stop() {
    if let Ok(mut ctl) = CONTROL.try_lock() {
        ctl.stopped = true;
        WAKE.notify_all();
    }
}

// Native API is compiled in production Windows builds. Unit tests on every
// host use the fake below; the standalone rustc harness has no Cargo externs.
#[cfg(all(windows, not(test)))]
mod native {
    use crate::color_vision::{pack_matrix, unpack_matrix, Backend, Matrix};
    use windows::Win32::UI::Magnification::{
        MagGetFullscreenColorEffect, MagGetFullscreenTransform, MagInitialize,
        MagSetFullscreenColorEffect, MagUninitialize, MAGCOLOREFFECT,
    };

    pub struct NativeBackend;
    impl Backend for NativeBackend {
        fn initialize(&mut self) -> bool { unsafe { MagInitialize().as_bool() } }
        fn get(&mut self) -> Option<Matrix> {
            let mut effect = MAGCOLOREFFECT { transform: [0.0; 25] };
            unsafe { if MagGetFullscreenColorEffect(&mut effect).as_bool() { Some(unpack_matrix(&effect.transform)) } else { None } }
        }
        fn set(&mut self, matrix: &Matrix) -> bool {
            let effect = MAGCOLOREFFECT { transform: pack_matrix(matrix) };
            unsafe { MagSetFullscreenColorEffect(&effect).as_bool() }
        }
        fn safe_to_uninitialize(&mut self) -> bool {
            let (mut zoom, mut x, mut y) = (0.0_f32, 0_i32, 0_i32);
            let ok = unsafe { MagGetFullscreenTransform(&mut zoom, &mut x, &mut y).as_bool() };
            ok && (zoom - 1.0).abs() < 0.00001
        }
        fn uninitialize(&mut self) -> bool { unsafe { MagUninitialize().as_bool() } }
    }
}

// Fake driver for a concurrency test of the actual worker on every host. Never
// included in product builds; it does not claim to represent Win32 behavior.
#[cfg(test)]
pub(crate) mod native {
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::time::Duration;
    use crate::color_vision::{Backend, Matrix, IDENTITY};

    pub static CURRENT: Mutex<Matrix> = Mutex::new(IDENTITY);
    pub static DELAY_MS: AtomicU32 = AtomicU32::new(0);
    pub static IN_WRITE: AtomicBool = AtomicBool::new(false);
    pub struct NativeBackend;
    impl Backend for NativeBackend {
        fn initialize(&mut self) -> bool { true }
        fn get(&mut self) -> Option<Matrix> { Some(*CURRENT.lock().unwrap()) }
        fn set(&mut self, matrix: &Matrix) -> bool {
            IN_WRITE.store(true, Ordering::SeqCst);
            let delay = DELAY_MS.load(Ordering::SeqCst);
            if delay > 0 { std::thread::sleep(Duration::from_millis(delay as u64)); }
            *CURRENT.lock().unwrap() = *matrix;
            IN_WRITE.store(false, Ordering::SeqCst);
            true
        }
        fn uninitialize(&mut self) -> bool { true }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color_vision::{same_matrix, IDENTITY};
    use std::time::Instant;
    fn wait_until(condition: impl Fn() -> bool) {
        let start = Instant::now();
        while !condition() {
            assert!(start.elapsed() < Duration::from_secs(5), "worker timed out");
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    #[test]
    fn serial_worker_coalesces_pause_and_stops_after_in_flight_write() {
        use native::*;
        set_target(Profile::Deuteranopia, 60, false);
        wait_until(|| status() == Status::Active);
        assert!(!same_matrix(&CURRENT.lock().unwrap(), &IDENTITY));
        let mut external = IDENTITY;
        external[0][0] = 0.5;
        *CURRENT.lock().unwrap() = external;
        wait_until(|| status() == Status::Conflict);
        assert!(same_matrix(&CURRENT.lock().unwrap(), &external));
        *CURRENT.lock().unwrap() = IDENTITY;
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(status(), Status::Conflict, "no unsolicited reassertion after a takeover");
        retry();
        wait_until(|| status() == Status::Active);
        set_target(Profile::Deuteranopia, 60, true);
        wait_until(|| status() == Status::Paused);
        assert!(same_matrix(&CURRENT.lock().unwrap(), &IDENTITY));
        set_target(Profile::Deuteranopia, 60, false);
        wait_until(|| status() == Status::Active);
        DELAY_MS.store(150, Ordering::SeqCst);
        set_target(Profile::Tritanopia, 75, false);
        wait_until(|| IN_WRITE.load(Ordering::SeqCst));
        assert!(stop_and_restore());
        assert!(same_matrix(&CURRENT.lock().unwrap(), &IDENTITY));
        // No queued change can put a filter back after shutdown returns.
        set_target(Profile::Protanopia, 100, false);
        std::thread::sleep(Duration::from_millis(200));
        assert!(same_matrix(&CURRENT.lock().unwrap(), &IDENTITY));
    }
}
