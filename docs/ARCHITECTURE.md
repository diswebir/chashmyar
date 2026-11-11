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
| `dimmer-overlay` | Click-through virtual-desktop brightness / fallback warmth overlay |
| `micro-break` | Scheduled short-exercise toast |

Frontend: `src/windows/`, `src/components/`, `src/store/useAppStore.ts`, `src/lib/i18n.ts`. Rust: `src-tauri/src/state.rs`, `engine.rs`, `timer.rs`, `timer_rules.rs`, `windows.rs`, `persistence.rs`, `analytics.rs`, `analytics_record.rs`, `score.rs`, `display.rs`, `focus_guard.rs`, `tray.rs` and `commands.rs`.

The frontend serializes mutation requests and ignores stale snapshot revisions. On the native side, window/persistence operations and state transitions are coordinated to reduce race and lock-order risks; the timer validates a decision against the latest state. These measures reduce plausible failures but do not guarantee that a freeze cannot occur. Verify rapid interaction on real Windows.

The overlay has a dedicated out-of-context WinEvent message-loop thread for foreground, menu, capture, dialog, top-level create/show and uncloak notifications. It does not inject code into other processes, and the callback does not read titles or input, take the runtime lock, or synchronously call Tauri. It checks a bounded Z-order stack, posts a nonactivating asynchronous raise only when needed, coalesces brief duplicate/reentrant requests, and ignores overlay/child-object events. After a qualifying early event it requests a rate-limited burst at roughly 3, 8, 16 and 32 ms, to catch a popup inserted after its event. The 50 ms active-overlay fallback and two-second topology check remain. When the overlay is off, its worker parks until a state change instead of waking 20 times per second. Shutdown wakes the worker, posts `WM_QUIT` and unhooks on the listener thread. Event delivery and UI rendering are asynchronous: neither the burst schedule nor a filtered first frame is guaranteed.

A locally patched Apache-2.0 Tao 0.37.2 preserves Tauri's own visible-state bookkeeping while using `SW_SHOWNA` for windows created hidden and unfocused, and for non-focusable windows. Snooze and short-exercise cards remain focusable when a user deliberately interacts; the dimmer is non-focusable, and the strict break explicitly focuses itself. Details and attribution are in `src-tauri/vendor/tao/CHASHMYAR_PATCH.md`. Native WebView2 interaction and foreground/caret behavior must still be tested on real Windows.

The gamma worker parks when settled, linearly interpolates over the saved duration (default two seconds), and backs off failed driver calls for two seconds while allowing a new target to wake it. Gamma driver writes are serialized; shutdown stops new warm writes before the neutral reset. A failed neutral reset leaves the watchdog armed for process exit. The ten-second reassertion does not keep forcing an identity ramp when warmth is disabled. The settings and widget-position writers likewise park between batches; their coalescing delays are preserved. These are scheduling changes, not measured Windows CPU or power benchmarks.

## Persistence and privacy

Settings and daily records use Tauri's local store, normally under `%APPDATA%\com.chashmyar.desktop\`:

- `chashmyar.settings.json`
- `chashmyar.analytics.json`

Diagnostics are normally `%LOCALAPPDATA%\ChashmYar\startup.log`; the log records an executable path and may reveal a username. Back up the app-data folder while the app is stopped. The app has no analytics-upload service in the current code. The foreground watcher reads the active process name and window title for the color-safe list. Separately, the overlay WinEvent listener reacts locally to window handles and event types but does not read titles, keystrokes or window contents; opening the creator website launches the system handler, and the installer can download WebView2.

Focus time counts active work-timer seconds, excluding the short-exercise period. It is flushed periodically and on transitions, day change and shutdown; an unexpected crash can lose an unflushed partial minute. Reset invalidates old pending flushes. Recorded timer time is not proof of human activity or concentration.

## Scores and migrations

- **Eye-care adherence:** `(full breaks completed + scheduled short exercises completed) / (all resolved full-break and scheduled-exercise opportunities)`. Preview exercises and unresolved opportunities are excluded.
- **Work-timing regularity:** `on-time work sessions / (on-time + delayed + ended-early work sessions)`.
- A zero denominator yields no score (`null`, displayed as `—`), not 100%. Seven-day scores are calculated from aggregated counts, not an unweighted mean of daily percentages.
- Old records retain their historical totals. Old data lack the denominators required for the new scores, so the migration does not fabricate outcomes. New opportunities gradually build meaningful scores.

These are self-tracking indicators, not a medical diagnosis and not verification that a person actually performed an exercise.

## System limitations

- Tauri's WebView2 and Windows APIs are required for native execution. The lock cannot prevent Windows secure attention sequences such as Ctrl+Alt+Del.
- Gamma effects depend on graphics hardware, HDR, driver and other software. Windows can report a successful ramp call without applying it; the status is not proof of a physical change. Reset applies a neutral ramp and may not restore a custom previous calibration.
- A single click-through overlay is fitted to the virtual desktop and its Z-order is checked while visible; another topmost window, fullscreen mode, secure desktop, DPI/topology change or driver can still cause gaps. Windows 10 2004+ is asked to exclude the overlay using `WDA_EXCLUDEFROMCAPTURE`; an accepted affinity is not a guarantee for every capture pipeline. Older systems are not assigned the flag because they can turn the captured area black. Verify actual Snipping Tool and recording behavior on Windows.
- New-install settings enable startup and timer auto-start; explicitly saved older values are not migrated to new defaults.
- The emergency watcher samples physical Ctrl and Shift; when enabled, holding both for the configured time (clamped to 2–30 seconds) requests emergency exit from the break.
- The executables are unsigned by default. There is no auto-update service or code-signing certificate configured in this repository.

## Quality boundaries

CI runs TypeScript/Vite build, pure Rust scoring/timer/overlay-policy tests, settings and record compatibility tests, release-helper tests and browser/mock IPC suites. On a push to `main`, a separate serialized Windows workflow allocates the next patch, builds and tests it, tags a version-only child of the pushed source and automatically publishes the verified assets. `main` is not modified. Publication uses a temporary draft and a separate write-enabled job; only matching uploaded SHA-256 digests are accepted. Neither workflow automatically validates native Windows UI interaction or installed behavior. Run the checklist in `docs/RELEASE_GUIDE_FA.md` before pushing changes when practical; publication itself is not held for manual approval.
