# Architecture and data model

## Overview

```text
React / TypeScript (six windows, bilingual UI, Zustand)
        │  Tauri commands and app://snapshot events
        ▼
Rust core (shared state + timer, persistence and analytics)
        ├── Windows display/gamma, idle and foreground watchers
        ├── break overlay, keyboard hook and emergency watcher
        ├── tray / native windows
        └── local settings, daily analytics and diagnostics
```

The Rust core is the authoritative source for native state. `src/lib/bridge.ts` calls Tauri in a native webview and supplies a separate in-memory/localStorage mock when opened in a normal browser. A browser screenshot or mock test cannot prove native integration.

## Windows and important paths

| Label | Responsibility |
|---|---|
| `main` | Settings, dashboard, analytics and About |
| `micro-bar` | Floating/docked compact timer |
| `snooze-alert` | Break warning and snooze choices |
| `break-lock` | Full-screen break / exercises |
| `dimmer-overlay` | Software brightness overlay |
| `micro-break` | Scheduled short-exercise toast |

Frontend: `src/windows/`, `src/components/`, `src/store/useAppStore.ts`, `src/lib/i18n.ts`. Rust: `src-tauri/src/state.rs`, `engine.rs`, `timer.rs`, `timer_rules.rs`, `windows.rs`, `persistence.rs`, `analytics.rs`, `analytics_record.rs`, `score.rs`, `display.rs`, `focus_guard.rs`, `tray.rs` and `commands.rs`.

The frontend serializes mutation requests and ignores stale snapshot revisions. On the native side, window/persistence operations and state transitions are coordinated to reduce race and lock-order risks; the timer validates a decision against the latest state. These measures reduce plausible failures but do not guarantee that a freeze cannot occur. Verify rapid interaction on real Windows.

## Persistence and privacy

Settings and daily records use Tauri's local store, normally under `%APPDATA%\com.chashmyar.desktop\`:

- `chashmyar.settings.json`
- `chashmyar.analytics.json`

Diagnostics are normally `%LOCALAPPDATA%\ChashmYar\startup.log`; the log records an executable path and may reveal a username. Back up the app-data folder while the app is stopped. The app has no analytics-upload service in the current code. The foreground watcher reads the active process name and window title for the color-safe list; opening the creator website launches the system handler, and the installer can download WebView2.

Focus time counts active work-timer seconds, excluding the short-exercise period. It is flushed periodically and on transitions, day change and shutdown; an unexpected crash can lose an unflushed partial minute. Reset invalidates old pending flushes. Recorded timer time is not proof of human activity or concentration.

## Scores and migrations

- **Eye-care adherence:** `(full breaks completed + scheduled short exercises completed) / (all resolved full-break and scheduled-exercise opportunities)`. Preview exercises and unresolved opportunities are excluded.
- **Work-timing regularity:** `on-time work sessions / (on-time + delayed + ended-early work sessions)`.
- A zero denominator yields no score (`null`, displayed as `—`), not 100%. Seven-day scores are calculated from aggregated counts, not an unweighted mean of daily percentages.
- Old records retain their historical totals. Old data lack the denominators required for the new scores, so the migration does not fabricate outcomes. New opportunities gradually build meaningful scores.

These are self-tracking indicators, not a medical diagnosis and not verification that a person actually performed an exercise.

## System limitations

- Tauri's WebView2 and Windows APIs are required for native execution. The lock cannot prevent Windows secure attention sequences such as Ctrl+Alt+Del.
- Gamma effects depend on graphics hardware, HDR, driver and other software. Reset applies a neutral ramp and may not restore a custom previous calibration.
- The emergency watcher samples physical Ctrl and Shift; when enabled, holding both for the configured time (clamped to 2–30 seconds) requests emergency exit from the break.
- The executables are unsigned by default. There is no auto-update service or code-signing certificate configured in this repository.

## Quality boundaries

CI runs TypeScript/Vite build, pure Rust scoring/timer tests, legacy compatibility tests, release-helper tests and browser/mock IPC suites. The tagged Windows workflow additionally compiles the app and produces a draft release. Neither workflow automatically validates native Windows UI interaction or installed behavior. Perform the checklist in `docs/RELEASE_GUIDE_FA.md` before publishing.
