# Development and testing

[فارسی: راهنمای انتشار و ساخت](RELEASE_GUIDE_FA.md) · [User guide](USER_GUIDE_FA.md) · [Architecture](ARCHITECTURE.md) · [CI and release](CI_AND_RELEASE.md)

## Supported target and prerequisites

The native application is intended for Windows x64. Linux/macOS browser previews are useful for UI work but do not implement the Windows gamma, keyboard-hook, tray or window-management paths. No native Windows runtime validation is claimed by this repository's mock tests.

On Windows install:

1. [Node.js](https://nodejs.org/) 24 LTS and npm. The package declares Node >= 20.19; CI uses 24.
2. [Rustup and Rust stable](https://www.rust-lang.org/tools/install), MSVC toolchain. The currently locked Windows dependency graph requires Rust 1.90 or newer.
3. [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++** and a Windows SDK.
4. [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/). See the [official Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
5. [7-Zip](https://www.7-zip.org/) for the staged-installer payload audit (`7z.exe` in its standard Program Files location or on PATH). For a custom location set `CHASHMYAR_7ZIP` to the executable path.

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

A local build is optional; the source bundle itself contains no new executable. For a signed updater build, set `CHASHMYAR_UPDATER_PUBLIC_KEY` and `TAURI_SIGNING_PRIVATE_KEY` to the **contents** of the matching key files and, if used, set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in the process environment. Keep keys outside the repository and never put passwords in shell history. See the [key guide](UPDATER_SIGNING_FA.md). Then:

```powershell
npm run version:check
npm run build:win
npm run verify:exe
npm run licenses:generate
npm run release:sign
npm run release:stage
npm run verify:payload  # executes both staged payloads headlessly on Windows
```

Alternatively run `powershell -ExecutionPolicy Bypass -File .\build-windows.ps1` after configuring that environment. The script checks prerequisites and runs build/sign/staging. `release/windows/` contains versioned local executables; `release/staging/` also contains both updater signatures, `latest.json`, license notices and checksums. Both directories are ignored by Git. The installer uses a 32-bit NSIS stub containing the x64 app; the portable app is x64. Clear signing environment variables after use.

The installer can download WebView2 when needed. Tauri updater signatures verify update payloads but are **not** Windows Authenticode publisher signatures; absent a separately managed publisher certificate, SmartScreen can still warn. `npm run verify:exe` checks PE headers and hashes. `npm run verify:payload` extracts the staged NSIS application with 7-Zip, runs a headless report from that EXE and the staged portable EXE, and checks production protocol, version, flavor, keys and hashes of all embedded assets against `dist`; it must precede upload but is not a GUI or publisher-identity check. Both builds use Tauri CLI; plain release Cargo without `tauri/custom-protocol` fails at compile time.

## Tests

```powershell
npm run test:logic      # Rust policies; Windows also runs small native HWND/swap smoke tests
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

`test:ui:all` runs the smoke, v2.3/v2.4 regression/stress, sound-default, creator-card, branding UI, weekly-chart tooltip, updater UI and colour-vision UI suites using Playwright and mock IPC. The colour-vision suite covers opt-in settings, selection, persistence, Color-Safe, conflict/retry and both languages; it does not change a display. The chart suite checks tooltip contrast and hovered values in light/dark themes and both languages. The branding suite checks that the header and favicon load in both themes/languages at two viewport sizes. The sound suite uses a fake audio context and a Tauri event stub; it verifies the toggle, saved values and chime routing, not real sound output. The runner picks a free localhost port and tears down the preview afterward. Alternatively, start `npm run dev` and run `npm run test:ui`, `npm run test:ui:v23`, `npm run test:ui:v24`, `npm run test:sound`, `npm run test:credits`, `npm run test:branding:ui` or `npm run test:chart` individually; set `CHASHMYAR_TEST_URL` if needed. On a Linux CI host use `npx playwright install --with-deps chromium` if system libraries are missing.

The browser tests do **not** exercise WebView2, native keyboard/WinEvent hooks, real gamma, Magnification, installer execution or system tray. Fake-driver tests exercise the actual colour-vision worker on all test hosts and the gamma worker on Linux/macOS, including shutdown races, but not a Windows GPU or physical display. The source-policy and overlay-policy tests check control flow, event classification and burst scheduling. On Windows the small `test:logic` native HWND and running-image swap smoke tests also run; foreground activation can be skipped by session policy. Neither those tests nor the browser mock prove WebView2 button interaction, zero-frame popup behavior, real installer/portable restart, native hook delivery or capture. Since a `main` push publishes automatically after CI checks, run the Windows acceptance checklist in the [release guide](RELEASE_GUIDE_FA.md) before pushing when practical; it is not a release gate. Avoid trying strict lock while unsaved work is open. The `--self-test` option is supplementary and writes to `%LOCALAPPDATA%\ChashmYar\startup.log`.

## Versioning

```powershell
node scripts/version.mjs check
# Optional, only when deliberately changing the major/minor baseline:
# node scripts/version.mjs set 2.5.0
```

The automatic workflow uses the source baseline itself if it is greater than all existing stable tags; otherwise it allocates the patch after the greatest stable tag. It applies the version to a tag-only child commit, not to `main`; the child may have an unchanged tree when the source already contains the selected version. For example, baseline `2.4.8` with latest tag `v2.4.7` yields `v2.4.8`, then `v2.4.9`. A deliberate `2.5.0` baseline yields `v2.5.0` when all existing stable tags are lower. Do not bump or tag manually for normal pushes. `set` synchronizes the npm package and lockfile, Tauri config, Cargo manifest and the application's entry in Cargo.lock; edit `CHANGELOG.md` separately. `node scripts/version.mjs check --tag vX.Y.Z` succeeds on the matching release-tag checkout, not necessarily on baseline `main`. See [the Persian release guide](RELEASE_GUIDE_FA.md) for limits and recovery.

## Dependencies and notices

`THIRD_PARTY_NOTICES.txt` is generated from locked Windows-target Cargo metadata and installed non-dev npm dependencies, including an intentionally over-inclusive set of build dependencies. Some upstream crate archives omit their license files; documented pinned fallback texts are in `third-party/fallback-licenses/`. Tao 0.37.2 is a modified local Apache-2.0 path dependency; its source, license and modification notice must remain in `src-tauri/vendor/tao` (see `CHASHMYAR_PATCH.md`). Do not remove the patch based solely on version numbers: focusable notification windows and deliberate strict-lock focus have distinct requirements. After a dependency update, run `npm run licenses:generate`, review the diff and source-offer obligations, and commit the updated notice. An unknown package without a license file fails notice generation rather than being silently omitted. The release workflow verifies the committed notices on Windows and uploads them beside the binaries. For a PR whose notice check fails, CI attempts to attach a candidate notice as an artifact; the check remains failed until a maintainer reviews and commits the correct file. Vite and its React plugin are grouped for Dependabot version updates; Tailwind major version updates are deferred for a separate PostCSS/visual migration, while security alerts still need attention.

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
