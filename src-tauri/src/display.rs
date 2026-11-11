//! Eye-protection engine (v2).
//!
//! * Colour temperature (2700K – 6500K) is pushed straight into every display's
//!   GPU LUT with Win32 `SetDeviceGammaRamp` (Tanner Helland's approximation).
//! * Changes are interpolated linearly over the saved transition duration
//!   (2 s by default), so the color-safe hand-off is gradual.
//! * A 10 s re-assertion loop maintains a requested non-neutral gamma ramp.
//! * A detached `--gamma-watchdog <pid>` child restores 6500K the instant the
//!   main process is killed or crashes.
//! * The ramp is also restored on exit and from a panic hook.

use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use crate::gamma_logic::{self, GammaTransition};

/// Kelvin value considered "neutral" (identity LUT).
pub const NEUTRAL_KELVIN: u32 = 6500;
pub const MIN_KELVIN: u32 = 2700;

static TOUCHED: AtomicBool = AtomicBool::new(false);
static WORKER_STARTED: AtomicBool = AtomicBool::new(false);
static WATCHDOG_STARTED: AtomicBool = AtomicBool::new(false);
static REASSERT_STARTED: AtomicBool = AtomicBool::new(false);
static GAMMA_STOPPED: AtomicBool = AtomicBool::new(false);
// Serialize every main-process driver write. After stop-and-restore returns,
// no queued interpolation/reassertion may overwrite the neutral ramp.
static GAMMA_IO: Mutex<()> = Mutex::new(());
static GAMMA_WORKER_THREAD: OnceLock<std::thread::Thread> = OnceLock::new();
// This is the last API result, not proof that a driver actually applied the
// ramp: Windows may silently reject a valid-looking ramp (especially in HDR).
static GAMMA_AVAILABLE: AtomicBool = AtomicBool::new(true);
// Store target and transition duration as one atomic value so rapid settings
// changes cannot combine the target of one update with another duration.
const fn gamma_config(kelvin: u32, duration_ms: u32) -> u64 {
    ((kelvin as u64) << 32) | duration_ms as u64
}
static GAMMA_CONFIG: AtomicU64 = AtomicU64::new(gamma_config(NEUTRAL_KELVIN, 2000));
/// Kelvin last successfully reported to the LUT.
static CURRENT: AtomicU32 = AtomicU32::new(NEUTRAL_KELVIN);
const LERP_STEP_MS: u64 = 100;

static WATCHDOG: OnceLock<Mutex<Option<std::process::Child>>> = OnceLock::new();

fn watchdog_slot() -> &'static Mutex<Option<std::process::Child>> {
    WATCHDOG.get_or_init(|| Mutex::new(None))
}

/* -------------------------------------------------------------------------- */
/*                        Tanner Helland's approximation                      */
/* -------------------------------------------------------------------------- */

/// Converts a colour temperature in Kelvin to 0..255 RGB channel levels.
pub fn kelvin_to_rgb(kelvin: f32) -> (f32, f32, f32) {
    let temp = (kelvin.clamp(1000.0, 40000.0)) / 100.0;

    let red = if temp <= 66.0 {
        255.0
    } else {
        (329.698_73 * (temp - 60.0).powf(-0.133_204_76)).clamp(0.0, 255.0)
    };

    let green = if temp <= 66.0 {
        (99.470_8 * temp.ln() - 161.119_57).clamp(0.0, 255.0)
    } else {
        (288.122_17 * (temp - 60.0).powf(-0.075_514_85)).clamp(0.0, 255.0)
    };

    let blue = if temp >= 66.0 {
        255.0
    } else if temp <= 19.0 {
        0.0
    } else {
        (138.517_73 * (temp - 10.0).ln() - 305.044_8).clamp(0.0, 255.0)
    };

    (red, green, blue)
}

/// Builds a 3 × 256 gamma ramp (R, G, B) for the requested Kelvin value.
pub fn build_ramp(kelvin: u32) -> Vec<u16> {
    let mut ramp = vec![0u16; 768];

    if kelvin >= NEUTRAL_KELVIN {
        for i in 0..256usize {
            let v = (i * 65535 / 255) as u16;
            ramp[i] = v;
            ramp[256 + i] = v;
            ramp[512 + i] = v;
        }
        return ramp;
    }

    let (r, g, b) = kelvin_to_rgb(kelvin as f32);
    for i in 0..256usize {
        let base = (i as f32 / 255.0) * 65535.0;
        ramp[i] = ((base * (r / 255.0)) + 1.0).clamp(0.0, 65535.0) as u16;
        ramp[256 + i] = ((base * (g / 255.0)) + 1.0).clamp(0.0, 65535.0) as u16;
        ramp[512 + i] = ((base * (b / 255.0)) + 1.0).clamp(0.0, 65535.0) as u16;
    }
    ramp
}

/* -------------------------------------------------------------------------- */
/*                        Win32: apply to every display                       */
/* -------------------------------------------------------------------------- */

#[cfg(windows)]
fn push_ramp(ramp: &[u16]) -> bool {
    use std::ffi::c_void;
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::{
        CreateDCW, DeleteDC, EnumDisplayDevicesW, GetDC, ReleaseDC, DISPLAY_DEVICEW,
        DISPLAY_DEVICE_ACTIVE,
    };
    use windows::Win32::UI::ColorSystem::SetDeviceGammaRamp;

    let mut applied = false;
    unsafe {
        // Every active display adapter gets its own DC so multi-monitor setups
        // are warmed/cooled consistently.
        let mut index = 0u32;
        loop {
            let mut device = DISPLAY_DEVICEW::default();
            device.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
            if !EnumDisplayDevicesW(PCWSTR::null(), index, &mut device, 0).as_bool() {
                break;
            }
            index += 1;

            if device.StateFlags & DISPLAY_DEVICE_ACTIVE == 0 {
                continue;
            }

            let name = PCWSTR(device.DeviceName.as_ptr());
            let hdc = CreateDCW(name, name, PCWSTR::null(), None);
            if hdc.is_invalid() {
                continue;
            }
            let ok = SetDeviceGammaRamp(hdc, ramp.as_ptr() as *const c_void).as_bool();
            let _ = DeleteDC(hdc);
            applied |= ok;
        }

        // Fallback / primary DC (also covers sessions where enumeration fails).
        let hdc = GetDC(None);
        if !hdc.is_invalid() {
            let ok = SetDeviceGammaRamp(hdc, ramp.as_ptr() as *const c_void).as_bool();
            ReleaseDC(None, hdc);
            applied |= ok;
        }
    }
    applied
}

#[cfg(all(not(windows), not(test)))]
fn push_ramp(_ramp: &[u16]) -> bool { true }

// Host-only test double: never compiled into the Windows application. It lets
// the real worker be exercised for retries, idle parking, and shutdown races.
#[cfg(all(not(windows), test))]
pub(crate) mod test_driver {
    use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize};
    pub static FAIL: AtomicBool = AtomicBool::new(false);
    pub static CALLS: AtomicUsize = AtomicUsize::new(0);
    pub static DELAY_MS: AtomicU32 = AtomicU32::new(0);
    pub static IN_FLIGHT: AtomicBool = AtomicBool::new(false);
    pub static LAST_NEUTRAL: AtomicBool = AtomicBool::new(true);
}
#[cfg(all(not(windows), test))]
fn push_ramp(ramp: &[u16]) -> bool {
    use test_driver::*;
    CALLS.fetch_add(1, Ordering::SeqCst);
    IN_FLIGHT.store(true, Ordering::SeqCst);
    let delay = DELAY_MS.load(Ordering::SeqCst);
    if delay != 0 { std::thread::sleep(Duration::from_millis(u64::from(delay))); }
    let ok = !FAIL.load(Ordering::SeqCst);
    if ok { LAST_NEUTRAL.store(ramp[767] == 65535, Ordering::SeqCst); }
    IN_FLIGHT.store(false, Ordering::SeqCst);
    ok
}

// Caller holds GAMMA_IO. Preserve CURRENT on failure: it is the last reported
// successful value and permits a later neutral restore to be retried.
fn apply_gamma_locked(kelvin: u32) -> bool {
    let kelvin = kelvin.clamp(MIN_KELVIN, NEUTRAL_KELVIN);
    let ok = push_ramp(&build_ramp(kelvin));
    GAMMA_AVAILABLE.store(ok, Ordering::SeqCst);
    if ok {
        CURRENT.store(kelvin, Ordering::SeqCst);
        TOUCHED.store(kelvin < NEUTRAL_KELVIN, Ordering::SeqCst);
    }
    ok
}

/// Applies a Kelvin value to the hardware LUT immediately (no interpolation).
pub fn apply_gamma(kelvin: u32) -> bool {
    let _io = GAMMA_IO.lock();
    if GAMMA_STOPPED.load(Ordering::SeqCst) && kelvin < NEUTRAL_KELVIN { return false; }
    apply_gamma_locked(kelvin)
}

/// Whether the latest driver API call reported success. It is only a hint:
/// SetDeviceGammaRamp may report success without changing the physical display.
pub fn gamma_available() -> bool { GAMMA_AVAILABLE.load(Ordering::SeqCst) }

/// Kelvin last reported successfully to the LUT.
pub fn current_kelvin() -> u32 { CURRENT.load(Ordering::SeqCst) }

pub fn target_kelvin() -> u32 { (GAMMA_CONFIG.load(Ordering::SeqCst) >> 32) as u32 }

fn wake_lerp_worker() {
    if let Some(worker) = GAMMA_WORKER_THREAD.get() { worker.unpark(); }
}

/// Set the target and saved duration together; repeated identical snapshots do
/// not reset the transition or wake an idle worker.
pub fn set_target(kelvin: u32, duration_ms: u32) {
    if GAMMA_STOPPED.load(Ordering::SeqCst) { return; }
    let kelvin = kelvin.clamp(MIN_KELVIN, NEUTRAL_KELVIN);
    let next = gamma_config(kelvin, gamma_logic::transition_ms(duration_ms));
    let changed = GAMMA_CONFIG.swap(next, Ordering::SeqCst) != next;
    spawn_lerp_worker();
    if changed { wake_lerp_worker(); }
}

/* -------------------------------------------------------------------------- */
/*                         Event-driven, timed gamma lerp                      */
/* -------------------------------------------------------------------------- */

fn spawn_lerp_worker() {
    if WORKER_STARTED.swap(true, Ordering::SeqCst) { return; }
    std::thread::spawn(|| {
        let _ = GAMMA_WORKER_THREAD.set(std::thread::current());
        let epoch = Instant::now();
        let now_ms = || epoch.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
        let mut active_config = None;
        let mut transition = GammaTransition::new(NEUTRAL_KELVIN, NEUTRAL_KELVIN, 0, 2000);
        loop {
            if GAMMA_STOPPED.load(Ordering::SeqCst) { break; }
            let config = GAMMA_CONFIG.load(Ordering::SeqCst);
            let target = (config >> 32) as u32;
            let duration = config as u32;
            let current = CURRENT.load(Ordering::SeqCst);
            if active_config != Some(config) {
                transition = GammaTransition::new(current, target, now_ms(), duration);
                active_config = Some(config);
            }
            if !gamma_logic::needs_attempt(current, target, gamma_available(), NEUTRAL_KELVIN) {
                // No periodic 100 ms wakeups while settled. Unpark is durable,
                // including when a new target arrives just before this call.
                std::thread::park();
                continue;
            }
            let next = transition.sample(now_ms());
            if next == current && current != target {
                std::thread::park_timeout(Duration::from_millis(LERP_STEP_MS));
                continue;
            }
            let ok = {
                let _io = GAMMA_IO.lock();
                // Discard stale work, including anything queued before shutdown.
                if GAMMA_STOPPED.load(Ordering::SeqCst)
                    || GAMMA_CONFIG.load(Ordering::SeqCst) != config { continue; }
                apply_gamma_locked(next)
            };
            if ok {
                std::thread::park_timeout(Duration::from_millis(LERP_STEP_MS));
            } else {
                // A rejecting driver previously caused 10 hardware attempts per
                // second indefinitely. Retry at most once per two seconds, and
                // wake immediately for a changed target or shutdown.
                active_config = None;
                std::thread::park_timeout(Duration::from_millis(gamma_logic::RETRY_DELAY_MS));
            }
        }
    });
}

/* -------------------------------------------------------------------------- */
/*                        10-second re-assertion loop                         */
/* -------------------------------------------------------------------------- */

/// Reapply only while ChashmYar actually requests a non-neutral ramp. When
/// disabled or color-safe, repeatedly overwriting other color software with an
/// identity ramp is both unnecessary and surprising.
pub fn spawn_reassert_loop() {
    if REASSERT_STARTED.swap(true, Ordering::SeqCst) { return; }
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(10));
        if GAMMA_STOPPED.load(Ordering::SeqCst) { break; }
        let failed = {
            let _io = GAMMA_IO.lock();
            if GAMMA_STOPPED.load(Ordering::SeqCst) { break; }
            let current = CURRENT.load(Ordering::SeqCst);
            if target_kelvin() >= NEUTRAL_KELVIN || current >= NEUTRAL_KELVIN
                || !TOUCHED.load(Ordering::SeqCst) { false }
            else {
                let ok = push_ramp(&build_ramp(current));
                if !ok { GAMMA_AVAILABLE.store(false, Ordering::SeqCst); }
                !ok
            }
        };
        if failed { wake_lerp_worker(); }
    });
}

/* -------------------------------------------------------------------------- */
/*                          Safe restore / panic hook                         */
/* -------------------------------------------------------------------------- */

/// Restore the neutral ramp without stopping the engine (tray/reset action).
pub fn restore_gamma() {
    let duration = GAMMA_CONFIG.load(Ordering::SeqCst) as u32;
    GAMMA_CONFIG.store(gamma_config(NEUTRAL_KELVIN, duration), Ordering::SeqCst);
    let ok = {
        let _io = GAMMA_IO.lock();
        apply_gamma_locked(NEUTRAL_KELVIN)
    };
    if !ok { crate::diag::log("gamma neutral restore failed; the worker will retry if needed"); }
    wake_lerp_worker();
}

/// Permanent exit path: stop future warm writes *before* restoring. The lock
/// waits for any in-flight write, so a stale worker cannot re-tint the screen
/// after a successful reset. On failure leave the watchdog alive for exit.
pub fn stop_and_restore_gamma() -> bool {
    GAMMA_STOPPED.store(true, Ordering::SeqCst);
    GAMMA_CONFIG.store(gamma_config(NEUTRAL_KELVIN, 2000), Ordering::SeqCst);
    wake_lerp_worker();
    let _io = GAMMA_IO.lock();
    let ok = apply_gamma_locked(NEUTRAL_KELVIN);
    if !ok { crate::diag::log("gamma shutdown restore failed; watchdog remains armed"); }
    ok
}

pub fn install_panic_hook() {
    static HOOK: OnceLock<()> = OnceLock::new();
    HOOK.get_or_init(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            crate::diag::log(format!("PANIC: {info}"));
            GAMMA_STOPPED.store(true, Ordering::SeqCst);
            GAMMA_CONFIG.store(gamma_config(NEUTRAL_KELVIN, 2000), Ordering::SeqCst);
            wake_lerp_worker();
            // A panic could occur with GAMMA_IO already held on this thread.
            // Never deadlock the panic hook; keep the watchdog armed either way.
            if let Some(_io) = GAMMA_IO.try_lock() {
                let _ = apply_gamma_locked(NEUTRAL_KELVIN);
            }
            previous(info);
        }));
    });
}

/* -------------------------------------------------------------------------- */
/*                        Crash-safe watchdog child process                   */
/* -------------------------------------------------------------------------- */

const WATCHDOG_FLAG: &str = "--gamma-watchdog";

/// Spawns the detached watchdog: `chashmyar.exe --gamma-watchdog <parent_pid>`.
#[cfg(windows)]
pub fn spawn_watchdog() {
    if WATCHDOG_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let child = std::process::Command::new(exe)
        .arg(WATCHDOG_FLAG)
        .arg(std::process::id().to_string())
        .creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();

    match child {
        Ok(child) => {
            crate::diag::log(format!("gamma watchdog spawned (pid {})", child.id()));
            *watchdog_slot().lock() = Some(child);
        }
        Err(err) => {
            crate::diag::log(format!("gamma watchdog could not start: {err}"));
            WATCHDOG_STARTED.store(false, Ordering::SeqCst);
        }
    }
}

#[cfg(not(windows))]
pub fn spawn_watchdog() {}

pub fn stop_watchdog() {
    if let Some(mut child) = watchdog_slot().lock().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// `true` when the current process was launched as the watchdog helper.
pub fn is_watchdog_mode() -> bool {
    std::env::args().any(|a| a == WATCHDOG_FLAG)
}

/// Runs the watchdog: block on the parent process handle, then reset the LUT.
#[cfg(windows)]
pub fn run_watchdog_mode() -> ! {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, INFINITE, PROCESS_SYNCHRONIZE,
    };

    let parent_pid: u32 = std::env::args()
        .skip_while(|a| a != WATCHDOG_FLAG)
        .nth(1)
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    if parent_pid == 0 {
        // Nothing to guard: exit without touching the display.
        std::process::exit(0);
    }

    // The parent may still be initialising, so retry for up to ~15 s instead of
    // falling through (falling through would immediately reset the LUT and undo
    // the user's eye protection).
    let mut handle = None;
    for _ in 0..30 {
        if let Ok(opened) = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, parent_pid) } {
            handle = Some(opened);
            break;
        }
        std::thread::sleep(Duration::from_millis(500));
    }

    let Some(handle) = handle else {
        // We could never observe the parent — stay silent rather than risk
        // flashing the screen back to neutral while the app is running.
        crate::diag::log("watchdog: could not open parent process; exiting without touching gamma");
        std::process::exit(0);
    };

    unsafe {
        // Blocks until the main process exits *for any reason*
        // (clean exit, crash, Task Manager kill).
        let _ = WaitForSingleObject(handle, INFINITE);
        let _ = CloseHandle(handle);
    }

    let _ = push_ramp(&build_ramp(NEUTRAL_KELVIN));
    crate::diag::log("watchdog: parent terminated — gamma restored to 6500K");
    std::process::exit(0);
}

#[cfg(not(windows))]
pub fn run_watchdog_mode() -> ! {
    std::process::exit(0);
}

pub fn gamma_supported_probe() -> bool {
    apply_gamma(NEUTRAL_KELVIN)
}
