//! Eye-protection engine (v2).
//!
//! * Colour temperature (2700K – 6500K) is pushed straight into every display's
//!   GPU LUT with Win32 `SetDeviceGammaRamp` (Tanner Helland's approximation).
//! * All changes are **interpolated** (`lerp`) over a configurable 2 s window by a
//!   background worker, so the colour-safe whitelist can hand the screen back to
//!   neutral 6500K without a visible jump — and back again.
//! * A 10 s re-assertion loop neutralises Night Light / driver overrides.
//! * A detached `--gamma-watchdog <pid>` child restores 6500K the instant the
//!   main process is killed or crashes.
//! * The ramp is also restored on exit and from a panic hook.

use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

/// Kelvin value considered "neutral" (identity LUT).
pub const NEUTRAL_KELVIN: u32 = 6500;
pub const MIN_KELVIN: u32 = 2700;

static TOUCHED: AtomicBool = AtomicBool::new(false);
static WORKER_STARTED: AtomicBool = AtomicBool::new(false);
static WATCHDOG_STARTED: AtomicBool = AtomicBool::new(false);
static REASSERT_STARTED: AtomicBool = AtomicBool::new(false);
/// Kelvin the engine is heading to.
static TARGET: AtomicU32 = AtomicU32::new(NEUTRAL_KELVIN);
/// Kelvin currently in the LUT (interpolated).
static CURRENT: AtomicU32 = AtomicU32::new(NEUTRAL_KELVIN);
/// Poll interval of the lerp worker (ms).
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

#[cfg(not(windows))]
fn push_ramp(_ramp: &[u16]) -> bool {
    true
}

/// Applies a Kelvin value to the hardware LUT immediately (no interpolation).
pub fn apply_gamma(kelvin: u32) -> bool {
    let kelvin = kelvin.clamp(MIN_KELVIN, NEUTRAL_KELVIN);
    let ok = push_ramp(&build_ramp(kelvin));
    if ok {
        CURRENT.store(kelvin, Ordering::SeqCst);
        TOUCHED.store(kelvin < NEUTRAL_KELVIN, Ordering::SeqCst);
    }
    ok
}

/// Kelvin currently sitting in the LUT.
pub fn current_kelvin() -> u32 {
    CURRENT.load(Ordering::SeqCst)
}

pub fn target_kelvin() -> u32 {
    TARGET.load(Ordering::SeqCst)
}

/// Sets the destination colour temperature; the worker interpolates towards it.
pub fn set_target(kelvin: u32) {
    let kelvin = kelvin.clamp(MIN_KELVIN, NEUTRAL_KELVIN);
    TARGET.store(kelvin, Ordering::SeqCst);
    spawn_lerp_worker();
}

/* -------------------------------------------------------------------------- */
/*                            Smooth 2-second lerp                            */
/* -------------------------------------------------------------------------- */

fn spawn_lerp_worker() {
    if WORKER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_millis(LERP_STEP_MS));

        let target = TARGET.load(Ordering::SeqCst);
        let current = CURRENT.load(Ordering::SeqCst);
        if target == current {
            continue;
        }

        // 20 steps × 100 ms = 2 s regardless of the size of the jump.
        let delta = target as i64 - current as i64;
        let step = (delta.abs() / 20).max(1);
        let next = if delta > 0 {
            (current as i64 + step).min(target as i64)
        } else {
            (current as i64 - step).max(target as i64)
        } as u32;

        apply_gamma(next);
    });
}

/* -------------------------------------------------------------------------- */
/*                        10-second re-assertion loop                         */
/* -------------------------------------------------------------------------- */

/// Windows Night Light, HDR toggles and some GPU drivers quietly overwrite the
/// LUT. Re-applying our buffer every 10 s keeps the user's profile stable.
pub fn spawn_reassert_loop() {
    if REASSERT_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(10));
        let current = CURRENT.load(Ordering::SeqCst);
        let _ = push_ramp(&build_ramp(current));
    });
}

/* -------------------------------------------------------------------------- */
/*                          Safe restore / panic hook                         */
/* -------------------------------------------------------------------------- */

/// Restores the neutral 6500K ramp (safe to call repeatedly / from any thread).
pub fn restore_gamma() {
    TARGET.store(NEUTRAL_KELVIN, Ordering::SeqCst);
    let _ = push_ramp(&build_ramp(NEUTRAL_KELVIN));
    CURRENT.store(NEUTRAL_KELVIN, Ordering::SeqCst);
    TOUCHED.store(false, Ordering::SeqCst);
}

pub fn install_panic_hook() {
    static HOOK: OnceLock<()> = OnceLock::new();
    HOOK.get_or_init(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            crate::diag::log(format!("PANIC: {info}"));
            restore_gamma();
            stop_watchdog();
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
