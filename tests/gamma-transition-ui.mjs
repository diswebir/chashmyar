/** Simulated Tauri snapshot events, not real WebView2, Win32, HDR or GPU. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.CHASHMYAR_TEST_URL ?? 'http://127.0.0.1:1420/';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const contexts = [], errors = [];
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };

async function nativePage(initial, label) {
  const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  contexts.push(context);
  await context.addInitScript(({ snapshot, label }) => {
    let nextCallback = 0, nextListener = 0;
    const callbacks = new Map(), listeners = new Map();
    window.__snapshotCount = () => [...listeners.values()].filter(v => v.event === 'app://snapshot').length;
    window.__emitSnapshot = payload => {
      const selected = [...listeners.entries()].filter(([, v]) => v.event === 'app://snapshot');
      for (const [id, item] of selected) item.callback({ event: item.event, id, payload });
      return selected.length;
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener(_event, id) { listeners.delete(id); } };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label }, currentWebview: { label } },
      transformCallback(callback) { const id = ++nextCallback; callbacks.set(id, callback); return id; },
      unregisterCallback(id) { callbacks.delete(id); },
      async invoke(command, args = {}) {
        if (command === 'plugin:event|listen') {
          const id = ++nextListener;
          listeners.set(id, { event: args.event, callback: callbacks.get(args.handler) });
          return id;
        }
        if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId); return; }
        if (command === 'get_snapshot') return structuredClone(snapshot);
        if (command === 'analytics_get') throw new Error('analytics omitted by simulated Tauri test');
        if (command === 'update_status') return { revision: 0, phase: 'idle', version: null, kind: 'installed', downloaded: 0, total: null, error: null, buildMarker: 'test-only' };
        return {};
      },
    };
  }, { snapshot: initial, label });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__snapshotCount() > 0);
  return page;
}
async function emit(page, snapshot) {
  return page.evaluate(payload => window.__emitSnapshot(payload), snapshot);
}
async function waitSource(page, fragment) {
  await page.waitForFunction(text => document.querySelector('[data-testid="temperature-source"]')?.textContent?.includes(text), fragment);
}
async function checkBlackLayer(page, expectedDimmed, label) {
  const layers = page.locator('.pointer-events-none > .absolute');
  eq(await layers.count(), 1, `${label}: no additional warmth element`);
  await page.waitForFunction(dimmed => {
    const value = document.querySelector('[data-testid="brightness-overlay-layer"]')?.style.background ?? '';
    const match = value.match(/^rgba\(0, 0, 0, ([\d.]+)\)$/);
    return Boolean(match && (dimmed ? Number(match[1]) > 0 : Number(match[1]) === 0));
  }, expectedDimmed);
  const value = await page.getByTestId('brightness-overlay-layer').evaluate(el => el.style.background);
  ok(/^rgba\(0, 0, 0, /.test(value), `${label}: only black dimming (${value})`);
}
try {
  const seedContext = await browser.newContext();
  const seedPage = await seedContext.newPage();
  await seedPage.goto(base, { waitUntil: 'networkidle' });
  await seedPage.waitForFunction(() => localStorage.getItem('chashmyar.mock.snapshot'));
  const seed = await seedPage.evaluate(() => JSON.parse(localStorage.getItem('chashmyar.mock.snapshot')));
  await seedContext.close();
  seed.revision = 10;
  seed.settings.eye.enabled = true;
  seed.settings.eye.scheduleEnabled = false;
  seed.settings.eye.coverWindowsMenus = false;
  seed.settings.system.language = 'fa';
  Object.assign(seed.eye, { gammaSupported: true, gammaAllAccepted: true, gammaApplied: true,
    effectiveKelvin: 4500, targetKelvin: 4500, effectiveBrightness: 82, scheduled: false,
    whitelisted: false, screenFilterStatus: 'off', screenFilterCoversOverlay: false });

  const main = await nativePage(seed, 'main');
  const dimmer = await nativePage(seed, 'dimmer-overlay');
  await main.locator('nav').getByRole('button', { name: /محافظ چشم/ }).click();
  await main.getByTestId('temperature-engine-status').waitFor();
  await waitSource(main, 'Gamma Ramp');
  await checkBlackLayer(dimmer, true, 'initial accepted Gamma');

  const snap = structuredClone(seed);
  for (const [any, all, kelvin, fragment] of [
    [false, false, 3000, 'درخواست ناموفق'],
    [true, false, 4200, 'خطای جزئی'],
    [true, true, 3100, 'Gamma Ramp'],
    [false, false, 3000, 'درخواست ناموفق'],
    [true, true, 4500, 'Gamma Ramp'],
  ]) {
    snap.revision++;
    Object.assign(snap.eye, { gammaSupported: any, gammaAllAccepted: all, targetKelvin: kelvin });
    eq(await emit(main, snap), 1, `main receives Gamma ${any}/${all}`);
    eq(await emit(dimmer, snap), 1, `dimmer receives Gamma ${any}/${all}`);
    await waitSource(main, fragment);
    await checkBlackLayer(dimmer, true, `Gamma ${any}/${all} ${kelvin}K`);
    if (!all) ok((await main.getByTestId('temperature-engine-status').innerText()).includes('گرمای نرم‌افزاری جایگزین نمی‌شود'), 'error explicitly rules out a software warmth fallback');
  }

  // The store rejects an older failure event after a successful newer result.
  const stale = structuredClone(snap);
  stale.revision--;
  stale.eye.gammaSupported = false; stale.eye.gammaAllAccepted = false;
  await emit(main, stale); await emit(dimmer, stale);
  await main.waitForTimeout(100);
  ok((await main.getByTestId('temperature-source').innerText()).includes('Gamma Ramp'), 'stale rejection cannot overwrite recovery');
  await checkBlackLayer(dimmer, true, 'stale rejection');

  // Opt-in fullscreen mode may legitimately use software warmth; ordinary
  // black dimming remains hidden until release is actually confirmed.
  snap.revision++; snap.settings.eye.coverWindowsMenus = true;
  Object.assign(snap.eye, { screenFilterStatus: 'active', screenFilterCoversOverlay: true, gammaSupported: false, gammaAllAccepted: false });
  await emit(main, snap); await emit(dimmer, snap);
  await waitSource(main, 'افکت تمام‌صفحه');
  await checkBlackLayer(dimmer, false, 'explicit fullscreen active');

  snap.revision++; snap.settings.eye.coverWindowsMenus = false;
  await emit(main, snap); await emit(dimmer, snap);
  await waitSource(main, 'در حال انتقال');
  ok((await main.getByTestId('system-menu-filter-status').innerText()).includes('بازگردانی افکت تمام‌صفحه'), 'switch off while still covered reports ongoing release');
  await checkBlackLayer(dimmer, false, 'release still unconfirmed');

  snap.revision++; snap.eye.screenFilterStatus = 'off'; snap.eye.screenFilterCoversOverlay = false;
  await emit(main, snap); await emit(dimmer, snap);
  await waitSource(main, 'درخواست ناموفق');
  await checkBlackLayer(dimmer, true, 'released with Gamma failure');
  snap.revision++; snap.eye.effectiveBrightness = 100;
  await emit(main, snap); await emit(dimmer, snap);
  await checkBlackLayer(dimmer, false, 'full brightness after release');

  // Switching eye care off cannot hide a failed reset: the old Gamma LUT may
  // remain warm. Once accepted but still transitioning, describe restoration.
  snap.revision++; snap.settings.eye.enabled = false; snap.eye.effectiveKelvin = 4500;
  await emit(main, snap); await emit(dimmer, snap);
  await waitSource(main, 'درخواست ناموفق');
  ok((await main.getByTestId('temperature-engine-status').innerText()).includes('Gamma ناموفق'), 'Gamma failure remains visible with eye care off');
  await checkBlackLayer(dimmer, false, 'disabled with rejected Gamma');
  snap.revision++; snap.eye.gammaSupported = true; snap.eye.gammaAllAccepted = false;
  await emit(main, snap); await emit(dimmer, snap);
  await waitSource(main, 'خطای جزئی');
  ok((await main.getByTestId('temperature-engine-status').innerText()).includes('برخی مسیرهای Gamma'), 'partial reset failure remains visible with eye care off');
  snap.revision++; snap.eye.gammaAllAccepted = true;
  await emit(main, snap); await emit(dimmer, snap);
  await waitSource(main, 'در حال بازگردانی Gamma');
  ok((await main.getByTestId('temperature-engine-status').innerText()).includes('خنثی‌سازی Gamma در جریان'), 'pending neutralisation is not presented as complete');
  snap.revision++; snap.eye.effectiveKelvin = 6500;
  await emit(main, snap); await emit(dimmer, snap);
  await waitSource(main, 'محافظ خاموش');
  await checkBlackLayer(dimmer, false, 'disabled after a reported neutral ramp');

  // Old installations may carry a long custom transition; do not silently
  // shorten the CSS while the native Gamma policy honors the saved value.
  snap.revision++; snap.settings.eye.transitionMs = 120_000;
  await emit(dimmer, snap);
  await dimmer.waitForFunction(() => document.querySelector('[data-testid="brightness-overlay-layer"]')?.style.transitionDuration === '120s');
  eq(await dimmer.getByTestId('brightness-overlay-layer').evaluate(el => el.style.transitionDuration), '120s', 'saved two-minute transition remains intact');
  snap.revision++; snap.settings.eye.transitionMs = 0;
  await emit(dimmer, snap);
  await dimmer.waitForFunction(() => document.querySelector('[data-testid="brightness-overlay-layer"]')?.style.transitionDuration === '2s');
  eq(await dimmer.getByTestId('brightness-overlay-layer').evaluate(el => el.style.transitionDuration), '2s', 'zero keeps the historical two-second default');

  eq(errors.length, 0, `no uncaught browser errors: ${errors.join('; ')}`);
  console.log(`PASS: ${checks} simulated native snapshot transition checks (not a Windows or GPU test)`);
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();
}
