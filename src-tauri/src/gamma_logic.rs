//! Portable gamma-transition policy. Hardware calls and actual color output
//! remain platform/driver dependent and require a real Windows test.

pub const DEFAULT_TRANSITION_MS: u32 = 2_000;
pub const RETRY_DELAY_MS: u64 = 2_000;

/// A zero saved value historically means the default in the overlay CSS too.
pub fn transition_ms(saved: u32) -> u32 {
    if saved == 0 { DEFAULT_TRANSITION_MS } else { saved }
}

#[derive(Debug, Clone, Copy)]
pub struct GammaTransition {
    start: u32,
    target: u32,
    start_ms: u64,
    duration_ms: u64,
}

impl GammaTransition {
    pub fn new(start: u32, target: u32, start_ms: u64, duration_ms: u32) -> Self {
        Self { start, target, start_ms, duration_ms: u64::from(transition_ms(duration_ms)) }
    }

    /// Linear interpolation by elapsed time (not a fixed fraction of the
    /// remaining distance). Never overshoots and reaches the exact target.
    pub fn sample(&self, now_ms: u64) -> u32 {
        let elapsed = now_ms.saturating_sub(self.start_ms).min(self.duration_ms);
        let delta = i64::from(self.target) - i64::from(self.start);
        let value = i64::from(self.start) + delta * elapsed as i64 / self.duration_ms as i64;
        value.clamp(i64::from(self.start.min(self.target)), i64::from(self.start.max(self.target))) as u32
    }
}

/// A failed warm ramp is retried with backoff even if the last recorded Kelvin
/// already equals the target (e.g. the periodic reassertion failed). A failed
/// neutral startup probe should not spin forever while no warmth is requested.
pub fn needs_attempt(current: u32, target: u32, available: bool, neutral: u32) -> bool {
    current != target || (!available && target < neutral)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_directions_finish_in_requested_time_without_overshoot() {
        let warm = GammaTransition::new(6500, 3000, 100, 2000);
        assert_eq!(warm.sample(0), 6500);
        assert_eq!(warm.sample(100), 6500);
        assert_eq!(warm.sample(1100), 4750);
        assert_eq!(warm.sample(2100), 3000);
        assert_eq!(warm.sample(10_000), 3000);
        let neutral = GammaTransition::new(3000, 6500, 0, 2000);
        assert_eq!(neutral.sample(1000), 4750);
        assert_eq!(neutral.sample(2000), 6500);
    }

    #[test]
    fn custom_duration_and_zero_default_are_preserved() {
        assert_eq!(transition_ms(0), 2000);
        assert_eq!(transition_ms(750), 750);
        assert_eq!(GammaTransition::new(6500, 3000, 0, 750).sample(750), 3000);
        assert_eq!(GammaTransition::new(6500, 3000, 0, 0).sample(1000), 4750);
    }

    #[test]
    fn retarget_starts_from_last_applied_value_not_original_start() {
        let first = GammaTransition::new(6500, 3000, 0, 2000);
        let last = first.sample(800);
        let reversed = GammaTransition::new(last, 6500, 800, 2000);
        assert_eq!(reversed.sample(800), last);
        assert_eq!(reversed.sample(2800), 6500);
    }

    #[test]
    fn unsupported_warmth_retries_but_neutral_idle_does_not() {
        assert!(!needs_attempt(6500, 6500, true, 6500));
        assert!(!needs_attempt(6500, 6500, false, 6500));
        assert!(needs_attempt(4200, 4200, false, 6500));
        assert!(needs_attempt(4200, 6500, false, 6500));
        assert!(!needs_attempt(4200, 4200, true, 6500));
        assert_eq!(RETRY_DELAY_MS, 2000);
    }

    #[test]
    fn very_large_saved_duration_remains_arithmetic_safe() {
        let t = GammaTransition::new(2700, 6500, 10, u32::MAX);
        assert!(t.sample(10 + u64::from(u32::MAX) / 2) > 2700);
        assert_eq!(t.sample(u64::MAX), 6500);
    }
}
