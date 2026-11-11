#!/usr/bin/env node
/** Run all browser/mock suites against a temporary production Vite preview. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const vite = resolve('node_modules/vite/bin/vite.js');
if (!existsSync(vite) || !existsSync('dist/index.html')) {
  console.error('Run npm ci and npm run build before npm run test:ui:all.');
  process.exit(1);
}
async function freePort() {
  const server = createServer();
  await new Promise((res, rej) => server.once('error', rej).listen(0, '127.0.0.1', res));
  const port = server.address().port;
  await new Promise((res, rej) => server.close((err) => err ? rej(err) : res()));
  return port;
}
function runTest(file, url) {
  return new Promise((res, rej) => {
    const proc = spawn(process.execPath, [file], {
      cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, CHASHMYAR_TEST_URL: url },
    });
    proc.once('error', rej);
    proc.once('exit', (code, signal) => code === 0 ? res() : rej(new Error(`${file} failed (${code ?? signal})`)));
  });
}
const port = await freePort();
const url = `http://127.0.0.1:${port}/`;
const preview = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'inherit' });
let previewExited = false;
preview.once('error', (err) => { previewExited = true; console.error('Preview failed:', err.message); });
preview.once('exit', () => { previewExited = true; });
try {
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline && !previewExited) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
    } catch { /* Preview has not started yet. */ }
    await delay(250);
  }
  if (!ready) throw new Error('Vite preview failed to start within 60 seconds');
  for (const test of ['tests/smoke-ui.mjs', 'tests/v23-regression.mjs', 'tests/v24-regression.mjs', 'tests/sound-defaults.mjs', 'tests/credits-ui.mjs', 'tests/branding-ui.mjs', 'tests/chart-tooltip.mjs']) await runTest(test, url);
  console.log('✓ All browser/mock suites passed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (!previewExited) {
    preview.kill();
    await Promise.race([new Promise((res) => preview.once('exit', res)), delay(2000)]);
  }
}
