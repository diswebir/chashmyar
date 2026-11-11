# Development and testing

[فارسی: راهنمای انتشار و ساخت](RELEASE_GUIDE_FA.md) · [User guide](USER_GUIDE_FA.md) · [Architecture](ARCHITECTURE.md) · [CI and release](CI_AND_RELEASE.md)

## Supported target and prerequisites

The native application is intended for Windows x64. Linux/macOS browser previews are useful for UI work but do not implement the Windows gamma, keyboard-hook, tray or window-management paths. No native Windows runtime validation is claimed by this repository's mock tests.

On Windows install:

1. [Node.js](https://nodejs.org/) 24 LTS and npm. The package declares Node >= 20.19; CI uses 24.
2. [Rustup and Rust stable](https://www.rust-lang.org/tools/install), MSVC toolchain. The currently locked Windows dependency graph requires Rust 1.90 or newer.
3. [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++** and a Windows SDK.
4. [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/). See the [official Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```powershell
rustup default stable-x86_64-pc-windows-msvc
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
npm run test:logic      # pure Rust policies, timed interpolation, parked worker signal
npm run test:windows-policy # source-integrity checks, not an interactive Windows test
npm run test:compat     # saved data; on non-Windows also a fake-driver worker/shutdown test
npm run test:release    # version, checksums and auto-release tests with local Git + fake gh
npm run test:branding   # approved master/derived checksums, PNGs, ICO frames and Tauri references
npm run test:docs       # local documentation links; does not fetch external sites
npm run licenses:check  # compare notices with installed/locked dependencies
npm run build
npx playwright install chromium
npm run test:ui:all     # starts and stops a temporary local production preview
```

`test:ui:all` runs the smoke, v2.3/v2.4 regression/stress, sound-default, creator-card and branding UI suites using Playwright and mock IPC. The branding suite checks that the header and favicon load in both themes/languages at two viewport sizes. The sound suite uses a fake audio context and a Tauri event stub; it verifies the toggle, saved values and chime routing, not real sound output. The runner picks a free localhost port and tears down the preview afterward. Alternatively, start `npm run dev` and run `npm run test:ui`, `npm run test:ui:v23`, `npm run test:ui:v24`, `npm run test:sound`, `npm run test:credits` or `npm run test:branding:ui` individually; set `CHASHMYAR_TEST_URL` if needed. On a Linux CI host use `npx playwright install --with-deps chromium` if system libraries are missing.

The browser tests do **not** exercise WebView2, native keyboard/WinEvent hooks, real gamma, installer execution or system tray. The Linux/macOS fake-driver test exercises the actual gamma worker and a shutdown race, but not a Windows GPU. The Windows source-policy and pure overlay-policy tests check control flow, event classification and burst scheduling, not foreground behavior, WebView2 button interaction, native hook delivery, popup latency or capture. Since a `main` push publishes automatically after CI checks, run the Windows acceptance checklist in the [release guide](RELEASE_GUIDE_FA.md) before pushing when practical; it is not a release gate. Avoid trying strict lock while unsaved work is open. The `--self-test` option is supplementary and writes to `%LOCALAPPDATA%\ChashmYar\startup.log`.

## Versioning

```powershell
node scripts/version.mjs check
# Optional, only when deliberately changing the major/minor baseline:
# node scripts/version.mjs set 2.5.0
```

The automatic workflow computes a patch after the greater of the source baseline and existing stable tags; it applies the version to a tag-only commit, not to `main`. For example a `2.4.3` baseline with no newer tags yields `v2.4.4`. A deliberate `2.5.0` baseline yields at least `v2.5.1`. Do not bump or tag manually for normal pushes. `set` synchronizes the npm package and lockfile, Tauri config, Cargo manifest and the application's entry in Cargo.lock; edit `CHANGELOG.md` separately. `node scripts/version.mjs check --tag vX.Y.Z` succeeds on the matching release-tag checkout, not necessarily on baseline `main`. See [the Persian release guide](RELEASE_GUIDE_FA.md) for limits and recovery.

## Dependencies and notices

`THIRD_PARTY_NOTICES.txt` is generated from locked Windows-target Cargo metadata and installed non-dev npm dependencies, including an intentionally over-inclusive set of build dependencies. Some upstream crate archives omit their license files; documented pinned fallback texts are in `third-party/fallback-licenses/`. Tao 0.37.2 is a modified local Apache-2.0 path dependency; its source, license and modification notice must remain in `src-tauri/vendor/tao` (see `CHASHMYAR_PATCH.md`). Do not remove the patch based solely on version numbers: focusable notification windows and deliberate strict-lock focus have distinct requirements. After a dependency update, run `npm run licenses:generate`, review the diff and source-offer obligations, and commit the updated notice. An unknown package without a license file fails notice generation rather than being silently omitted. The release workflow verifies the committed notices on Windows and uploads them beside the binaries.

## Branding and documentation images

The user-approved 2048px raster artwork is `assets/branding/chashmyar-logo-selected.png`. The committed PNGs and seven-frame ICO are derived from it, and the same assets serve Tauri, the tray, header and favicon. `npm run test:branding` checks checksums, dimensions, transparency, content and ICO/PNG consistency without Python. It does not validate how Windows Explorer or the actual tray renders them.

To intentionally regenerate artwork, see [branding](../assets/branding/README.md). Python and Pillow are optional maintainer tools; neither is required by `npm ci`, CI or the Windows build. Review 16/32px appearances and the manifest diff, then test the real Windows taskbar/tray in light and dark modes after a build.

For refreshed documentation screenshots, use `npm run build`, `npx playwright install chromium`, then `npm run docs:capture`. The script opens a temporary local production preview and captures fresh browser/mock data, not a user's real settings or Windows behavior. Review both PNGs before committing. The screenshot may display the baseline version rather than a release tag.

## Repository layout

```text
assets/branding/        approved artwork, asset hashes and maintainer notes
src/                    React windows, components, i18n, state and IPC mock
src-tauri/src/          Rust state, timer, analytics and Windows integrations
src-tauri/vendor/tao/   documented Apache-2.0 Windows focus patch and original license
src-tauri/installer/    NSIS localization
src-tauri/icons/        application icons
scripts/                version, notice, asset and release helpers
tests/                  browser/mock, logic, compatibility and release-tool tests
.github/workflows/      CI and automatic public Windows release automation
docs/                   user, architecture and maintainer guides
```

## Common errors

- MSVC linker missing: install the C++ workload and SDK, restart the shell, and use the MSVC Rust toolchain.
- Missing `node_modules` or lock mismatch: run `npm ci`, then commit intentional manifest and lockfile changes together.
- WebView2 missing: install the official Runtime; the portable executable does not bundle it.
- NSIS download/network failure: check the Actions log and retry after the upstream service recovers.
- Tauri build version mismatch: `node scripts/version.mjs check`; don't update just one manifest.
- Unexpected screenshots or tests: browser previews mock native state and cannot establish Windows correctness.
