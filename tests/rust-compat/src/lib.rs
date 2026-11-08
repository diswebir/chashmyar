#[path = "../../../src-tauri/src/analytics_record.rs"]
mod analytics_record;

#[cfg(test)]
mod tests {
    use super::analytics_record::DailyRecord;
    use serde_json::json;

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
