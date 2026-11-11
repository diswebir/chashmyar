#!/usr/bin/env node
/** Capture clean browser/mock documentation screenshots; does not run Tauri. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const vite = resolve('node_modules/vite/bin/vite.js');
if (!existsSync(vite) || !existsSync('dist/index.html')) {
  console.error('Run npm ci, npm run build and npx playwright install chromium first.');
  process.exit(1);
}
const probe = createServer();
await new Promise((resolvePort, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolvePort));
const port = probe.address().port;
await new Promise((resolveClose, reject) => probe.close((error) => error ? reject(error) : resolveClose()));
const url = `http://127.0.0.1:${port}/`;
const preview = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'inherit' });
let exited = false;
preview.once('error', (error) => { exited = true; console.error(error.message); });
preview.once('exit', () => { exited = true; });
let browser;
try {
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline && !exited) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* starting */ }
    await delay(250);
  }
  if (!ready) throw new Error('Vite preview did not start');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1180, height: 960 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.getByTestId('brand-logo').waitFor({ state: 'visible' });
  await page.screenshot({ path: 'docs/assets/dashboard-fa-light.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'تم تاریک', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.screenshot({ path: 'docs/assets/dashboard-fa-dark.png', animations: 'disabled' });
  await context.close();
  console.log('✓ Captured two Persian browser/mock dashboards with no real user data.');
} catch (error) {
  console.error('Screenshot capture failed:', error.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (!exited) {
    preview.kill();
    await Promise.race([new Promise((resolveExit) => preview.once('exit', resolveExit)), delay(2000)]);
  }
}
