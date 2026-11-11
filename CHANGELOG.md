# Changelog

Changes to the application are recorded here. Version tags use stable semantic versions such as `v2.4.1`.

## Unreleased

## 2.4.3

### Changed
- In-app alert, short-exercise, break and penalty sounds default to off on fresh installations and when the saved sound field is absent. They can be enabled in System → Play alert sounds; visual notifications are unchanged.
- Explicitly stored sound preferences, including a previously enabled setting, are preserved on upgrade. Browser/mock checks cover both choices and persistence; Windows audio remains a manual test.

## 2.4.2

### Fixed and optimized
- Windows warning, short-exercise and dimmer windows are shown without automatic activation using a documented, Apache-2.0 local Tao patch. Notification cards remain focusable on intentional interaction; strict break still explicitly takes focus. Interactive Windows validation is required.
- Earlier menu/capture/create signals and bounded follow-up scans can reduce popup flash; inactive overlay, settled gamma, and clean settings/widget writers no longer poll continuously. The 50 ms active-overlay fallback and capture-exclusion request remain. Out-of-context events cannot guarantee a filtered first frame.
- Gamma transitions now reach their target in the saved duration instead of exponentially drifting for many seconds; failed driver writes are retried with backoff. Shutdown serializes in-flight gamma writes before a neutral reset, and retains the watchdog if the reset fails. HDR/driver behavior remains device dependent.
- An extension-only color-safe entry no longer matches every executable. The warning chime now follows actual warning state rather than the initial creation of its hidden webview. Existing settings/defaults and stored data are not migrated or reset.

### Release automation
- Replaced the tag-triggered manual draft flow with automatic patch allocation, Windows build/checks and public Release publication on `main` pushes. Version-only commits are tagged without changing `main`.
- Verify each uploaded asset's GitHub SHA-256 digest before publication; resume matching interrupted drafts and refuse to overwrite published or mismatched assets. The workflow and native app still require verification in a real GitHub repository and on Windows.

## 2.4.1

### Changed
- To reduce the brief unfiltered flash when a menu or popup opens, the dimmer now reacts to Windows foreground/menu/show/uncloak events on a separate message-loop thread. It posts a nonactivating asynchronous Z-order request, with a 50 ms polling fallback (previously 100 ms); duplicate/reentrant work is bounded.
- The event listener uses event type and window handles locally, without reading window titles or keystrokes, and shuts down with the app. Existing settings, click-through behavior and the Windows capture-exclusion request are unchanged.
- Windows notifications and repainting are asynchronous: the first frame may still appear unfiltered, especially with custom, protected or fullscreen surfaces. The new native path was cross-compiled but needs real-Windows testing; no universal zero-flash guarantee is made.

## 2.4.0

### Added and changed
- Added five guided eye, body and breathing activities, for thirteen illustrated activities in total. Exercise rotation and the short-exercise duration now default to 20 seconds on a fresh installation.
- Fresh installations enable night scheduling, automatic next work, program startup with Windows and timer start on launch, in addition to the existing care features. Explicitly saved settings are preserved.
- Aligned slider endpoint labels with the physical left-to-right track in both languages, and removed the short-exercise toast shadow.
- The dimmer uses virtual-desktop bounds, attempts to stay above ordinary new topmost menus, and requests Windows capture exclusion on Windows 10 2004 or newer. It reports when exclusion could not be confirmed. Capture, GPU/HDR and protected-desktop behavior is not guaranteed and requires Windows testing.
- Propagated explicit gamma API failures to the software warmth fallback; corrected startup probe ordering. Gamma API success is not proof that a driver applied the change.
- Added GitHub-ready documentation, contribution/security templates, dependency notices and the original draft-only release workflow (now superseded by the automatic flow above).

## 2.3.1

### Changed
- Redesigned the creator credit in the sidebar and About screen with one heart, clearer author hierarchy and a readable website link.
- Preserved Persian/English copy, light/dark themes and the native creator-site command.

## 2.3.0

### Added and changed
- Reworked eye-care adherence and work-timing regularity scores with explicit outcome counts, no-data handling and weighted weekly aggregation.
- Improved old-record compatibility without inventing historical outcomes.
- Made dark warning, short-exercise and expanded widget surfaces opaque/readable; placed a close × at the top of the warning and made snooze choices more visibly clickable.
- Renamed the short exercise in Persian and added seconds to the system clock.
- Added safeguards around rapid interaction, state ordering, timer decisions and persistence; native Windows stress testing remains necessary.

## 2.2.0

### Changed
- Redesigned the break-screen experience and exercise guidance, including localized text and typography.
- Made light appearance the fresh-install default while preserving saved preferences.

Earlier development history is not reconstructed here. Refer to Git history and individual published Release notes when available.
