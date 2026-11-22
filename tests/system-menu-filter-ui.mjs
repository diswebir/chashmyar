/** Browser/mock regression only: no Windows compositor, monitor or WebView2. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.CHASHMYAR_TEST_URL ?? 'http://127.0.0.1:1420/';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const contexts = [], errors = [];
let checks = 0;
const ok = (v, message) => { assert.ok(v, message); checks++; };
const eq = (v, expected, message) => { assert.equal(v, expected, message); checks++; };
const read = page => page.evaluate(() => JSON.parse(localStorage.getItem('chashmyar.mock.snapshot')));
async function fresh({ seed, screen, cvd, win } = {}) {
  const context = await browser.newContext({ viewport: { width: 1180, height: 920 } });
  contexts.push(context);
  if (seed) await context.addInitScript(v => localStorage.setItem('chashmyar.mock.snapshot', JSON.stringify(v)), seed);
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const u = new URL(base);
  if (screen) u.searchParams.set('screen', screen);
  if (cvd) u.searchParams.set('cvd', cvd);
  if (win) u.searchParams.set('win', win);
  await page.goto(u.href, { waitUntil: 'networkidle' });
  return page;
}
const status = p => p.getByTestId('system-menu-filter-status');
const toggle = p => p.getByRole('switch', { name: /پوشش منوهای ویندوز/ });
async function eyeTab(p) {
  await p.locator('nav').getByRole('button', { name: /محافظ چشم/ }).click();
  await p.getByTestId('system-menu-filter').waitFor({ state: 'visible' });
}
async function saved(p, v) {
  await p.waitForFunction(expected => JSON.parse(localStorage.getItem('chashmyar.mock.snapshot') || '{}')?.settings?.eye?.coverWindowsMenus === expected, v);
}
try {
  const p = await fresh();
  await p.waitForFunction(() => localStorage.getItem('chashmyar.mock.snapshot') !== null);
  const initial = await read(p);
  eq(initial.settings.eye.coverWindowsMenus, false, 'new mode defaults off');
  await eyeTab(p);
  eq(await toggle(p).getAttribute('aria-checked'), 'false', 'off switch visible');
  ok((await status(p).innerText()).includes('روش قبلی'), 'legacy mode explicitly described');
  await p.getByRole('button', { name: /مطالعه.*گرمای ملایم/ }).click();
  await toggle(p).click(); await saved(p, true);
  eq(await status(p).getAttribute('data-status'), 'unsupported', 'ordinary browser mock does not claim native support');
  ok((await status(p).innerText()).includes('لایه قبلی'), 'unsupported mock explains fallback');
  await p.reload({ waitUntil: 'networkidle' }); await eyeTab(p);
  eq(await toggle(p).getAttribute('aria-checked'), 'true', 'opt-in survives reload');
  await toggle(p).click(); await saved(p, false);

  const legacy = structuredClone(initial);
  delete legacy.settings.eye.coverWindowsMenus;
  delete legacy.eye.screenFilterStatus; delete legacy.eye.screenFilterCoversOverlay;
  legacy.settings.eye.kelvin = 3200; legacy.settings.eye.brightness = 70;
  legacy.eye.effectiveBrightness = 70; legacy.eye.targetKelvin = 3200;
  legacy.settings.eye.colorVisionProfile = 'deuteranopia';
  const old = await fresh({ seed: legacy }); await eyeTab(old);
  eq(await toggle(old).getAttribute('aria-checked'), 'false', 'old settings keep legacy mode');
  await toggle(old).click(); await saved(old, true);
  eq((await read(old)).settings.eye.kelvin, 3200, 'old Kelvin preserved');
  eq((await read(old)).settings.eye.colorVisionProfile, 'deuteranopia', 'old vision selection preserved');

  const seed = structuredClone(legacy);
  // The browser mock starts each page's in-memory revision at zero; seed the
  // persisted value consistently before asserting a retry emitted a revision.
  seed.revision = 0;
  seed.settings.eye.coverWindowsMenus = true;
  seed.eye.gammaSupported = false; seed.eye.targetKelvin = 3000;
  seed.eye.effectiveBrightness = 70; seed.eye.captureExcluded = true;
  const warmthOnly = structuredClone(seed);
  warmthOnly.eye.gammaSupported = true; warmthOnly.eye.effectiveBrightness = 100;
  warmthOnly.eye.targetKelvin = 3000; warmthOnly.settings.eye.brightness = 100;
  const warm = await fresh({ seed: warmthOnly, screen: 'active' }); await eyeTab(warm);
  eq(await status(warm).getAttribute('data-status'), 'active', 'warmth-only mode is requested even when Gamma reports success');
  ok((await warm.getByTestId('system-menu-filter').innerText()).includes('گرما و تیرگی'), 'description covers both requested effects');

  const active = await fresh({ seed, screen: 'active', cvd: 'active' }); await eyeTab(active);
  eq(await status(active).getAttribute('data-status'), 'active', 'screen API success simulated');
  eq(await active.getByTestId('color-vision-status').getAttribute('data-status'), 'active', 'screen and vision settings coexist');
  ok((await active.getByTestId('capture-exclusion-status').innerText()).includes('شامل افکت تمام‌صفحه نیست'), 'no false capture-exclusion promise');
  const activeOverlay = await fresh({ seed, screen: 'active', cvd: 'active', win: 'dimmer-overlay' });
  const backgrounds = await activeOverlay.locator('.pointer-events-none > .absolute').evaluateAll(els => els.map(el => el.style.background));
  ok(backgrounds.every(value => /, 0\)$/.test(value)), 'active fullscreen mock does not double the overlay');
  await toggle(active).click(); await saved(active, false);
  eq(await active.getByTestId('color-vision-status').getAttribute('data-status'), 'active', 'turning off screen mode leaves vision active');

  for (const failure of ['conflict', 'error', 'unsupported']) {
    const page = await fresh({ seed, screen: failure }); await eyeTab(page);
    eq(await status(page).getAttribute('data-status'), failure, `${failure} status`);
    ok((await status(page).innerText()).includes('لایه قبلی'), `${failure} displays fallback`);
    if (failure !== 'unsupported') {
      ok(await page.getByTestId('system-menu-filter-retry').isVisible(), `${failure} allows explicit retry`);
      const revision = (await read(page)).revision;
      await page.getByTestId('system-menu-filter-retry').click();
      await page.waitForFunction(v => JSON.parse(localStorage.getItem('chashmyar.mock.snapshot')).revision > v, revision);
      eq(await status(page).getAttribute('data-status'), failure, 'retry keeps mocked scenario, not false success');
    } else eq(await page.getByTestId('system-menu-filter-retry').count(), 0, 'unsupported does not offer misleading retry');
    const overlay = await fresh({ seed, screen: failure, win: 'dimmer-overlay' });
    const colors = await overlay.locator('.pointer-events-none > .absolute').evaluateAll(els => els.map(el => el.style.background));
    ok(colors.every(value => /, 0\.[1-9]/.test(value)), `${failure} renders both overlay fallbacks`);
  }
  const paused = structuredClone(seed); paused.eye.whitelisted = true;
  const safe = await fresh({ seed: paused, screen: 'active' }); await eyeTab(safe);
  ok((await status(safe).innerText()).includes('رنگ‌ایمن'), 'whitelist pauses fullscreen mode');
  const off = structuredClone(seed); off.settings.eye.enabled = false;
  const disabled = await fresh({ seed: off, screen: 'active' }); await eyeTab(disabled);
  ok((await status(disabled).innerText()).includes('محافظ چشم خاموش'), 'eye power switch pauses screen mode');
  const en = await fresh({ seed, screen: 'conflict' }); await eyeTab(en);
  await en.getByRole('button', { name: 'English', exact: true }).click();
  ok(await en.getByRole('switch', { name: /Cover Windows menus/ }).isVisible(), 'toggle translated');
  ok((await status(en).innerText()).includes('previous overlay'), 'fallback translated');
  ok((await en.getByTestId('system-menu-filter-retry').innerText()).includes('Retry'), 'retry translated');
  eq(errors.length, 0, `no uncaught browser errors: ${errors.join('; ')}`);
  console.log(`PASS: ${checks} system-menu filter browser/mock checks (not a Windows visual test)`);
} finally {
  await Promise.all(contexts.map(c => c.close())); await browser.close();
}
