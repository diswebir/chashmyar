/** Sound preferences and chime routing in a browser with mock IPC/audio.
 * This does not play real audio or validate Windows, WebView2 or audio hardware. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const url = process.env.CHASHMYAR_TEST_URL ?? 'http://127.0.0.1:1420/';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const contexts = [];
const errors = [];
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };
const read = page => page.evaluate(() => JSON.parse(localStorage.getItem('chashmyar.mock.snapshot')));
const nav = (page, name) => page.locator('nav').getByRole('button', { name: new RegExp(name) });
const soundSwitch = page => page.getByRole('switch', { name: /پخش صدای هشدار/ });
const chimes = page => page.evaluate(() => window.__chimeCount);

async function fresh({ snapshot, win = 'main', nativeStub = false, viewport = { width: 1180, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport });
  contexts.push(context);
  await context.addInitScript(() => {
    window.__chimeCount = 0;
    const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
    class FakeAudioContext {
      constructor() { window.__chimeCount++; this.currentTime = 0; this.destination = {}; }
      createOscillator() { return { type: '', frequency: param(), connect: to => to, start() {}, stop() {} }; }
      createGain() { return { gain: param(), connect: to => to }; }
      close() { return Promise.resolve(); }
    }
    Object.defineProperty(window, 'AudioContext', { value: FakeAudioContext, configurable: true });
  });
  if (nativeStub) {
    // Exercise the real Tauri event adapter with an in-browser stand-in, not a
    // live native process. It lets us emit the same event used by focus guard.
    await context.addInitScript(({ initial, label }) => {
      let callbackId = 0, listenerId = 0;
      const callbacks = new Map(), listeners = new Map();
      const registrations = Object.create(null);
      window.__nativeRegistrations = registrations;
      window.__nativeListenerCount = event => [...listeners.values()].filter(v => v.event === event).length;
      window.__nativeEmit = (event, payload) => {
        const entries = [...listeners.entries()].filter(([, v]) => v.event === event);
        entries.forEach(([id, v]) => v.callback({ event, id, payload }));
        return entries.length;
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener(_event, id) { listeners.delete(id); },
      };
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label }, currentWebview: { label } },
        transformCallback(callback) { const id = ++callbackId; callbacks.set(id, callback); return id; },
        unregisterCallback(id) { callbacks.delete(id); },
        async invoke(command, args = {}) {
          if (command === 'plugin:event|listen') {
            const id = ++listenerId;
            listeners.set(id, { event: args.event, callback: callbacks.get(args.handler) });
            registrations[args.event] = (registrations[args.event] ?? 0) + 1;
            return id;
          }
          if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId); return; }
          if (command === 'get_snapshot') return structuredClone(initial);
          if (command === 'analytics_get') throw new Error('analytics omitted by sound-test stub');
          return {};
        },
      };
    }, { initial: snapshot, label: win });
  } else if (snapshot) {
    await context.addInitScript(value => localStorage.setItem('chashmyar.mock.snapshot', JSON.stringify(value)), snapshot);
  }
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const target = new URL(url);
  if (!nativeStub && win !== 'main') target.searchParams.set('win', win);
  await page.goto(target.href, { waitUntil: 'networkidle' });
  return page;
}

async function waitSetting(page, value) {
  await page.waitForFunction(v => {
    const stored = localStorage.getItem('chashmyar.mock.snapshot');
    return stored && JSON.parse(stored).settings.system.soundEnabled === v;
  }, value);
}

try {
  const main = await fresh();
  await main.waitForFunction(() => localStorage.getItem('chashmyar.mock.snapshot') !== null);
  const initial = await read(main);
  eq(initial.settings.system.soundEnabled, false, 'fresh browser/mock settings start with all chimes disabled');
  await nav(main, 'سیستم').click();
  await soundSwitch(main).waitFor({ state: 'visible' });
  eq(await soundSwitch(main).getAttribute('aria-checked'), 'false', 'Persian sound switch starts off');
  ok(await main.getByText('صدای اعلان، تمرین کوتاه، استراحت و جریمه؛ در نصب تازه خاموش است', { exact: true }).isVisible(), 'setting describes its full scope and default');

  await soundSwitch(main).click();
  await waitSetting(main, true);
  eq(await soundSwitch(main).getAttribute('aria-checked'), 'true', 'sound can be explicitly enabled');
  await main.reload({ waitUntil: 'networkidle' });
  await nav(main, 'سیستم').click();
  await soundSwitch(main).waitFor({ state: 'visible' });
  eq(await soundSwitch(main).getAttribute('aria-checked'), 'true', 'enabled sound persists across browser/mock restart');
  await soundSwitch(main).click();
  await waitSetting(main, false);
  await main.reload({ waitUntil: 'networkidle' });
  await nav(main, 'سیستم').click();
  await soundSwitch(main).waitFor({ state: 'visible' });
  eq(await soundSwitch(main).getAttribute('aria-checked'), 'false', 'sound can be disabled again and stays off');
  await main.getByRole('button', { name: 'English', exact: true }).click();
  const english = main.getByRole('switch', { name: /Play alert sounds/ });
  await english.waitFor({ state: 'visible' });
  eq(await english.getAttribute('aria-checked'), 'false', 'English view keeps the same saved setting');
  ok(await main.getByText('Sounds for alerts, short exercises, breaks and penalties; off on fresh installs', { exact: true }).isVisible(), 'scope and default are translated');
  eq(await chimes(main), 0, 'changing the setting itself does not play an alert');

  for (const savedChoice of [true, false, undefined]) {
    const old = structuredClone(initial);
    if (savedChoice === undefined) delete old.settings.system.soundEnabled;
    else old.settings.system.soundEnabled = savedChoice;
    const page = await fresh({ snapshot: old });
    await nav(page, 'سیستم').click();
    await soundSwitch(page).waitFor({ state: 'visible' });
    eq(await soundSwitch(page).getAttribute('aria-checked'), String(savedChoice ?? false),
      `saved ${String(savedChoice)} choice is respected or uses the new absent-field default`);
  }

  // Visual notifications remain present while muted; enabling sound reuses the
  // existing chime rather than disabling the feature or the notification.
  for (const enabled of [false, true]) {
    const seed = structuredClone(initial);
    if (enabled) seed.settings.system.soundEnabled = true;
    else delete seed.settings.system.soundEnabled; // old data with no saved field
    seed.timer.warningVisible = true;
    const warning = await fresh({ snapshot: seed, win: 'snooze-alert', viewport: { width: 452, height: 320 } });
    ok(await warning.getByTestId('snooze-panel').isVisible(), 'warning stays visible with either sound preference');
    if (enabled) await warning.waitForFunction(() => window.__chimeCount === 1);
    else await warning.waitForTimeout(200);
    eq(await chimes(warning), enabled ? 1 : 0, `warning ${enabled ? 'plays' : 'does not play'} a chime`);
    await warning.getByTestId('snooze-close').click();
    await warning.waitForTimeout(100);
    eq(await chimes(warning), enabled ? 1 : 0, 'dismissing the warning adds no chime');
  }

  for (const enabled of [false, true]) {
    const seed = structuredClone(initial);
    if (enabled) seed.settings.system.soundEnabled = true;
    else delete seed.settings.system.soundEnabled;
    seed.timer.microBreakActive = true;
    seed.timer.microBreakTotal = 20;
    seed.timer.microBreakRemaining = 20;
    const exercise = await fresh({ snapshot: seed, win: 'micro-break', viewport: { width: 520, height: 188 } });
    await exercise.waitForFunction(() => {
      const count = document.querySelector('[data-testid="short-exercise-panel"] .digits');
      return count && count.textContent.trim() !== '۰';
    });
    ok(await exercise.getByTestId('short-exercise-panel').isVisible(), 'short exercise remains visible when muted');
    if (enabled) await exercise.waitForFunction(() => window.__chimeCount === 1);
    else await exercise.waitForTimeout(150);
    eq(await chimes(exercise), enabled ? 1 : 0, 'short-exercise start respects the sound preference');
    await exercise.getByRole('button', { name: 'بستن تمرین کوتاه' }).click();
    await exercise.waitForFunction(() => !JSON.parse(localStorage.getItem('chashmyar.mock.snapshot')).timer.microBreakActive);
    if (enabled) await exercise.waitForFunction(() => window.__chimeCount === 2);
    else await exercise.waitForTimeout(150);
    eq(await chimes(exercise), enabled ? 2 : 0, 'short-exercise end respects the sound preference');
  }

  for (const enabled of [false, true]) {
    const seed = structuredClone(initial);
    seed.settings.system.soundEnabled = enabled;
    seed.settings.lock.strictLock = false;
    seed.timer.phase = 'break';
    seed.timer.remainingSeconds = 200;
    seed.timer.totalSeconds = 300;
    const lock = await fresh({ snapshot: seed, win: 'break-lock', viewport: { width: 1366, height: 768 } });
    await lock.getByRole('button', { name: 'پایان زودهنگام استراحت' }).waitFor({ state: 'visible' });
    if (enabled) await lock.waitForFunction(() => window.__chimeCount === 1);
    else await lock.waitForTimeout(150);
    eq(await chimes(lock), enabled ? 1 : 0, 'break-start chime respects the preference');
    await lock.getByRole('button', { name: 'پایان زودهنگام استراحت' }).click();
    await lock.waitForFunction(() => JSON.parse(localStorage.getItem('chashmyar.mock.snapshot')).timer.phase === 'work');
    if (enabled) await lock.waitForFunction(() => window.__chimeCount === 2);
    else await lock.waitForTimeout(150);
    eq(await chimes(lock), enabled ? 2 : 0, 'break-end chime respects the preference');
  }

  // Drive the penalty event through a Tauri IPC stub and verify that settings
  // updates affect subsequent events, without a native Windows claim.
  const native = structuredClone(initial);
  native.revision = 10;
  native.settings.system.language = 'en';
  native.settings.system.soundEnabled = false;
  native.timer.phase = 'work';
  const penalty = await fresh({ snapshot: native, win: 'break-lock', nativeStub: true, viewport: { width: 1366, height: 768 } });
  const event = 'break-penalty-applied';
  await penalty.waitForFunction(e => document.documentElement.lang === 'en' && window.__nativeListenerCount(e) === 1, event);
  const payload = { seconds: 30, totalPenalties: 1, remainingSeconds: 200 };
  eq(await penalty.evaluate(({ e, p }) => window.__nativeEmit(e, p), { e: event, p: payload }), 1, 'one penalty listener receives the mocked event');
  await penalty.getByRole('alert').waitFor({ state: 'visible' });
  eq(await chimes(penalty), 0, 'default-off penalty is silent while its visual alert remains');
  for (const enabled of [true, false]) {
    const previousRegistrations = await penalty.evaluate(e => window.__nativeRegistrations[e], event);
    native.revision++;
    native.settings.system.soundEnabled = enabled;
    eq(await penalty.evaluate(snapshot => window.__nativeEmit('app://snapshot', snapshot), native), 1, 'mock native state change reaches the lock window');
    await penalty.waitForFunction(({ e, previous }) => window.__nativeRegistrations[e] > previous && window.__nativeListenerCount(e) === 1,
      { e: event, previous: previousRegistrations });
    eq(await penalty.evaluate(({ e, p }) => window.__nativeEmit(e, p), { e: event, p: payload }), 1, 'updated listener receives one penalty');
    if (enabled) await penalty.waitForFunction(() => window.__chimeCount === 1);
    else await penalty.waitForTimeout(150);
    eq(await chimes(penalty), 1, `penalty sound ${enabled ? 'enables' : 'stays muted again'} after a live setting change`);
  }

  eq(errors.length, 0, `no uncaught browser errors: ${errors.join('; ')}`);
  console.log(`PASS: ${checks} browser/mock sound-default, persistence, notification and penalty assertions`);
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();
}
