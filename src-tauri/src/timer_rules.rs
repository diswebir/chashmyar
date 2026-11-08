//! Pure timer-transition decisions, kept independent of native window calls.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkOutcome { OnTime, Delayed, EndedEarly }

/// A ticker decision must still be valid when it acquires the transition lock.
pub fn scheduled_enter_allowed(work_phase: bool, remaining: i64, running: bool, paused: bool, idle_paused: bool) -> bool {
    work_phase && remaining <= 0 && running && !paused && !idle_paused
}

pub fn scheduled_leave_allowed(break_phase: bool, remaining: i64, running: bool, paused: bool) -> bool {
    break_phase && remaining <= 0 && running && !paused
}

/// Manual starts without any elapsed work do not invent a work session.
pub fn work_outcome(completed: bool, was_work: bool, snoozes: u32, elapsed: u64) -> Option<WorkOutcome> {
    if completed {
        Some(if snoozes == 0 { WorkOutcome::OnTime } else { WorkOutcome::Delayed })
    } else if was_work && elapsed > 0 {
        Some(WorkOutcome::EndedEarly)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_stale_enter_after_reset_pause_idle_or_snooze() {
        assert!(scheduled_enter_allowed(true, 0, true, false, false));
        assert!(!scheduled_enter_allowed(false, 0, true, false, false));
        assert!(!scheduled_enter_allowed(true, 180, true, false, false));
        assert!(!scheduled_enter_allowed(true, 0, false, false, false));
        assert!(!scheduled_enter_allowed(true, 0, true, true, false));
        assert!(!scheduled_enter_allowed(true, 0, true, false, true));
    }

    #[test]
    fn rejects_stale_leave_after_penalty_pause_or_prior_leave() {
        assert!(scheduled_leave_allowed(true, 0, true, false));
        assert!(!scheduled_leave_allowed(false, 0, true, false));
        assert!(!scheduled_leave_allowed(true, 30, true, false));
        assert!(!scheduled_leave_allowed(true, 0, false, false));
        assert!(!scheduled_leave_allowed(true, 0, true, true));
    }

    #[test]
    fn distinguishes_completed_delayed_and_interrupted_sessions() {
        assert_eq!(work_outcome(true, true, 0, 100), Some(WorkOutcome::OnTime));
        assert_eq!(work_outcome(true, true, 2, 100), Some(WorkOutcome::Delayed));
        assert_eq!(work_outcome(false, true, 0, 1), Some(WorkOutcome::EndedEarly));
        assert_eq!(work_outcome(false, true, 0, 0), None);
        assert_eq!(work_outcome(false, false, 0, 100), None);
    }
}
