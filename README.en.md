# ChashmYar

A Windows desktop companion for work/break scheduling, eye-care reminders, screen color temperature and brightness. Built with Tauri 2, Rust, React and TypeScript. The interface supports Persian and English and light/dark themes.

[فارسی](README.md) · [User guide (Persian)](docs/USER_GUIDE_FA.md) · [Development](docs/DEVELOPMENT.md) · [Release guide (Persian)](docs/RELEASE_GUIDE_FA.md) · [MIT license](LICENSE)

![ChashmYar dashboard in light mode](docs/assets/dashboard-fa-light.png)

The screenshot shows the browser preview with mock data, not native Windows integration.

## Features

- Work and break timer, snooze choices, short exercises and break-screen guides.
- Floating/docked timer widget, configurable color temperature and brightness, color-safe app list and tray controls.
- Two explainable scores based on recorded timer outcomes, with no fabricated score when data is missing.
- Persian/English localization, local settings and analytics, light/dark appearance.
- Fresh installs enable Windows autostart after the first launch, start the timer on launch, enable the night schedule, and rotate the thirteen exercise guides every 20 seconds. Existing saved choices are retained.

This is not a medical device. Scores do not establish eye health, actual exercise or concentration. Gamma behavior depends on hardware/driver/HDR. When enabled, emergency exit during a strict break is holding **Ctrl and Shift** together for the configured duration. Test strict mode in a safe environment first; Ctrl+Alt+Del cannot be blocked by an ordinary Windows application.

On Windows 10 version 2004 or newer, the software overlay requests exclusion from compatible screen-capture methods and reacts to menu/window events to get above ordinary topmost popups sooner. Events and rendering are asynchronous, so a first-frame flash is still possible. Capture behavior, protected screens, HDR, graphics drivers and all recorder types cannot be guaranteed; verify with your own Windows setup. See the [user guide](docs/USER_GUIDE_FA.md).

## Download and requirements

Open the repository's **Releases** section once an automatic release has been published. Choose the Windows x64 setup executable or the portable executable; check `SHA256SUMS.txt` against your download. The portable app still stores settings and analytics in the user's data directory.

Microsoft Edge WebView2 Runtime is required. The setup can download the bootstrapper when it is absent; portable users may [install the Runtime separately](https://developer.microsoft.com/en-us/microsoft-edge/webview2/). Default builds are **unsigned** and may trigger SmartScreen. The included hash manifest checks file integrity, not publisher identity.

Settings and analytics are normally in `%APPDATA%\com.chashmyar.desktop\`; diagnostics are normally in `%LOCALAPPDATA%\ChashmYar\startup.log`. Back up the data while the app is stopped and review logs for private paths before sharing. The current code does not provide a remote analytics upload service; the color-safe watcher reads foreground app information locally. The separate overlay listener reacts to event types and window handles, without reading titles or keystrokes; the creator link opens the system browser.

## Build and test

On Windows install Node.js 24 LTS, Rust stable/MSVC, Visual Studio C++ Build Tools and WebView2, then:

```powershell
npm ci
npm run version:check
npm run build:win
npm run verify:exe
npm run licenses:generate
npm run release:stage
```

Local builds go in ignored `release/windows/`; staged release assets and hashes go in `release/staging/`. Tests:

```powershell
npm run test:logic
npm run test:compat
npm run test:release
npm run build
npx playwright install chromium
npm run test:ui:all
```

Browser tests use mock IPC. They do not verify a real installer, WebView2, keyboard hooks, gamma or tray behavior. The supplied v2.4.1 binaries were cross-built on Linux; the new event-driven overlay path has not been run on Windows in this environment. GitHub Actions is configured but has not yet been exercised in the user's repository.

Every push to `main` is intended to increment the patch version, build Windows x64 and **publish a GitHub Release automatically** after its checks pass. With the `2.4.1` baseline and no later tags, the first release is normally `v2.4.2`. `main` keeps its baseline version; the release tag, source archive and binaries carry the new version. No manual tag or Publish button is required.

A public download requires a public repository, enabled Actions and permission to write releases. Failed checks, queue limits or superseded/out-of-order runs can prevent a release. Automated publication is not a native Windows acceptance test. Full instructions and recovery: [release guide](docs/RELEASE_GUIDE_FA.md).

See [architecture and scoring](docs/ARCHITECTURE.md), [contributing](CONTRIBUTING.md), [security](SECURITY.md), [changelog](CHANGELOG.md) and [third-party notices](THIRD_PARTY_NOTICES.txt). ChashmYar's source is MIT-licensed; third-party components retain their own licenses.

Created by Reza Jantrani — [disweb.ir](https://disweb.ir/).
