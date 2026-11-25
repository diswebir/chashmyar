//! Eye-protection engine (v2).
//!
//! * Colour temperature (2700K – 6500K) is pushed straight into every display's
//!   GPU LUT with Win32 `SetDeviceGammaRamp` (Tanner Helland's approximation).
//! * Changes are interpolated linearly over the saved transition duration
//!   (2 s by default), so the color-safe hand-off is gradual.
//! * A 10 s re-assertion loop maintains a requested non-neutral gamma ramp.
//! * A detached `--gamma-watchdog <pid>` child restores 6500K after the
//!   main process is killed or crashes. Normal exit performs a serial reset.
//! * A caught panic is not process exit and must not stop healthy workers.

use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use crate::gamma_logic::{self, GammaTransition};

/// Kelvin value considered "neutral" (identity LUT).
pub const NEUTRAL_KELVIN: u32 = 6500;
pub const MIN_KELVIN: u32 = 2700;

static TOUCHED: AtomicBool = AtomicBool::new(false);
static WORKER_STARTED: AtomicBool = AtomicBool::new(false);
static WATCHDOG_STARTED: AtomicBool = AtomicBool::new(false);
static GAMMA_STOPPED: AtomicBool = AtomicBool::new(false);
// Serialize every main-process driver write. After stop-and-restore returns,
// no queued interpolation/reassertion may overwrite the neutral ramp.
static GAMMA_IO: Mutex<()> = Mutex::new(());
static GAMMA_WORKER_THREAD: OnceLock<std::thread::Thread> = OnceLock::new();
// This is the last API result, not proof that a driver actually applied the
// ramp: Windows may silently reject a valid-looking ramp (especially in HDR).
static GAMMA_AVAILABLE: AtomicBool = AtomicBool::new(true);
// Coherent pair for the UI: bit 0 = at least one accepted, bit 1 = all
// enumerated calls accepted. Native startup probes before opening the UI.
// This reports API results only, not whether any monitor visibly changed.
static GAMMA_RESULT: AtomicU8 = AtomicU8::new(0b11);
// Store target, duration and the fullscreen neutral hold in one atomic value.
// Kelvin is at most 6500, so its highest bit is available for the hold flag.
const FULLSCREEN_HOLD: u64 = 1 << 63;
const fn gamma_config(kelvin: u32, duration_ms: u32) -> u64 {
    ((kelvin as u64) << 32) | duration_ms as u64
}
const fn config_kelvin(config: u64) -> u32 { ((config & !FULLSCREEN_HOLD) >> 32) as u32 }
static GAMMA_CONFIG: AtomicU64 = AtomicU64::new(gamma_config(NEUTRAL_KELVIN, 2000));
// "Dirty" is deliberately conservative: even a warm API call reporting
// failure may have changed one display. Only a fully successful neutral write
// to all enumerated devices clears it. Gamma success can still be silent/false.
static MAY_HAVE_OWN_WARMTH: AtomicBool = AtomicBool::new(false);
static LAST_ALL_OK: AtomicBool = AtomicBool::new(false);
static FULLSCREEN_NEUTRAL_ACK: AtomicBool = AtomicBool::new(false);
static FULLSCREEN_NEUTRAL_FAILED: AtomicBool = AtomicBool::new(false);
/// Kelvin last successfully reported to at least one LUT (not visual proof).
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

#[derive(Debug, Clone, Copy)]
struct RampResult { any: bool, all: bool }

fn report_gamma_result(result: RampResult) {
    let bits = u8::from(result.any) | (u8::from(result.all) << 1);
    GAMMA_RESULT.store(bits, Ordering::SeqCst);
}

/// Last API result as (at least one accepted, all attempted calls accepted).
/// Neither value proves physical application or inclusion of every display.
pub fn last_gamma_result() -> (bool, bool) {
    let bits = GAMMA_RESULT.load(Ordering::SeqCst);
    (bits & 1 != 0, bits & 2 != 0)
}

#[cfg(windows)]
fn push_ramp(ramp: &[u16]) -> RampResult {
    use std::ffi::c_void;
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::{
        CreateDCW, DeleteDC, EnumDisplayDevicesW, GetDC, ReleaseDC, DISPLAY_DEVICEW,
        DISPLAY_DEVICE_ACTIVE,
    };
    use windows::Win32::UI::ColorSystem::SetDeviceGammaRamp;

    let mut applied = false;
    let mut all_applied = true;
    unsafe {
        // Every active display adapter gets its own DC so multi-monitor setups
        // are warmed/cooled consistently. A partial reset must not be mistaken
        // for a safe handoff merely because one adapter returned success.
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
                all_applied = false;
                continue;
            }
            let ok = SetDeviceGammaRamp(hdc, ramp.as_ptr() as *const c_void).as_bool();
            let _ = DeleteDC(hdc);
            applied |= ok;
            all_applied &= ok;
        }

        // Fallback / primary DC (also covers sessions where enumeration fails).
        // Require it too for the conservative all-displays handoff check.
        let hdc = GetDC(None);
        if !hdc.is_invalid() {
            let ok = SetDeviceGammaRamp(hdc, ramp.as_ptr() as *const c_void).as_bool();
            ReleaseDC(None, hdc);
            applied |= ok;
            all_applied &= ok;
        } else {
            all_applied = false;
        }
    }
    RampResult { any: applied, all: applied && all_applied }
}

#[cfg(all(not(windows), not(test)))]
fn push_ramp(_ramp: &[u16]) -> RampResult { RampResult { any: true, all: true } }

// Host-only test double: never compiled into the Windows application. It lets
// the real worker be exercised for retries, idle parking, and shutdown races.
#[cfg(all(not(windows), test))]
pub(crate) mod test_driver {
    use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize};
    pub static FAIL: AtomicBool = AtomicBool::new(false);
    // Inject a Rust panic before touching the fake driver. Test builds only.
    pub static PANIC_NEXT: AtomicBool = AtomicBool::new(false);
    // Production is fixed at 10 s. Host fake-driver tests can shorten it.
    pub static REASSERT_INTERVAL_MS: AtomicU32 = AtomicU32::new(10_000);
    // At least one display reports success, but at least one reports failure.
    pub static PARTIAL: AtomicBool = AtomicBool::new(false);
    pub static CALLS: AtomicUsize = AtomicUsize::new(0);
    pub static DELAY_MS: AtomicU32 = AtomicU32::new(0);
    pub static IN_FLIGHT: AtomicBool = AtomicBool::new(false);
    pub static LAST_NEUTRAL: AtomicBool = AtomicBool::new(true);
}
#[cfg(all(not(windows), test))]
fn push_ramp(ramp: &[u16]) -> RampResult {
    use test_driver::*;
    CALLS.fetch_add(1, Ordering::SeqCst);
    if PANIC_NEXT.swap(false, Ordering::SeqCst) {
        panic!("injected fake gamma driver panic");
    }
    IN_FLIGHT.store(true, Ordering::SeqCst);
    let delay = DELAY_MS.load(Ordering::SeqCst);
    if delay != 0 { std::thread::sleep(Duration::from_millis(u64::from(delay))); }
    let ok = !FAIL.load(Ordering::SeqCst);
    if ok { LAST_NEUTRAL.store(ramp[767] == 65535, Ordering::SeqCst); }
    let all = ok && !PARTIAL.load(Ordering::SeqCst);
    IN_FLIGHT.store(false, Ordering::SeqCst);
    RampResult { any: ok, all }
}

/// Sample only the primary DC just before a periodic reassertion. This cannot
/// identify the writer, cover all monitors, or establish the physical result.
#[cfg(windows)]
fn primary_readback(expected: &[u16]) -> gamma_logic::Readback {
    use std::ffi::c_void;
    use windows::Win32::Graphics::Gdi::{GetDC, ReleaseDC};
    use windows::Win32::UI::ColorSystem::GetDeviceGammaRamp;
    unsafe {
        let hdc = GetDC(None);
        if hdc.is_invalid() { return gamma_logic::Readback::Unavailable; }
        let mut observed = [0u16; 768];
        let ok = GetDeviceGammaRamp(hdc, observed.as_mut_ptr() as *mut c_void).as_bool();
        ReleaseDC(None, hdc);
        gamma_logic::classify_readback(expected, if ok { Some(&observed) } else { None })
    }
}
#[cfg(not(windows))]
fn primary_readback(_expected: &[u16]) -> gamma_logic::Readback { gamma_logic::Readback::Unavailable }

// Caller holds GAMMA_IO. Preserve CURRENT on complete failure. Even a failed
// warm call is considered dirty because a subset of displays might have changed.
fn apply_gamma_locked(kelvin: u32) -> bool {
    let kelvin = kelvin.clamp(MIN_KELVIN, NEUTRAL_KELVIN);
    let warm = kelvin < NEUTRAL_KELVIN;
    if warm { MAY_HAVE_OWN_WARMTH.store(true, Ordering::SeqCst); }
    let result = push_ramp(&build_ramp(kelvin));
    GAMMA_AVAILABLE.store(result.any, Ordering::SeqCst);
    LAST_ALL_OK.store(result.all, Ordering::SeqCst);
    report_gamma_result(result);
    if result.any {
        CURRENT.store(kelvin, Ordering::SeqCst);
        TOUCHED.store(warm, Ordering::SeqCst);
    }
    if !warm && result.all { MAY_HAVE_OWN_WARMTH.store(false, Ordering::SeqCst); }
    let config = GAMMA_CONFIG.load(Ordering::SeqCst);
    if !warm && config & FULLSCREEN_HOLD != 0 && config_kelvin(config) == NEUTRAL_KELVIN {
        // No prior ChashmYar warm write is also safe from *our* double tint,
        // even when an unsupported driver cannot accept the neutral ramp.
        // Other software, silent driver failures and unenumerated displays can
        // still change the physical result; this is not an OS-level lock.
        let safe = result.all || !MAY_HAVE_OWN_WARMTH.load(Ordering::SeqCst);
        FULLSCREEN_NEUTRAL_FAILED.store(!safe, Ordering::SeqCst);
        FULLSCREEN_NEUTRAL_ACK.store(safe, Ordering::SeqCst);
    }
    result.any
}

/// Applies a Kelvin value to the hardware LUT immediately (no interpolation).
pub fn apply_gamma(kelvin: u32) -> bool {
    let _io = GAMMA_IO.lock();
    if kelvin < NEUTRAL_KELVIN && (GAMMA_STOPPED.load(Ordering::SeqCst)
        || GAMMA_CONFIG.load(Ordering::SeqCst) & FULLSCREEN_HOLD != 0) { return false; }
    apply_gamma_locked(kelvin)
}

/// Whether the latest driver API call reported success. It is only a hint:
/// SetDeviceGammaRamp may report success without changing the physical display.
pub fn gamma_available() -> bool { GAMMA_AVAILABLE.load(Ordering::SeqCst) }

/// Kelvin last reported successfully to the LUT.
pub fn current_kelvin() -> u32 { CURRENT.load(Ordering::SeqCst) }

pub fn target_kelvin() -> u32 { config_kelvin(GAMMA_CONFIG.load(Ordering::SeqCst)) }

fn wake_lerp_worker() {
    if let Some(worker) = GAMMA_WORKER_THREAD.get() { worker.unpark(); }
}

/// Set the legacy gamma target. Repeated snapshots do not restart interpolation.
pub fn set_target(kelvin: u32, duration_ms: u32) {
    if GAMMA_STOPPED.load(Ordering::SeqCst) { return; }
    let kelvin = kelvin.clamp(MIN_KELVIN, NEUTRAL_KELVIN);
    let next = gamma_config(kelvin, gamma_logic::transition_ms(duration_ms));
    let previous = GAMMA_CONFIG.swap(next, Ordering::SeqCst);
    if previous & FULLSCREEN_HOLD != 0 {
        FULLSCREEN_NEUTRAL_ACK.store(false, Ordering::SeqCst);
        FULLSCREEN_NEUTRAL_FAILED.store(false, Ordering::SeqCst);
    }
    spawn_lerp_worker();
    if previous != next { wake_lerp_worker(); }
}

/// Ask the same serial worker to drain any in-flight warm write and reset the
/// GPU LUT before a fullscreen matrix may contain warmth. This neutralization
/// is intentionally immediate: smooth cross-fading across independent APIs is
/// not atomic and could transiently double the warmth on some displays.
pub fn hold_neutral_for_fullscreen(duration_ms: u32) {
    if GAMMA_STOPPED.load(Ordering::SeqCst) { return; }
    let next = gamma_config(NEUTRAL_KELVIN, gamma_logic::transition_ms(duration_ms)) | FULLSCREEN_HOLD;
    let previous = GAMMA_CONFIG.load(Ordering::SeqCst);
    if previous & FULLSCREEN_HOLD == 0 {
        FULLSCREEN_NEUTRAL_ACK.store(false, Ordering::SeqCst);
        FULLSCREEN_NEUTRAL_FAILED.store(false, Ordering::SeqCst);
    }
    let previous = GAMMA_CONFIG.swap(next, Ordering::SeqCst);
    spawn_lerp_worker();
    if previous != next { wake_lerp_worker(); }
}

/// The ack means the serialized API handoff is safe from our own double tint;
/// it cannot prove what the monitor displayed or whether other software changed
/// gamma. It is only meaningful while the neutral hold remains requested.
pub fn fullscreen_neutral_ready() -> bool {
    GAMMA_CONFIG.load(Ordering::SeqCst) & FULLSCREEN_HOLD != 0
        && FULLSCREEN_NEUTRAL_ACK.load(Ordering::SeqCst)
}
pub fn fullscreen_neutral_failed() -> bool {
    GAMMA_CONFIG.load(Ordering::SeqCst) & FULLSCREEN_HOLD != 0
        && FULLSCREEN_NEUTRAL_FAILED.load(Ordering::SeqCst)
}

/* -------------------------------------------------------------------------- */
/*                         Event-driven, timed gamma lerp                      */
/* -------------------------------------------------------------------------- */

/// One supervised thread owns both interpolation and the periodic reassertion.
/// A transient Rust unwind restarts its loop with the latest target; an actual
/// process crash remains the separate watchdog's responsibility.
fn spawn_lerp_worker() {
    if WORKER_STARTED.swap(true, Ordering::SeqCst) { return; }
    let started = std::thread::Builder::new().name("chashmyar-gamma".into()).spawn(|| {
        let _ = GAMMA_WORKER_THREAD.set(std::thread::current());
        let mut failures: u32 = 0;
        loop {
            let began = Instant::now();
            let result = std::panic::catch_unwind(gamma_worker_loop);
            if result.is_ok() || GAMMA_STOPPED.load(Ordering::SeqCst) { break; }
            // A long healthy run ends an old failure streak. Bound retry pressure
            // if the fault persists, but let an updated target wake the delay.
            if began.elapsed() >= Duration::from_secs(30) { failures = 0; }
            failures = failures.saturating_add(1);
            let delay_ms = (1_000u64 << failures.saturating_sub(1).min(5)).min(30_000);
            crate::diag::log(format!("gamma worker panicked; retrying in at most {delay_ms}ms (attempt {failures})"));
            std::thread::park_timeout(Duration::from_millis(delay_ms));
        }
    });
    if let Err(err) = started {
        // A later refresh may retry thread creation; never leave a permanently
        // true 'started' bit after spawn fails.
        WORKER_STARTED.store(false, Ordering::SeqCst);
        crate::diag::log(format!("gamma worker could not start: {err}"));
    }
}

fn gamma_worker_loop() {
    let epoch = Instant::now();
    let now_ms = || epoch.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    let mut active_config = None;
    let mut transition = GammaTransition::new(NEUTRAL_KELVIN, NEUTRAL_KELVIN, 0, 2000);
    #[cfg(all(not(windows), test))]
    let reassert_interval = Duration::from_millis(u64::from(test_driver::REASSERT_INTERVAL_MS.load(Ordering::SeqCst).max(10)));
    #[cfg(any(windows, not(test)))]
    let reassert_interval = Duration::from_secs(10);
    let mut reassert_at = Instant::now() + reassert_interval;
    let mut last_readback = None;
    loop {
        if GAMMA_STOPPED.load(Ordering::SeqCst) { break; }
        let config = GAMMA_CONFIG.load(Ordering::SeqCst);
        let target = config_kelvin(config);
        let duration = config as u32;
        if config & FULLSCREEN_HOLD != 0 {
            active_config = None;
            if fullscreen_neutral_ready() || fullscreen_neutral_failed() {
                std::thread::park();
                continue;
            }
            {
                let _io = GAMMA_IO.lock();
                // Drain prior warm writes and re-check the hold under I/O lock.
                if GAMMA_STOPPED.load(Ordering::SeqCst)
                    || GAMMA_CONFIG.load(Ordering::SeqCst) != config { continue; }
                let _ = apply_gamma_locked(NEUTRAL_KELVIN);
            }
            continue;
        }
        let current = CURRENT.load(Ordering::SeqCst);
        if active_config != Some(config) {
            transition = GammaTransition::new(current, target, now_ms(), duration);
            active_config = Some(config);
            reassert_at = Instant::now() + reassert_interval;
        }
        let partial_neutral = target == NEUTRAL_KELVIN && MAY_HAVE_OWN_WARMTH.load(Ordering::SeqCst);
        if !gamma_logic::needs_attempt(current, target, gamma_available(), NEUTRAL_KELVIN)
            && !partial_neutral {
            // Idle and fullscreen holds do not wake periodically. A settled
            // warm request uses this *same* thread for the old 10 s reassertion.
            if target >= NEUTRAL_KELVIN || current >= NEUTRAL_KELVIN
                || !TOUCHED.load(Ordering::SeqCst) {
                std::thread::park();
                continue;
            }
            let remaining = reassert_at.saturating_duration_since(Instant::now());
            if !remaining.is_zero() {
                std::thread::park_timeout(remaining);
                continue;
            }
            let (ok, readback) = {
                let _io = GAMMA_IO.lock();
                if GAMMA_STOPPED.load(Ordering::SeqCst)
                    || GAMMA_CONFIG.load(Ordering::SeqCst) != config { continue; }
                let readback = primary_readback(&build_ramp(current));
                // A read can take time; do not let it reapply a stale target.
                if GAMMA_STOPPED.load(Ordering::SeqCst)
                    || GAMMA_CONFIG.load(Ordering::SeqCst) != config { continue; }
                (apply_gamma_locked(current), readback)
            };
            if last_readback != Some(readback) {
                crate::diag::log(format!("gamma primary readback before reassert: {} (hint only, {}K)", readback.as_str(), current));
                last_readback = Some(readback);
            }
            reassert_at = Instant::now() + reassert_interval;
            if !ok {
                active_config = None;
                std::thread::park_timeout(Duration::from_millis(gamma_logic::RETRY_DELAY_MS));
            }
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
        let incomplete_reset = next == NEUTRAL_KELVIN && MAY_HAVE_OWN_WARMTH.load(Ordering::SeqCst);
        if ok && !incomplete_reset {
            reassert_at = Instant::now() + reassert_interval;
            std::thread::park_timeout(Duration::from_millis(LERP_STEP_MS));
        } else {
            // A rejecting or partially restored driver must not be hammered.
            active_config = None;
            std::thread::park_timeout(Duration::from_millis(gamma_logic::RETRY_DELAY_MS));
        }
    }
}

/* -------------------------------------------------------------------------- */
/*                          Safe restore / panic hook                         */
/* -------------------------------------------------------------------------- */

/// Permanent exit path: stop future warm writes *before* restoring. The lock
/// waits for any in-flight write, so a stale worker cannot re-tint the screen
/// after a successful reset. On failure leave the watchdog alive for exit.
pub fn stop_and_restore_gamma() -> bool {
    GAMMA_STOPPED.store(true, Ordering::SeqCst);
    GAMMA_CONFIG.store(gamma_config(NEUTRAL_KELVIN, 2000), Ordering::SeqCst);
    wake_lerp_worker();
    let _io = GAMMA_IO.lock();
    let _ = apply_gamma_locked(NEUTRAL_KELVIN);
    let all = LAST_ALL_OK.load(Ordering::SeqCst);
    if !all { crate::diag::log("gamma shutdown restore was not confirmed on every enumerated device; watchdog remains armed"); }
    all
}

pub fn install_panic_hook() {
    static HOOK: OnceLock<()> = OnceLock::new();
    HOOK.get_or_init(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            // Hooks also run for caught panics and on individual background
            // threads. They cannot tell whether the process will exit. Stopping
            // the global filter here turned a recoverable error into a lasting
            // outage. Never take Gamma/worker locks or touch the display here.
            // A genuine process death is guarded by the separate watchdog; a
            // normal exit calls stop_and_restore_gamma explicitly.
            crate::diag::try_log_panic(format!("PANIC (thread may recover): {info}"));
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

    let exe = match std::env::current_exe() {
        Ok(exe) => exe,
        Err(err) => {
            crate::diag::log(format!("gamma watchdog executable path unavailable: {err}"));
            WATCHDOG_STARTED.store(false, Ordering::SeqCst);
            return;
        }
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
    use windows::Win32::Foundation::{CloseHandle, GetLastError, WAIT_FAILED};
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

    let (wait, wait_error) = unsafe {
        // WAIT_OBJECT_0 means the process handle was actually signaled. A
        // failed or unexpected wait is not evidence that the parent exited.
        let wait = WaitForSingleObject(handle, INFINITE);
        let error = if wait == WAIT_FAILED { Some(GetLastError().0) } else { None };
        let _ = CloseHandle(handle);
        (wait, error)
    };
    if !gamma_logic::watchdog_should_restore(wait.0) {
        crate::diag::log(format!("watchdog: parent wait not signaled (result={}, error={wait_error:?}); exiting without touching gamma", wait.0));
        std::process::exit(0);
    }

    let result = push_ramp(&build_ramp(NEUTRAL_KELVIN));
    crate::diag::log(format!("watchdog: parent terminated; neutral 6500K API result any={} all={} (not visual proof)", result.any, result.all));
    std::process::exit(0);
}

#[cfg(not(windows))]
pub fn run_watchdog_mode() -> ! {
    std::process::exit(0);
}

pub fn gamma_supported_probe() -> bool {
    apply_gamma(NEUTRAL_KELVIN)
}
