//! Transparent, non-medical activity scores. Missing denominators stay `None`.
//! A timer ending is an observed event, not proof of eye health or behaviour.

/// Rounded percentage with a missing value when no opportunity has ended.
fn percent128(completed: u128, skipped: u128) -> Option<u32> {
    let total = completed + skipped;
    if total == 0 { return None; }
    Some(((completed * 100 + total / 2) / total).min(100) as u32)
}

pub fn completion_percent(completed: u64, skipped: u64) -> Option<u32> {
    percent128(u128::from(completed), u128::from(skipped))
}

/// Eye-care habit = completed full breaks and short exercises divided by all
/// resolved full breaks/exercises. It is not a clinical eye-health measure.
pub fn eye_care_score(full_completed: u64, full_skipped: u64, exercise_completed: u64, exercise_skipped: u64) -> Option<u32> {
    percent128(
        u128::from(full_completed) + u128::from(exercise_completed),
        u128::from(full_skipped) + u128::from(exercise_skipped),
    )
}

/// Regularity = work sessions completed without snoozing divided by ended
/// sessions (on time + completed after snooze + ended early). Ongoing sessions
/// are not penalized; this does not judge the quality of the work.
pub fn regularity_score(on_time: u64, delayed: u64, ended_early: u64) -> Option<u32> {
    percent128(u128::from(on_time), u128::from(delayed) + u128::from(ended_early))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn no_data_is_not_a_perfect_score() {
        assert_eq!(eye_care_score(0, 0, 0, 0), None);
        assert_eq!(regularity_score(0, 0, 0), None);
    }
    #[test] fn completion_scores_use_observed_outcomes() {
        assert_eq!(eye_care_score(2, 0, 1, 1), Some(75));
        assert_eq!(eye_care_score(0, 2, 0, 0), Some(0));
        assert_eq!(eye_care_score(1, 0, 0, 0), Some(100));
    }
    #[test] fn regularity_counts_delays_and_interrupted_sessions() {
        assert_eq!(regularity_score(1, 1, 1), Some(33));
        assert_eq!(regularity_score(3, 1, 0), Some(75));
        assert_eq!(regularity_score(0, 1, 0), Some(0));
    }
    #[test] fn weekly_score_weights_all_outcomes() {
        // Day one: 1/1 = 100%; day two: 3/4 = 75%. Weekly is 4/5 = 80%, not 88%.
        assert_eq!(eye_care_score(2, 1, 2, 0), Some(80));
        assert_eq!(regularity_score(2, 2, 1), Some(40));
    }
    #[test] fn rounds_and_handles_large_inputs_without_overflow() {
        assert_eq!(completion_percent(2, 1), Some(67));
        assert_eq!(completion_percent(u64::MAX, u64::MAX), Some(50));
        assert_eq!(completion_percent(u64::MAX, 0), Some(100));
        assert_eq!(eye_care_score(u64::MAX, u64::MAX, u64::MAX, 0), Some(67));
        assert_eq!(regularity_score(u64::MAX, u64::MAX, u64::MAX), Some(33));
    }
}
