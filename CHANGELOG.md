# Changelog

Changes to the application are recorded here. Version headers describe source baselines; automatic release tags may differ when newer tags already exist.

## 2.4.8 — corrected source baseline

### Fixed
- Fixed the 2.4.7 portable production build: both flavors now use Tauri CLI so `tauri/custom-protocol` is enabled and the frontend is embedded. Release-mode compilation refuses a development-protocol build.
- Added a mandatory headless audit of the actual staged portable EXE and the application extracted from the actual staged NSIS installer. It compares all embedded asset hashes with `dist` and checks protocol, version, flavor and updater public key. It does not execute an interactive WebView2 session.
- Grouped Vite and React-plugin version proposals, avoided a Vite 8 minifier incompatibility, deferred the breaking Tailwind major migration, and added reviewable notice artifacts for failed dependency PRs without making the notice check optional. See [the Persian fix guide](FIX_2.4.8_FA.md).
- Preserve the signing-key workflow and no-overwrite automatic patch allocation; retain the existing key when upgrading. Real GitHub execution of this corrected workflow and interactive Windows acceptance tests remain necessary.

## 2.4.7 — published source baseline

### Added
- Experimental opt-in full-screen deutan, protan and tritan colour-vision recolouring with adjustable strength, Persian/English controls, color-safe hand-off, saved preferences and best-effort conflict/restoration policy. This is an approximation, not a medical treatment or a guarantee of improved distinction. Browser/mocked and host tests do not validate Windows Magnification, HDR, physical display output or crash recovery; real-Windows testing remains necessary.
- Signed GitHub updater for installed and portable builds: background check and verified download, passive notice and localized About controls; installation/restart requires explicit confirmation. Older versions without the embedded key require a manual first upgrade.
- Release automation injects a maintainer-supplied public key, signs both Windows assets, verifies signatures and signed versions, and publishes the two signatures and updater manifest alongside the existing files. No production signing key is included.

### Fixed
- Fixed automatic version allocation so an untagged baseline newer than all existing stable tags is released as-is: 2.4.7 follows v2.4.6 instead of being skipped. Equal/higher tags still advance safely; retries preserve their tag and an occupied patch 65535 fails closed.
- Fixed stamping/publication when no version files change, and validate the complete contents and Git modes of version files rather than trusting filenames. Added offline tests for unchanged, partial and tampered files and Windows-style CRLF checkouts.
- Re-fetch tags before publishing, explicitly mark the verified release as GitHub Latest and confirm the updater endpoint selects it. Tests cover delayed/stale Latest and a competing higher remote tag; external writers still require operational coordination.
- Added preventative same-thread Z-order handling for the app's own warning, short-exercise and updater notifications so they remain below the active dimmer during show/reordering; removed redundant post-show topmost promotions. Native Windows visual/click testing is still required; the asynchronous fallback for other applications cannot guarantee a filtered first frame.
- Restored readable contrast in the weekly chart's hover tooltip in the light theme: it now uses an opaque light surface with dark text. The dark-theme tooltip and chart data are unchanged; browser/mock regression checks cover both themes and languages.

### Branding and documentation
- Replaced the previous app icon with the approved black-and-white eye design. Generated consistent PNGs and a seven-size Windows ICO; the same mark is used in the app header, tray's default icon, favicon and both READMEs. Previously built 2.4.3 executables are unchanged and do not contain this logo.
- Refreshed Persian light/dark browser screenshots and expanded the Persian GitHub quickstart, English CI/release guide, user, architecture, development and security documentation. Screenshots use sample mock data.
- Added source-only checks for artwork hashes, PNG/ICO dimensions and consistency, local documentation links, and browser loading in both languages/themes. Included an optional reproducible icon generator; normal builds do not require Python or Pillow.
- The 2.4.7 release was later published on GitHub. Its portable executable has the localhost/empty-assets defect corrected above; actual Windows taskbar/tray rendering and interactive behavior remain unverified here.

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
