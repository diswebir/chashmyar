//! Portable gamma-transition policy. Hardware calls and actual color output
//! remain platform/driver dependent and require a real Windows test.

pub const DEFAULT_TRANSITION_MS: u32 = 2_000;
pub const RETRY_DELAY_MS: u64 = 2_000;

/// Win32 process wait: only WAIT_OBJECT_0 (0) proves the observed handle was
/// signaled. A failed or unexpected wait must never neutralize a live parent.
pub fn watchdog_should_restore(wait_result: u32) -> bool { wait_result == 0 }

/// A primary-DC readback is a diagnostic hint, never proof of visual output.
/// Tolerate quantization to roughly 8-bit DAC values (512 of 65535).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Readback { Matches, Differs, Unavailable }
impl Readback {
    pub fn as_str(self) -> &'static str {
        match self { Self::Matches => "matches", Self::Differs => "differs", Self::Unavailable => "unavailable" }
    }
}
pub fn classify_readback(expected: &[u16], observed: Option<&[u16]>) -> Readback {
    let Some(observed) = observed else { return Readback::Unavailable; };
    if expected.len() != 768 || observed.len() != 768 { return Readback::Unavailable; }
    if expected.iter().zip(observed).any(|(a, b)| a.abs_diff(*b) > 512) { Readback::Differs }
    else { Readback::Matches }
}

/// Zero historically means the default in the overlay CSS too. Preserve all
/// other previously valid u32 durations, including long custom values.
pub fn transition_ms(saved: u32) -> u32 {
    if saved == 0 { DEFAULT_TRANSITION_MS } else { saved }
}

/// An explicit reset can be fast, but only while the latest locked state is
/// still off. A delayed reset must not override a newer enable operation.
pub fn transition_for_explicit_off(saved: u32, request_fast_off: bool, latest_enabled: bool) -> u32 {
    if request_fast_off && !latest_enabled { 1 } else { transition_ms(saved) }
}

/// A successful neutral startup probe alone is not a successful warm write.
/// This reflects API reports only; it never guarantees physical appearance.
pub fn reported_warmth(any_accepted: bool, enabled: bool, paused: bool, held: bool,
                       target: u32, last_api_kelvin: u32, neutral: u32) -> bool {
    any_accepted && enabled && !paused && !held && target < neutral && last_api_kelvin < neutral
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
        // A u32 duration and u32 endpoints can multiply beyond i64. Hardware
        // targets are clamped separately, but the pure policy stays safe for
        // the entire historically accepted range without changing preferences.
        let delta = i128::from(self.target) - i128::from(self.start);
        let value = i128::from(self.start) + delta * i128::from(elapsed) / i128::from(self.duration_ms);
        value.clamp(i128::from(self.start.min(self.target)), i128::from(self.start.max(self.target))) as u32
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
    fn watchdog_restores_only_for_a_confirmed_signaled_parent() {
        assert!(watchdog_should_restore(0)); // WAIT_OBJECT_0
        assert!(!watchdog_should_restore(0xffff_ffff)); // WAIT_FAILED
        assert!(!watchdog_should_restore(258)); // WAIT_TIMEOUT
        assert!(!watchdog_should_restore(128)); // WAIT_ABANDONED or unexpected
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
    fn a_neutral_probe_is_not_reported_as_an_applied_warm_filter() {
        assert!(!reported_warmth(true, true, false, false, 3200, 6500, 6500));
        assert!(reported_warmth(true, true, false, false, 3200, 4500, 6500));
        assert!(!reported_warmth(false, true, false, false, 3200, 4500, 6500));
        assert!(!reported_warmth(true, true, true, false, 3200, 4500, 6500));
        assert!(!reported_warmth(true, true, false, true, 3200, 4500, 6500));
    }

    #[test]
    fn delayed_reset_uses_latest_eye_state_instead_of_a_stale_off_request() {
        assert_eq!(transition_for_explicit_off(2000, true, false), 1);
        assert_eq!(transition_for_explicit_off(2000, true, true), 2000);
        assert_eq!(transition_for_explicit_off(750, false, false), 750);
        assert_eq!(transition_for_explicit_off(0, false, true), 2000);
    }

    #[test]
    fn readback_is_a_tolerant_primary_lut_hint_not_visual_proof() {
        let expected = vec![20_000u16; 768];
        assert_eq!(classify_readback(&expected, None), Readback::Unavailable);
        assert_eq!(classify_readback(&expected, Some(&[1, 2])), Readback::Unavailable);
        assert_eq!(classify_readback(&expected, Some(&expected)), Readback::Matches);
        let mut observed = expected.clone();
        observed[500] += 512;
        assert_eq!(classify_readback(&expected, Some(&observed)), Readback::Matches);
        observed[500] += 1;
        assert_eq!(classify_readback(&expected, Some(&observed)), Readback::Differs);
    }

    #[test]
    fn historically_valid_long_durations_are_not_silently_shortened() {
        assert_eq!(transition_ms(0), 2000);
        assert_eq!(transition_ms(750), 750);
        assert_eq!(transition_ms(120_000), 120_000);
        assert_eq!(transition_ms(u32::MAX), u32::MAX);
    }

    #[test]
    fn very_large_saved_duration_and_extreme_values_remain_arithmetic_safe() {
        let t = GammaTransition::new(2700, 6500, 10, u32::MAX);
        let middle = t.sample(10 + u64::from(u32::MAX) / 2);
        assert!(middle > 2700 && middle < 6500);
        assert_eq!(t.sample(u64::MAX), 6500);
        let extreme = GammaTransition::new(0, u32::MAX, 0, u32::MAX);
        assert_eq!(extreme.sample(u64::from(u32::MAX) / 2), u32::MAX / 2);
        assert_eq!(extreme.sample(u64::MAX), u32::MAX);
    }
}
