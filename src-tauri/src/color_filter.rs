//! Serial full-screen Magnification API worker.
//!
//! Never initialize the API on a default/off installation. All Win32 calls
//! happen on this one thread; the runtime mutex is not held while they run.
//! Refreshes only publish a target. Identical snapshots cause no writes.

use std::sync::{Condvar, Mutex};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::time::Duration;

use crate::color_vision::{Profile, ScreenTarget, Status, Target};
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
static SCREEN_STATUS: AtomicU8 = AtomicU8::new(Status::Off as u8);
// True during acquisition and while our owned matrix contains the screen
// effect. Suppress the overlay during that handoff to avoid double dimming.
// On explicit failure/takeover it becomes false so the old overlay is used.
static SCREEN_COVERED: AtomicBool = AtomicBool::new(false);

fn lock_control() -> std::sync::MutexGuard<'static, Control> {
    CONTROL.lock().unwrap_or_else(|poison| poison.into_inner())
}
fn set_status(target: Target, status: Status) {
    let vision = if status == Status::RestoreError { status }
        else if target.profile == Profile::Off || target.strength == 0 { Status::Off }
        else if status == Status::Pending { Status::Pending }
        else if target.paused { Status::Paused } else { status };
    let screen = if status == Status::RestoreError { status }
        else if target.screen.wants_effect() || SCREEN_COVERED.load(Ordering::SeqCst) { status }
        else { Status::Off };
    STATUS.store(vision as u8, Ordering::SeqCst);
    SCREEN_STATUS.store(screen as u8, Ordering::SeqCst);
}
pub fn status() -> Status { Status::from_u8(STATUS.load(Ordering::SeqCst)) }
pub fn screen_status() -> Status { Status::from_u8(SCREEN_STATUS.load(Ordering::SeqCst)) }
pub fn screen_covers_overlay() -> bool { SCREEN_COVERED.load(Ordering::SeqCst) }
fn inactive_status(target: Target) -> Status {
    if target.profile != Profile::Off && target.strength > 0 && target.paused { Status::Paused }
    else { Status::Off }
}

/// Publish both independent controls atomically: there is only one Windows
/// fullscreen matrix and it must never be claimed by two separate workers.
pub fn set_target(profile: Profile, strength: u32, paused: bool, screen: ScreenTarget) {
    let target = Target::new(profile, strength, paused).with_screen(screen);
    let mut ctl = lock_control();
    if ctl.stopped || ctl.target == target { return; }
    ctl.target = target;
    ctl.revision = ctl.revision.saturating_add(1);
    if target.screen.wants_effect() { SCREEN_COVERED.store(true, Ordering::SeqCst); }
    if ctl.started {
        set_status(target, Status::Pending);
        WAKE.notify_all();
    } else if target.wants_effect() {
        #[cfg(any(windows, test))]
        {
            ctl.started = true;
            set_status(target, Status::Pending);
            if std::thread::Builder::new().name("chashmyar-fullscreen-color".into()).spawn(worker).is_err() {
                ctl.started = false;
                SCREEN_COVERED.store(false, Ordering::SeqCst);
                set_status(target, Status::Error);
            }
        }
        #[cfg(all(not(windows), not(test)))]
        {
            SCREEN_COVERED.store(false, Ordering::SeqCst);
            set_status(target, Status::Unsupported);
        }
    } else {
        set_status(target, inactive_status(target));
    }
}

/// Explicitly retry after a conflicting effect has been turned off.
pub fn retry() {
    let mut ctl = lock_control();
    if ctl.stopped || !ctl.target.wants_effect() { return; }
    // Never restart an unowned screen acquisition directly: gamma might already
    // be returning. The handoff must first neutralize it, then republish the
    // screen target. An owned/pending screen effect is already protected.
    if ctl.target.screen.wants_effect() && !SCREEN_COVERED.load(Ordering::SeqCst) { return; }
    // A rare thread-creation failure on a vision-only target remains retryable.
    if ctl.target.screen.wants_effect() { SCREEN_COVERED.store(true, Ordering::SeqCst); }
    if !ctl.started {
        #[cfg(any(windows, test))]
        {
            ctl.started = true;
            set_status(ctl.target, Status::Pending);
            if std::thread::Builder::new().name("chashmyar-fullscreen-color".into()).spawn(worker).is_err() {
                ctl.started = false;
                SCREEN_COVERED.store(false, Ordering::SeqCst);
                set_status(ctl.target, Status::Error);
            }
        }
        #[cfg(all(not(windows), not(test)))]
        SCREEN_COVERED.store(false, Ordering::SeqCst);
        return;
    }
    ctl.retries = ctl.retries.saturating_add(1);
    ctl.revision = ctl.revision.saturating_add(1);
    set_status(ctl.target, Status::Pending);
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
        // Publish the actual last-owned state even after a stale operation. If
        // a newer screen acquisition is queued keep the overlay suppressed
        // until that operation resolves; otherwise an old write could double it.
        let pending_screen = ctl.revision != revision && ctl.target.screen.wants_effect();
        SCREEN_COVERED.store(controller.owns_screen_effect() || pending_screen, Ordering::SeqCst);
        if ctl.revision != revision { continue; } // stale operation: process latest immediately
        set_status(target, status);
        // A screen acquisition that failed without owning the matrix must NOT
        // retry by itself: the handoff may already be restoring warm gamma. A
        // later screen retry first neutralizes gamma again and republishes the
        // target. Owned old screen effects, however, must retry their changes
        // or restoration while the handoff keeps gamma neutral and the overlay
        // hidden. Vision-only errors retain their earlier automatic retry.
        let failed_unowned_screen = status == Status::Error
            && target.screen.wants_effect() && !controller.owns_screen_effect();
        if matches!(status, Status::Active | Status::Error | Status::RestoreError) && !failed_unowned_screen {
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
    SCREEN_COVERED.store(controller.owns_screen_effect(), Ordering::SeqCst);
    if !ctl.shutdown_ok { set_status(ctl.target, Status::RestoreError); }
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
    pub static WRITE_CALLS: AtomicU32 = AtomicU32::new(0);
    pub static IN_WRITE: AtomicBool = AtomicBool::new(false);
    pub static FAIL_WRITE: AtomicBool = AtomicBool::new(false);
    pub struct NativeBackend;
    impl Backend for NativeBackend {
        fn initialize(&mut self) -> bool { true }
        fn get(&mut self) -> Option<Matrix> { Some(*CURRENT.lock().unwrap()) }
        fn set(&mut self, matrix: &Matrix) -> bool {
            WRITE_CALLS.fetch_add(1, Ordering::SeqCst);
            IN_WRITE.store(true, Ordering::SeqCst);
            let delay = DELAY_MS.load(Ordering::SeqCst);
            if delay > 0 { std::thread::sleep(Duration::from_millis(delay as u64)); }
            let ok = !FAIL_WRITE.load(Ordering::SeqCst);
            if ok { *CURRENT.lock().unwrap() = *matrix; }
            IN_WRITE.store(false, Ordering::SeqCst);
            ok
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
        set_target(Profile::Deuteranopia, 60, false, ScreenTarget::OFF);
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
        set_target(Profile::Deuteranopia, 60, true, ScreenTarget::OFF);
        wait_until(|| status() == Status::Paused);
        assert!(same_matrix(&CURRENT.lock().unwrap(), &IDENTITY));
        set_target(Profile::Deuteranopia, 60, false, ScreenTarget::OFF);
        wait_until(|| status() == Status::Active);
        let screen = ScreenTarget::new(true, 70, 3000);
        set_target(Profile::Off, 0, false, screen);
        wait_until(|| screen_status() == Status::Active && screen_covers_overlay());
        assert_eq!(status(), Status::Off, "screen-only mode is not colour-vision assistance");
        set_target(Profile::Deuteranopia, 60, false, screen);
        wait_until(|| status() == Status::Active && screen_status() == Status::Active);
        FAIL_WRITE.store(true, Ordering::SeqCst);
        set_target(Profile::Deuteranopia, 60, false, ScreenTarget::OFF);
        wait_until(|| screen_status() == Status::Error && screen_covers_overlay());
        assert_eq!(status(), Status::Error, "failed handoff keeps owned screen effect visible as an error");
        FAIL_WRITE.store(false, Ordering::SeqCst);
        retry();
        wait_until(|| status() == Status::Active && screen_status() == Status::Off && !screen_covers_overlay());
        set_target(Profile::Off, 0, false, screen);
        wait_until(|| screen_status() == Status::Active && screen_covers_overlay());
        let mut external_screen = IDENTITY; external_screen[2][2] = 0.4;
        *CURRENT.lock().unwrap() = external_screen;
        wait_until(|| screen_status() == Status::Conflict && !screen_covers_overlay());
        assert_eq!(*CURRENT.lock().unwrap(), external_screen, "do not fight a competing effect");
        *CURRENT.lock().unwrap() = IDENTITY;
        retry(); // a direct retry is unsafe until the handoff has re-neutralized gamma
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(screen_status(), Status::Conflict);
        set_target(Profile::Off, 0, false, ScreenTarget::OFF);
        wait_until(|| screen_status() == Status::Off && !screen_covers_overlay());
        std::thread::sleep(Duration::from_millis(100)); // let the fake worker observe Off
        FAIL_WRITE.store(true, Ordering::SeqCst);
        set_target(Profile::Off, 0, false, screen);
        wait_until(|| screen_status() == Status::Error && !screen_covers_overlay());
        let failed_calls = WRITE_CALLS.load(Ordering::SeqCst);
        retry(); // neither explicit nor timer retry may sneak in after fallback
        std::thread::sleep(Duration::from_millis(2200));
        assert_eq!(WRITE_CALLS.load(Ordering::SeqCst), failed_calls, "unowned screen failure must stay quiescent");
        FAIL_WRITE.store(false, Ordering::SeqCst);
        set_target(Profile::Off, 0, false, ScreenTarget::OFF);
        wait_until(|| screen_status() == Status::Off && !screen_covers_overlay());
        std::thread::sleep(Duration::from_millis(100)); // let the fake worker observe Off
        // This new target represents a later, explicitly re-neutralized handoff.
        set_target(Profile::Off, 0, false, screen);
        wait_until(|| screen_status() == Status::Active && screen_covers_overlay());
        DELAY_MS.store(150, Ordering::SeqCst);
        set_target(Profile::Tritanopia, 75, false, ScreenTarget::OFF);
        wait_until(|| IN_WRITE.load(Ordering::SeqCst));
        assert!(stop_and_restore());
        assert!(same_matrix(&CURRENT.lock().unwrap(), &IDENTITY));
        // No queued change can put a filter back after shutdown returns.
        set_target(Profile::Protanopia, 100, false, ScreenTarget::OFF);
        std::thread::sleep(Duration::from_millis(200));
        assert!(same_matrix(&CURRENT.lock().unwrap(), &IDENTITY));
    }
}
