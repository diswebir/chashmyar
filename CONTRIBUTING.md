# Contributing

Thank you for helping improve ChashmYar. فارسی و English reports are welcome.

## Before opening an issue

- Search existing issues and read the [user guide](docs/USER_GUIDE_FA.md).
- For suspected vulnerabilities, use the private route described in [SECURITY.md](SECURITY.md), not a public issue.
- Never paste passwords, tokens, full usernames, private screenshots or unsanitized logs. Diagnostic logs can contain local paths.

For a bug report provide the app version, Windows and WebView2 versions, installer or portable, reproduction steps, expected/actual behavior and a sanitized log if useful. For gamma problems include the display/HDR/driver details. Identify whether the issue also occurs in the browser mock.

## Development workflow

1. Fork the repository and create a focused branch.
2. Follow [DEVELOPMENT.md](docs/DEVELOPMENT.md); `npm ci` uses the committed lockfile.
3. Keep changes small. Respect Persian/English direction, numerals and both themes. Add or update relevant tests and documentation.
4. Run `npm run build`, `npm run test:logic`, `npm run test:compat`, `npm run test:release` and `npm run test:ui:all` after installing Playwright Chromium. For dependency changes regenerate and review third-party notices.
5. For native features, test on Windows and describe the device, OS and what was or was not tested. Browser mocks are not a substitute for native integration.
6. Open a pull request using the template; explain behavior, risk, testing and visual changes. Do not include compiled EXEs, personal data or secrets in commits.

Pull-request CI has read-only repository permissions. A push or merge to `main` starts an automatic patch release; after the release workflow's checks pass it publishes without a manual approval gate. Review and perform native Windows testing before merging when practical, and clearly document what could not be tested. By contributing, you agree that your contribution may be distributed under the project's [MIT license](LICENSE); do not submit material you lack rights to contribute. Third-party components retain their own licenses.
