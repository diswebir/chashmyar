/** Docked widget hover-intent and settings migration, using browser/mock IPC.
 * This exercises UI timing; real WebView2 pointer delivery and Windows native
 * window resizing still require an interactive Windows test. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.CHASHMYAR_TEST_URL ?? 'http://127.0.0.1:1420/';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const contexts = [];
const errors = [];
let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks++; };
const eq = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };
const read = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('chashmyar.mock.snapshot')));

async function fresh({ snapshot, win, clock = false } = {}) {
  const context = await browser.newContext({ viewport: win ? { width: 1000, height: 62 } : { width: 1180, height: 790 } });
  contexts.push(context);
  if (snapshot) await context.addInitScript((s) => localStorage.setItem('chashmyar.mock.snapshot', JSON.stringify(s)), snapshot);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  if (clock) await page.clock.install();
  const url = new URL(base);
  if (win) url.searchParams.set('win', win);
  await page.goto(url.toString(), { waitUntil: 'networkidle' });
  if (clock) {
    const now = await page.evaluate(() => Date.now());
    // Allow enough headroom for a busy CI runner between evaluating and pausing.
    await page.clock.pauseAt(now + 5000);
  }
  return page;
}
async function enterSensor(page) {
  await page.mouse.move(300, 30);
  await page.mouse.move(300, 1);
}
const popup = (page) => page.getByTestId('docked-widget-popup');
const expanded = (page) => page.getByTestId('docked-widget-root').getAttribute('data-expanded');

try {
  const main = await fresh();
  // Persist a complete, real mock snapshot and inspect the actual range control.
  await main.getByRole('button', { name: 'تم تاریک', exact: true }).click();
  await main.locator('nav').getByRole('button', { name: /سیستم/ }).click();
  const range = main.getByRole('slider', { name: 'تأخیر باز شدن ویجت' });
  eq(await range.inputValue(), '2000', 'fresh installations use a two-second hover delay');
  eq(await range.getAttribute('max'), '5000', 'the settings control actually supports two seconds or longer');

  // A deliberate new choice must persist across restarts (migration is not recurring).
  await range.focus();
  await range.press('Home');
  for (let i = 0; i < 13; i++) await range.press('ArrowRight');
  await main.waitForTimeout(200);
  const customized = await read(main);
  eq(customized.settings.system.widgetHoverDelayMs, 650, 'the slider can still save a custom shorter delay');
  eq(customized.settings.system.widgetHoverDelayRevision, 1, 'the new value is marked as migrated');
  await main.reload({ waitUntil: 'networkidle' });
  await main.locator('nav').getByRole('button', { name: /سیستم/ }).click();
  eq(await main.getByRole('slider', { name: 'تأخیر باز شدن ویجت' }).inputValue(), '650', 'custom delay survives a reload');

  // Existing installations get 2 seconds once, even if their old slider was custom.
  const legacy = structuredClone(customized);
  delete legacy.settings.system.widgetHoverDelayRevision;
  legacy.settings.system.widgetHoverDelayMs = 650;
  legacy.settings.system.soundEnabled = true;
  legacy.settings.timer.workMinutes = 33;
  const legacyMain = await fresh({ snapshot: legacy });
  await legacyMain.locator('nav').getByRole('button', { name: /سیستم/ }).click();
  eq(await legacyMain.getByRole('slider', { name: 'تأخیر باز شدن ویجت' }).inputValue(), '2000', 'legacy settings migrate to two seconds');
  // Any subsequent edit persists the marker and leaves unrelated fields intact.
  await legacyMain.getByRole('switch', { name: /پخش صدا/ }).click();
  const migrated = await read(legacyMain);
  eq(migrated.settings.system.widgetHoverDelayRevision, 1, 'migration marker is saved with the next edit');
  eq(migrated.settings.timer.workMinutes, 33, 'migration preserves unrelated timer preferences');
  eq(migrated.settings.system.widgetHoverDelayMs, 2000, 'migrated delay is persisted');

  const page = await fresh({ snapshot: legacy, win: 'micro-bar', clock: true });
  await page.getByTestId('docked-widget-sensor').waitFor();
  await enterSensor(page);
  await page.clock.runFor(1900);
  eq(await expanded(page), 'false', 'legacy widget remains closed before two seconds');
  await page.clock.runFor(150);
  eq(await expanded(page), 'true', 'legacy widget opens after two continuous seconds');
  await page.clock.runFor(500);
  ok(await popup(page).isVisible(), 'the opened menu is visible in the mock viewport');
  await page.mouse.move(300, 30);
  eq(await expanded(page), 'true', 'leaving the sensor for the menu does not close it');
  await page.mouse.move(1100, 90);
  await page.clock.runFor(500);
  eq(await expanded(page), 'false', 'leaving the expanded window closes the menu');

  await enterSensor(page);
  await page.clock.runFor(800);
  await page.mouse.move(300, 30); // still inside the viewport, but off the 3px sensor
  await page.clock.runFor(2500);
  eq(await expanded(page), 'false', 'leaving the sensor cancels the pending open');
  await page.mouse.move(300, 1);
  await page.clock.runFor(1900);
  eq(await expanded(page), 'false', 're-entering starts a fresh two-second countdown');
  await page.clock.runFor(150);
  eq(await expanded(page), 'true', 're-entered hover opens only after the full delay');
  await page.clock.runFor(500);
  // Framer Motion exit/stability uses animation frames; resume real time for clicks.
  await page.clock.resume();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'جدا کردن ویجت (حالت شناور)' }).click();
  ok(await page.getByRole('button', { name: 'چسباندن به لبه بالا' }).isVisible(), 'detach switches to floating mode');
  await page.getByRole('button', { name: 'چسباندن به لبه بالا' }).click();
  eq(await expanded(page), 'false', 'reattaching starts collapsed, not with stale expanded state');

  const customPage = await fresh({ snapshot: customized, win: 'micro-bar', clock: true });
  await customPage.getByTestId('docked-widget-sensor').waitFor();
  await enterSensor(customPage);
  await customPage.clock.runFor(500);
  eq(await expanded(customPage), 'false', 'custom delay is not ignored or shortened');
  await customPage.clock.runFor(200);
  eq(await expanded(customPage), 'true', 'a deliberate post-migration custom delay is honored');
  eq(errors.length, 0, `no browser exceptions: ${errors.join('; ')}`);
  console.log(`PASS: ${checks} docked widget hover and migration checks (browser/mock IPC; not native Windows)`);
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
}
