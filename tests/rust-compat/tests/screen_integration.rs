#![cfg(not(windows))]
//! Real gamma and Magnification worker coordination with fake drivers and a
//! simulated overlay acknowledgement. This is NOT a Windows compositor test.
//! Run this ignored test in isolation: worker statics stop permanently at exit.

#[path = "../../../src-tauri/src/color_vision.rs"] mod color_vision;
#[path = "../../../src-tauri/src/color_filter.rs"] mod color_filter;
#[path = "../../../src-tauri/src/gamma_logic.rs"] mod gamma_logic;
#[path = "../../../src-tauri/src/display.rs"] mod display;
#[path = "../../../src-tauri/src/screen_handoff.rs"] mod screen_handoff;
mod diag { pub fn log<T: AsRef<str>>(_: T) {} }

use color_vision::{Profile, ScreenTarget, Status, Target, IDENTITY};
use screen_handoff::{Handoff, NeutralState};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

struct Simulation {
    handoff: Handoff,
    overlay_hidden: bool,
}
impl Simulation {
    fn new() -> Self { Self { handoff: Handoff::default(), overlay_hidden: false } }
    fn status(&self) -> Status { self.handoff.status(color_filter::screen_status()) }
    fn tick(&mut self, cover: bool, brightness: u32, kelvin: u32) {
        let neutral = if display::fullscreen_neutral_ready() { NeutralState::Ready }
            else if display::fullscreen_neutral_failed() { NeutralState::Failed }
            else { NeutralState::Pending };
        let wanted = cover && (brightness < 100 || kelvin < 6500);
        let d = self.handoff.step(wanted, neutral, color_filter::screen_status(),
            color_filter::screen_covers_overlay(), self.overlay_hidden);
        if d.hold_gamma_neutral { display::hold_neutral_for_fullscreen(100); }
        else { display::set_target(kelvin, 100); }
        color_filter::set_target(Profile::Off, 0, false, ScreenTarget::new(d.request_screen, brightness, kelvin));
        let covered = color_filter::screen_covers_overlay();
        if display::target_kelvin() < 6500 {
            assert!(!covered, "never resume this app's warm Gamma over an owned/pending screen effect");
        }
        // Model a window worker that applies the latest hide/show request and
        // publishes its confirmation only for the *next* handoff decision.
        let legacy_overlay_visible = brightness < 100 && !d.hide_overlay && !covered;
        self.overlay_hidden = !legacy_overlay_visible;
        if covered && color_filter::screen_status() == Status::Active {
            assert!(display::fullscreen_neutral_ready(), "screen acquisition requires the serialized neutral ack");
            assert!(self.overlay_hidden, "legacy overlay must be hidden before matrix acquisition");
        }
    }
    fn until(&mut self, what: &str, cover: bool, brightness: u32, kelvin: u32,
             timeout_ms: u64, done: impl Fn(&Self) -> bool) {
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        loop {
            self.tick(cover, brightness, kelvin);
            if done(self) { return; }
            assert!(Instant::now() < deadline, "timed out: {what}; status {:?}", self.status());
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
fn wait(what: &str, timeout_ms: u64, done: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    while !done() {
        assert!(Instant::now() < deadline, "timed out: {what}");
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
#[ignore = "run separately with --ignored; the real workers have process-global state"]
fn real_workers_handoff_fallback_retry_and_restore_without_own_double_tint() {
    use color_filter::native as m;
    use display::test_driver as g;

    display::set_target(3000, 100);
    wait("initial legacy warmth", 2000, || display::current_kelvin() == 3000);
    let mut sim = Simulation::new();

    // A primary display's success must not conceal a partial neutral failure.
    g::PARTIAL.store(true, Ordering::SeqCst);
    sim.until("partial gamma reset fallback", true, 70, 3000, 2500,
        |s| s.status() == Status::Error && display::target_kelvin() == 3000 && !s.overlay_hidden);
    assert!(!color_filter::screen_covers_overlay());
    g::PARTIAL.store(false, Ordering::SeqCst);
    sim.handoff.retry();
    sim.until("explicit retry acquires matrix", true, 70, 3000, 3000,
        |s| s.status() == Status::Active && color_filter::screen_covers_overlay());
    assert_eq!(display::current_kelvin(), 6500);
    assert!(g::LAST_NEUTRAL.load(Ordering::SeqCst));
    let desired = Target::OFF.with_screen(ScreenTarget::new(true, 70, 3000));
    assert!(color_vision::same_matrix(&m::CURRENT.lock().unwrap(), &color_vision::combined_matrix(desired)));

    // New warmth and brightness share the same matrix, not an additional LUT.
    let changed = Target::OFF.with_screen(ScreenTarget::new(true, 50, 2800));
    sim.until("combined adjustment", true, 50, 2800, 1500,
        |_| color_filter::screen_status() == Status::Active
            && color_vision::same_matrix(&m::CURRENT.lock().unwrap(), &color_vision::combined_matrix(changed)));
    assert_eq!(display::target_kelvin(), 6500);

    // A failed restoration must hold both gamma and overlay until it succeeds.
    m::FAIL_WRITE.store(true, Ordering::SeqCst);
    sim.until("failed screen restoration", false, 50, 2800, 1500,
        |_| color_filter::screen_status() == Status::RestoreError && color_filter::screen_covers_overlay());
    assert_eq!(display::target_kelvin(), 6500);
    assert!(sim.overlay_hidden);
    m::FAIL_WRITE.store(false, Ordering::SeqCst);
    sim.until("legacy path resumes after confirmed release", false, 50, 2800, 4000,
        |s| !color_filter::screen_covers_overlay() && display::target_kelvin() == 2800 && !s.overlay_hidden);
    wait("legacy warm ramp", 2000, || display::current_kelvin() == 2800);
    assert_eq!(*m::CURRENT.lock().unwrap(), IDENTITY);

    // A competing filter is not overwritten, and fallback stays latched until
    // the user explicitly retries after removing it.
    let mut external = IDENTITY; external[2][2] = 0.4;
    *m::CURRENT.lock().unwrap() = external;
    sim.until("external matrix conflict", true, 70, 3000, 3000,
        |s| s.status() == Status::Conflict && display::target_kelvin() == 3000 && !s.overlay_hidden);
    assert_eq!(*m::CURRENT.lock().unwrap(), external);
    *m::CURRENT.lock().unwrap() = IDENTITY;
    for _ in 0..15 { sim.tick(true, 70, 3000); std::thread::sleep(Duration::from_millis(10)); }
    assert_eq!(sim.status(), Status::Conflict, "no unsolicited acquisition after fallback");
    sim.handoff.retry(); color_filter::retry();
    sim.until("retry after conflict", true, 70, 3000, 3000,
        |s| s.status() == Status::Active && color_filter::screen_covers_overlay());

    // Toggle off, on and off while a slow matrix update is in flight. No old
    // write may cause Gamma to resume until the worker has released it.
    m::DELAY_MS.store(200, Ordering::SeqCst);
    sim.tick(true, 45, 2700);
    wait("slow matrix update entered", 1500, || m::IN_WRITE.load(Ordering::SeqCst));
    sim.tick(false, 45, 2700);
    assert_eq!(display::target_kelvin(), 6500);
    sim.tick(true, 45, 2700);
    assert_eq!(display::target_kelvin(), 6500);
    sim.until("slow write release", false, 45, 2700, 4000,
        |s| !color_filter::screen_covers_overlay() && display::target_kelvin() == 2700 && !s.overlay_hidden);
    m::DELAY_MS.store(0, Ordering::SeqCst);
    assert_eq!(*m::CURRENT.lock().unwrap(), IDENTITY);
    assert!(color_filter::stop_and_restore());
    assert!(display::stop_and_restore_gamma());
}
