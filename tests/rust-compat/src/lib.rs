#[path = "../../../src-tauri/src/analytics_record.rs"]
mod analytics_record;

// Compile the real settings implementation against small platform stubs. This
// tests deserialization and defaults without launching Tauri or a Windows UI.
#[cfg(test)]
#[path = "../../../src-tauri/src/state.rs"]
mod state;
#[cfg(test)] mod analytics { pub fn epoch() -> u64 { 0 } }
#[cfg(test)] mod display {
    pub const NEUTRAL_KELVIN: u32 = 6500;
    pub fn current_kelvin() -> u32 { NEUTRAL_KELVIN }
}
#[cfg(test)] mod windows { pub fn capture_exclusion_active() -> bool { false } }

#[cfg(test)]
mod tests {
    use super::analytics_record::DailyRecord;
    use serde_json::json;

    #[test]
    fn fresh_install_enables_requested_defaults() {
        let settings = super::state::Settings::default();
        assert!(settings.eye.enabled && settings.eye.schedule_enabled && settings.eye.color_safe_enabled);
        assert!(settings.timer.auto_start_break && settings.timer.auto_start_next_work);
        assert!(settings.timer.idle_detection_enabled && settings.timer.micro_break_enabled);
        assert_eq!(settings.timer.micro_break_interval_minutes, 20);
        assert_eq!(settings.timer.micro_break_seconds, 20);
        assert!(settings.lock.eye_exercises && settings.lock.body_exercises && settings.lock.emergency_unlock);
        assert_eq!(settings.lock.rotate_seconds, 20);
        assert!(settings.system.autostart && settings.system.auto_start_timer_on_launch);
        assert!(settings.system.eye_care_on_launch && settings.system.minimize_to_tray);
        assert!(!settings.system.sound_enabled, "fresh installations are silent");
    }

    #[test]
    fn sound_defaults_off_when_absent_but_saved_choices_survive_round_trip() {
        // Both a missing group and a missing field must use the new default.
        for value in [json!({}), json!({"system": {}}), json!({"system": {"autostart": false}})] {
            let settings: super::state::Settings = serde_json::from_value(value).unwrap();
            assert!(!settings.system.sound_enabled);
        }
        // Never migrate or overwrite an explicit choice from an older version.
        for enabled in [false, true] {
            let settings: super::state::Settings = serde_json::from_value(
                json!({"system": {"soundEnabled": enabled}}),
            ).unwrap();
            assert_eq!(settings.system.sound_enabled, enabled);
            let json = serde_json::to_value(&settings).unwrap();
            assert_eq!(json["system"]["soundEnabled"], enabled);
            let reloaded: super::state::Settings = serde_json::from_value(json).unwrap();
            assert_eq!(reloaded.system.sound_enabled, enabled);
        }
    }

    #[test]
    fn explicitly_saved_old_preferences_are_not_overwritten_by_new_defaults() {
        let value = json!({
            "eye": {"scheduleEnabled": false, "colorSafeEnabled": false},
            "timer": {"autoStartNextWork": false, "microBreakSeconds": 15, "microBreakIntervalMinutes": 15},
            "lock": {"rotateSeconds": 45, "eyeExercises": false},
            "system": {"autostart": false, "autoStartTimerOnLaunch": false}
        });
        let settings: super::state::Settings = serde_json::from_value(value).unwrap();
        assert!(!settings.eye.schedule_enabled && !settings.eye.color_safe_enabled);
        assert!(!settings.timer.auto_start_next_work);
        assert_eq!(settings.timer.micro_break_seconds, 15);
        assert_eq!(settings.timer.micro_break_interval_minutes, 15);
        assert_eq!(settings.lock.rotate_seconds, 45);
        assert!(!settings.lock.eye_exercises && !settings.system.autostart && !settings.system.auto_start_timer_on_launch);
        let saved = serde_json::to_value(settings).unwrap();
        assert_eq!(saved["lock"]["rotateSeconds"], 45);
        assert_eq!(saved["system"]["autostart"], false);
    }

    #[test]
    fn old_records_keep_totals_without_inventing_outcomes() {
        let old = json!({
            "deepWorkMinutes": 125, "completedBreaks": 4, "naturalBreaks": 2,
            "microBreaksCompleted": 3, "snoozeUsedCount": 2,
            "penaltyCount": 1, "emergencySkips": 1
        });
        let record: DailyRecord = serde_json::from_value(old).unwrap();
        assert_eq!(record.deep_work_minutes, 125);
        assert_eq!(record.completed_breaks, 4);
        assert_eq!(record.micro_breaks_completed, 3);
        assert_eq!(record.snooze_used_count, 2);
        assert_eq!(record.observed_breaks_completed, 0);
        assert_eq!(record.observed_breaks_skipped, 0);
        assert_eq!(record.observed_exercises_completed, 0);
        assert_eq!(record.observed_exercises_skipped, 0);
        assert_eq!(record.work_sessions_on_time, 0);
        assert_eq!(record.work_sessions_delayed, 0);
        assert_eq!(record.work_sessions_ended_early, 0);
        assert_eq!(record.tracked_focus_seconds, 0);
        let stored = serde_json::to_value(record).unwrap();
        assert_eq!(stored["deepWorkMinutes"], 125);
        assert_eq!(stored["observedBreaksCompleted"], 0);
    }

    #[test]
    fn new_records_round_trip_partial_minutes_and_session_outcomes() {
        let mut record = DailyRecord::default();
        record.deep_work_minutes = 8;
        record.tracked_focus_seconds = 119;
        record.observed_breaks_completed = 2;
        record.observed_exercises_skipped = 1;
        record.work_sessions_delayed = 1;
        let stored = serde_json::to_string(&record).unwrap();
        let loaded: DailyRecord = serde_json::from_str(&stored).unwrap();
        assert_eq!(loaded.deep_work_minutes, 8);
        assert_eq!(loaded.tracked_focus_seconds, 119);
        assert_eq!(loaded.observed_breaks_completed, 2);
        assert_eq!(loaded.observed_exercises_skipped, 1);
        assert_eq!(loaded.work_sessions_delayed, 1);
    }
}
