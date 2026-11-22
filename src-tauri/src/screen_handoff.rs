//! Conservative hand-off between the old gamma/overlay path and the opt-in
//! full-screen matrix. This is a policy, not proof of a physical display result.
//!
//! The matrix never receives our warmth until the gamma worker has drained any
//! old write and confirmed neutral (or has never attempted a warm write), and
//! until the overlay worker has confirmed its window hidden. In the other
//! direction the gamma path stays neutral until our matrix has been released.
//! Errors are latched for explicit retry; changing the eye switch or disabling
//! the option still gives the user a way back to the previous path.

use std::time::{Duration, Instant};
use crate::color_vision::Status;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NeutralState { Pending, Ready, Failed }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase { Legacy, Neutralizing, HidingOverlay, Acquiring, Active, Releasing, Failed(Status) }

#[derive(Debug, Clone, Copy)]
pub struct Decision {
    /// Stop old warm gamma writes and ask the display worker for a neutral ack.
    pub hold_gamma_neutral: bool,
    /// Apply both requested warmth and brightness in the shared matrix.
    pub request_screen: bool,
    /// Hide and confirm the legacy overlay before acquiring the matrix.
    pub hide_overlay: bool,
}

pub struct Handoff {
    phase: Phase,
    since: Instant,
    retry: bool,
}

impl Default for Handoff {
    fn default() -> Self { Self { phase: Phase::Legacy, since: Instant::now(), retry: false } }
}

impl Handoff {
    fn enter(&mut self, phase: Phase) {
        if self.phase != phase { self.phase = phase; self.since = Instant::now(); }
    }

    /// Only user-initiated retry clears a detected failure while still opted in.
    pub fn retry(&mut self) { self.retry = true; }

    pub fn hides_overlay(&self) -> bool {
        matches!(self.phase, Phase::HidingOverlay | Phase::Acquiring | Phase::Active | Phase::Releasing)
    }

    /// The native worker status is sampled again for snapshots so a newly
    /// queued matrix change is not incorrectly presented as already active.
    pub fn status(&self, worker: Status) -> Status {
        match self.phase {
            Phase::Legacy => Status::Off,
            Phase::Neutralizing | Phase::HidingOverlay => Status::Pending,
            Phase::Failed(reason) => reason,
            Phase::Acquiring | Phase::Active | Phase::Releasing => match worker {
                Status::Active | Status::Pending | Status::Conflict | Status::Error
                | Status::RestoreError | Status::Unsupported => worker,
                _ => Status::Pending,
            },
        }
    }

    pub fn step(&mut self, wanted: bool, neutral: NeutralState, worker: Status,
                covered: bool, overlay_hidden: bool) -> Decision {
        if !wanted {
            // Even after the user turns the option off, do not resume gamma or
            // the old overlay while a matrix write/restore is still in flight.
            if covered { self.enter(Phase::Releasing); }
            else { self.enter(Phase::Legacy); }
        } else {
            // Be conservative even if a stale worker operation is observed in
            // a phase where we did not expect ownership.
            if covered && matches!(self.phase, Phase::Legacy | Phase::Neutralizing
                | Phase::HidingOverlay | Phase::Failed(_)) {
                self.enter(Phase::Releasing);
            }
            match self.phase {
                Phase::Legacy => self.enter(Phase::Neutralizing),
                Phase::Neutralizing => match neutral {
                    NeutralState::Ready => self.enter(Phase::HidingOverlay),
                    NeutralState::Failed => self.enter(Phase::Failed(Status::Error)),
                    NeutralState::Pending if self.since.elapsed() >= Duration::from_secs(10) => {
                        self.enter(Phase::Failed(Status::Error));
                    }
                    NeutralState::Pending => {}
                },
                Phase::HidingOverlay => {
                    if overlay_hidden { self.enter(Phase::Acquiring); }
                    else if self.since.elapsed() >= Duration::from_secs(10) {
                        self.enter(Phase::Failed(Status::Error));
                    }
                }
                Phase::Acquiring | Phase::Active => {
                    if !covered && matches!(worker, Status::Conflict | Status::Error | Status::Unsupported | Status::RestoreError) {
                        self.enter(Phase::Failed(worker));
                    } else if covered && worker == Status::Active {
                        self.enter(Phase::Active);
                    }
                }
                Phase::Releasing => {
                    // A rapid off/on waits for the prior write to finish first.
                    if !covered { self.enter(Phase::Neutralizing); }
                }
                Phase::Failed(_) => {
                    if self.retry { self.enter(Phase::Neutralizing); }
                }
            }
        }
        self.retry = false;
        Decision {
            hold_gamma_neutral: matches!(self.phase, Phase::Neutralizing | Phase::HidingOverlay
                | Phase::Acquiring | Phase::Active | Phase::Releasing),
            request_screen: matches!(self.phase, Phase::Acquiring | Phase::Active),
            hide_overlay: self.hides_overlay(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn step(h: &mut Handoff, wanted: bool, neutral: NeutralState, worker: Status,
            covered: bool, hidden: bool) -> Decision {
        h.step(wanted, neutral, worker, covered, hidden)
    }
    fn acquire(h: &mut Handoff) {
        let d = step(h, true, NeutralState::Pending, Status::Off, false, false);
        assert!(d.hold_gamma_neutral && !d.request_screen && !d.hide_overlay);
        let d = step(h, true, NeutralState::Ready, Status::Off, false, false);
        assert!(d.hold_gamma_neutral && !d.request_screen && d.hide_overlay);
        let d = step(h, true, NeutralState::Ready, Status::Off, false, false);
        assert!(!d.request_screen, "wait for the actual window-hide acknowledgement");
        let d = step(h, true, NeutralState::Ready, Status::Off, false, true);
        assert!(d.hold_gamma_neutral && d.request_screen && d.hide_overlay);
    }

    #[test]
    fn default_is_legacy_and_acquisition_requires_both_acknowledgements() {
        let mut h = Handoff::default();
        let d = step(&mut h, false, NeutralState::Pending, Status::Off, false, true);
        assert!(!d.hold_gamma_neutral && !d.request_screen && !d.hide_overlay);
        acquire(&mut h);
        let d = step(&mut h, true, NeutralState::Ready, Status::Pending, true, true);
        assert!(d.request_screen && d.hide_overlay && d.hold_gamma_neutral);
        let d = step(&mut h, true, NeutralState::Ready, Status::Active, true, true);
        assert!(d.request_screen && d.hold_gamma_neutral);
        assert_eq!(h.status(Status::Active), Status::Active);
        assert_eq!(h.status(Status::Pending), Status::Pending);
    }

    #[test]
    fn disable_or_whitelist_waits_for_release_even_if_restore_fails() {
        let mut h = Handoff::default(); acquire(&mut h);
        step(&mut h, true, NeutralState::Ready, Status::Active, true, true);
        let d = step(&mut h, false, NeutralState::Ready, Status::Pending, true, true);
        assert!(d.hold_gamma_neutral && d.hide_overlay && !d.request_screen);
        let d = step(&mut h, false, NeutralState::Ready, Status::RestoreError, true, true);
        assert!(d.hold_gamma_neutral && d.hide_overlay && !d.request_screen);
        assert_eq!(h.status(Status::RestoreError), Status::RestoreError);
        let d = step(&mut h, false, NeutralState::Ready, Status::Off, false, true);
        assert!(!d.hold_gamma_neutral && !d.hide_overlay && !d.request_screen);
        assert_eq!(h.status(Status::Off), Status::Off);
    }

    #[test]
    fn partial_matrix_failure_keeps_old_owned_effect_without_doubling() {
        let mut h = Handoff::default(); acquire(&mut h);
        let d = step(&mut h, true, NeutralState::Ready, Status::Error, true, true);
        assert!(d.hold_gamma_neutral && d.request_screen && d.hide_overlay);
        assert_eq!(h.status(Status::Error), Status::Error);
        let d = step(&mut h, true, NeutralState::Ready, Status::Active, true, true);
        assert!(d.request_screen && d.hold_gamma_neutral);
    }

    #[test]
    fn failure_without_ownership_falls_back_and_retry_is_explicit() {
        for failure in [Status::Conflict, Status::Error, Status::Unsupported] {
            let mut h = Handoff::default(); acquire(&mut h);
            let d = step(&mut h, true, NeutralState::Ready, failure, false, true);
            assert!(!d.hold_gamma_neutral && !d.request_screen && !d.hide_overlay);
            assert_eq!(h.status(Status::Off), failure);
            let d = step(&mut h, true, NeutralState::Ready, Status::Off, false, true);
            assert!(!d.hold_gamma_neutral && !d.request_screen);
            h.retry();
            let d = step(&mut h, true, NeutralState::Pending, Status::Off, false, true);
            assert!(d.hold_gamma_neutral && !d.request_screen);
            assert_eq!(h.status(Status::Off), Status::Pending);
        }
    }

    #[test]
    fn neutral_failure_or_unconfirmed_hide_never_applies_a_matrix() {
        let mut h = Handoff::default();
        step(&mut h, true, NeutralState::Pending, Status::Off, false, false);
        let d = step(&mut h, true, NeutralState::Failed, Status::Off, false, false);
        assert!(!d.hold_gamma_neutral && !d.request_screen && !d.hide_overlay);
        assert_eq!(h.status(Status::Off), Status::Error);
        h.retry();
        step(&mut h, true, NeutralState::Pending, Status::Off, false, false);
        step(&mut h, true, NeutralState::Ready, Status::Off, false, false);
        h.since = Instant::now() - Duration::from_secs(11);
        let d = step(&mut h, true, NeutralState::Ready, Status::Off, false, false);
        assert!(!d.hold_gamma_neutral && !d.request_screen && !d.hide_overlay);
        assert_eq!(h.status(Status::Off), Status::Error);
    }

    #[test]
    fn rapid_off_on_cannot_skip_the_previous_in_flight_restore() {
        let mut h = Handoff::default(); acquire(&mut h);
        step(&mut h, false, NeutralState::Ready, Status::Pending, true, true);
        let d = step(&mut h, true, NeutralState::Ready, Status::Pending, true, true);
        assert!(d.hold_gamma_neutral && !d.request_screen && d.hide_overlay);
        let d = step(&mut h, true, NeutralState::Ready, Status::Off, false, true);
        assert!(d.hold_gamma_neutral && !d.request_screen && !d.hide_overlay);
        let d = step(&mut h, true, NeutralState::Ready, Status::Off, false, true);
        assert!(d.hold_gamma_neutral && !d.request_screen && d.hide_overlay);
        let d = step(&mut h, true, NeutralState::Ready, Status::Off, false, true);
        assert!(d.hold_gamma_neutral && d.request_screen && d.hide_overlay);
    }
}
