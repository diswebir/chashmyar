# Development and testing

[فارسی: راهنمای انتشار و ساخت](RELEASE_GUIDE_FA.md) · [User guide](USER_GUIDE_FA.md) · [Architecture](ARCHITECTURE.md)

## Supported target and prerequisites

The native application is intended for Windows x64. Linux/macOS browser previews are useful for UI work but do not implement the Windows gamma, keyboard-hook, tray or window-management paths. No native Windows runtime validation is claimed by this repository's mock tests.

On Windows install:

1. [Node.js](https://nodejs.org/) 24 LTS and npm. The package declares Node >= 20.19; CI uses 24.
2. [Rustup and Rust stable](https://www.rust-lang.org/tools/install), MSVC toolchain. The currently locked Windows dependency graph requires Rust 1.90 or newer.
3. [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++** and a Windows SDK.
4. [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/). See the [official Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```powershell
rustup default stable-msvc
rustup target add x86_64-pc-windows-msvc
node --version
rustc --version
cargo --version
npm ci
```

The lockfiles are committed. `npm ci` installs exactly the locked npm dependency graph; Windows release builds pass `--locked` to Cargo. This is a private npm package; it is not intended to be published to npm.

## Run locally

```powershell
# Native Windows development: starts Vite and a Tauri window.
npm run tauri:dev

# OR browser-only UI preview with an in-memory/mock backend (no native effects).
npm run dev
```

The browser preview uses localStorage and simulated IPC; it is useful for visual work, not a Windows integration test. Open the local address printed by Vite. Never expose the development server to an untrusted network.

## Build on Windows

```powershell
npm run version:check
npm run build:win
npm run verify:exe
npm run licenses:generate
npm run release:stage
```

Alternatively run `powershell -ExecutionPolicy Bypass -File .\build-windows.ps1` from the repository. The script checks prerequisites and runs the build/staging commands. `release/windows/` contains versioned local executables and `release/staging/` contains the current release pair, `LICENSE`, `THIRD_PARTY_NOTICES.txt` and a SHA-256 manifest. Both directories are ignored by Git. The release installer uses a 32-bit NSIS stub containing the x64 app; the portable app is x64.

The installer downloads the WebView2 bootstrapper when needed, so installation may require network access. Builds are **unsigned by default**. Signing requires a separately managed certificate and secure CI configuration; this repository does not claim to have one. `npm run verify:exe` checks PE headers and hashes, not the application's behavior or a publisher signature.

## Tests

```powershell
npm run test:logic      # host Rust unit tests for scoring / timer transitions
npm run test:compat     # serde compatibility of old/new daily records
npm run test:release    # version, checksums and draft-release safety with a fake gh CLI
npm run licenses:check  # compare notices with installed/locked dependencies
npm run build
npx playwright install chromium
npm run test:ui:all     # starts and stops a temporary local production preview
```

`test:ui:all` runs the existing smoke, regression/stress and creator-card suites using Playwright and mock IPC. It picks a free localhost port and tears down the preview afterward. Alternatively, start `npm run dev` and run `npm run test:ui`, `npm run test:ui:v23` or `npm run test:credits` individually; set `CHASHMYAR_TEST_URL` if needed. On a Linux CI host use `npx playwright install --with-deps chromium` if system libraries are missing.

The browser tests do **not** exercise WebView2, native hooks, real gamma, installer execution or system tray. Before a public release, run the Windows acceptance checklist in the [release guide](RELEASE_GUIDE_FA.md) in a safe VM or on a real machine. Avoid trying strict lock while unsaved work is open. The `--self-test` option is supplementary and writes to `%LOCALAPPDATA%\ChashmYar\startup.log`.

## Versioning

```powershell
node scripts/version.mjs check
node scripts/version.mjs set 2.3.2
node scripts/version.mjs check --tag v2.3.2
```

`set` updates the npm package and lockfile, Tauri config, Cargo manifest and the application's entry in Cargo.lock. Edit `CHANGELOG.md` separately. The automated workflow accepts stable numeric `vMAJOR.MINOR.PATCH` tags only. See [the Persian release guide](RELEASE_GUIDE_FA.md) for a complete first-time and recurring workflow.

## Dependencies and notices

`THIRD_PARTY_NOTICES.txt` is generated from locked Windows-target Cargo metadata and installed non-dev npm dependencies, including an intentionally over-inclusive set of build dependencies. Some upstream crate archives omit their license files; documented pinned fallback texts are in `third-party/fallback-licenses/`. After a dependency update, run `npm run licenses:generate`, review the diff and source-offer obligations, and commit the updated notice. An unknown package without a license file fails notice generation rather than being silently omitted. The release workflow generates the notices on Windows and uploads them beside the binaries.

## Repository layout

```text
src/                    React windows, components, i18n, state and IPC mock
src-tauri/src/          Rust state, timer, analytics and Windows integrations
src-tauri/installer/    NSIS localization
src-tauri/icons/        application icons
scripts/                version, notice, asset and release helpers
tests/                  browser/mock, logic, compatibility and release-tool tests
.github/workflows/      CI and draft-only Windows release automation
docs/                   user, architecture and maintainer guides
```

## Common errors

- MSVC linker missing: install the C++ workload and SDK, restart the shell, and use the MSVC Rust toolchain.
- Missing `node_modules` or lock mismatch: run `npm ci`, then commit intentional manifest and lockfile changes together.
- WebView2 missing: install the official Runtime; the portable executable does not bundle it.
- NSIS download/network failure: check the Actions log and retry after the upstream service recovers.
- Tauri build version mismatch: `node scripts/version.mjs check`; don't update just one manifest.
- Unexpected screenshots or tests: browser previews mock native state and cannot establish Windows correctness.
