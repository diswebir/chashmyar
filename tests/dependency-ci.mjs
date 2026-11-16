// Source-policy regressions for the Dependabot/notice workflow; no GitHub run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (name) => readFileSync(name, 'utf8');
const config = read('.github/dependabot.yml');
const vite = read('vite.config.ts');
const ci = read('.github/workflows/ci.yml');
let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks++; };
const section = (text, start, end) => {
  const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing source section ${start}`);
  return text.slice(a, b);
};
const npm = section(config, '  - package-ecosystem: npm', '  - package-ecosystem: cargo');
ok(npm.includes('vite-react-toolchain:') && npm.includes('"vite"') && npm.includes('"@vitejs/plugin-react"'), 'incompatible Vite major updates are grouped');
ok(npm.includes('dependency-name: "tailwindcss"') && npm.includes('version-update:semver-major'), 'Tailwind breaking major is deferred, not mechanically merged');
ok(!/\bminify\s*:\s*["']esbuild["']/.test(vite), 'Vite default minifier allows Vite 6 and Vite 8');
const cargo = section(config, '  - package-ecosystem: cargo', '  - package-ecosystem: github-actions');
ok(cargo.includes('directories:') && cargo.includes('/src-tauri') && cargo.includes('/tests/rust-compat') && cargo.includes('group-by: dependency-name') && cargo.includes('"sha2"'), 'sha2 version proposals group the app and test lockfiles across both Cargo directories');
const checkJob = section(ci, '  checks:', '  notices:');
const notice = ci.slice(ci.indexOf('  notices:'));
ok(checkJob.includes('npm run test:ui:all') && !checkJob.includes('Verify third-party notices'), 'browser suites have an independent job, even when notices are stale');
ok(notice.includes('npm run licenses:check') && !notice.includes('continue-on-error'), 'notice check still fails the job');
ok(notice.includes('npm ci --ignore-scripts'), 'inventory install does not run dependency lifecycle scripts');
ok(notice.includes("failure() && steps.notices.outcome == 'failure'") && notice.includes('npm run licenses:generate'), 'candidate generated only after the notice check fails');
ok(notice.includes('actions/upload-artifact@') && notice.includes('candidate-third-party-notices-'), 'candidate can be reviewed as an artifact');
ok(ci.includes('contents: read') && !ci.includes('pull_request_target') && !ci.includes('TAURI_SIGNING_PRIVATE_KEY'), 'PR checks have read-only source and no release secret');
console.log(`PASS: ${checks} dependency/notice CI safety-policy assertions (no live GitHub run).`);
