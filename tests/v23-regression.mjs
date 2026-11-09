/** v2.3 browser/mock regression and stress checks. These are not native Windows tests. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const baseUrl = process.env.CHASHMYAR_TEST_URL ?? 'http://127.0.0.1:1420/';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
let checks = 0;
const errors = [];
const ok = (v, message) => { assert.ok(v, message); checks++; };
const eq = (a, b, message) => { assert.equal(a, b, message); checks++; };
const nav = (page, name) => page.locator('nav').getByRole('button', { name: new RegExp(name) });
const read = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('chashmyar.mock.snapshot')));
const contexts = [];
const fresh = async ({ snapshot, analytics, viewport = { width: 1180, height: 790 }, win } = {}) => {
  const context = await browser.newContext({ viewport });
  contexts.push(context);
  await context.addInitScript(({ snapshot, analytics }) => {
    if (snapshot) localStorage.setItem('chashmyar.mock.snapshot', JSON.stringify(snapshot));
    if (analytics) localStorage.setItem('chashmyar.mock.analytics', JSON.stringify(analytics));
  }, { snapshot, analytics });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const url = new URL(baseUrl);
  if (win) url.searchParams.set('win', win);
  await page.goto(url.toString(), { waitUntil: 'networkidle' });
  return page;
};
const surfaceInfo = (locator) => locator.evaluate((e) => {
  const c = getComputedStyle(e), r = e.getBoundingClientRect();
  return { bg: c.backgroundColor, image: c.backgroundImage, backdrop: c.backdropFilter, opacity: c.opacity, bottom: r.bottom, height: r.height };
});

try {
  const p = await fresh();
  // Make a complete base snapshot using the app itself; preserve defaults.
  await p.getByRole('button', { name: 'تم تاریک', exact: true }).click();
  const base = await read(p);
  eq(base.settings.system.theme, 'dark', 'seeded dark theme');
  const clock = p.getByTestId('system-clock');
  const first = await clock.innerText();
  ok(/^[۰-۹]{2}:[۰-۹]{2}:[۰-۹]{2}$/.test(first), 'Persian system clock includes seconds');
  await p.waitForTimeout(1300);
  ok((await clock.innerText()) !== first, 'system clock advances while work timer is idle');

  // Empty and legacy data never claim a perfect score.
  const clean = await fresh({ snapshot: base, analytics: {} });
  await nav(clean, 'گزارش سلامت و تمرکز').click();
  await clean.getByTestId('eye-care-score').waitFor();
  ok((await clean.getByTestId('eye-care-score').innerText()).includes('بدون داده کافی'), 'empty eye score has no fabricated percentage');
  ok((await clean.getByTestId('regularity-score').innerText()).includes('بدون داده کافی'), 'empty regularity has no fabricated percentage');
  eq(await clean.locator('svg[role="img"] circle[stroke="#38bdf8"]').count(), 0, 'no-data days have no plotted score');
  const emptyText = await clean.locator('main').innerText();
  ok(!emptyText.includes('۱۰۰٪'), 'no artificial 100 percent on empty days');

  const dateKey = (n) => {
    const d = new Date(); d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const blank = { deepWorkMinutes: 0, completedBreaks: 0, naturalBreaks: 0, microBreaksCompleted: 0, snoozeUsedCount: 0, penaltyCount: 0, emergencySkips: 0 };
  const records = {
    [dateKey(0)]: { ...blank, trackedFocusSeconds: 4420, completedBreaks: 3, microBreaksCompleted: 2, observedBreaksCompleted: 1, observedBreaksSkipped: 1, observedExercisesCompleted: 2, observedExercisesSkipped: 0, workSessionsOnTime: 2, workSessionsDelayed: 1, workSessionsEndedEarly: 1 },
    [dateKey(1)]: { ...blank, deepWorkMinutes: 135, completedBreaks: 1, observedBreaksCompleted: 1, workSessionsDelayed: 1 },
    // This legacy day remains in totals, but has no outcome denominator.
    [dateKey(5)]: { ...blank, deepWorkMinutes: 120, completedBreaks: 9 },
  };
  const reports = await fresh({ snapshot: base, analytics: records });
  await nav(reports, 'گزارش سلامت و تمرکز').click();
  const eye = await reports.getByTestId('eye-care-score').innerText();
  const regular = await reports.getByTestId('regularity-score').innerText();
  ok(eye.includes('۷۵٪'), 'eye score is 3 of 4 recorded outcomes');
  ok(eye.includes('امتیاز هفت روز: ۸۰٪'), 'weekly eye score is weighted 4 of 5');
  ok(regular.includes('۵۰٪'), 'regularity is 2 of 4 sessions');
  ok(regular.includes('امتیاز هفت روز: ۴۰٪'), 'weekly regularity is weighted 2 of 5');
  ok((await reports.locator('main').innerText()).includes('۵ ساعت و ۲۸ دقیقه'), 'legacy minutes remain in weekly totals');
  eq(await reports.locator('svg[role="img"] circle[stroke="#38bdf8"]').count(), 2, 'legacy and no-data days produce gaps');
  ok((await reports.locator('main').innerText()).includes('سلامت پزشکی چشم'), 'non-medical disclaimer visible');
  await reports.getByRole('button', { name: 'بازنشانی', exact: true }).click();
  await reports.getByRole('button', { name: 'تأیید پاک کردن', exact: true }).click();
  await reports.waitForTimeout(150);
  ok((await reports.getByTestId('eye-care-score').innerText()).includes('بدون داده کافی'), 'reset clears scored outcomes');
  ok((await reports.getByTestId('regularity-score').innerText()).includes('بدون داده کافی'), 'reset clears regularity outcomes');
  eq(await reports.locator('svg[role="img"] circle[stroke="#38bdf8"]').count(), 0, 'reset clears chart scores');

  // Exercise preview is not an actual scheduled exercise outcome.
  const previewSeed = structuredClone(base);
  previewSeed.settings.timer.microBreakSeconds = 5;
  const preview = await fresh({ snapshot: previewSeed, analytics: {} });
  await nav(preview, 'پومودورو و تعویق').click();
  await preview.getByText('تمرین کوتاه در حین کار', { exact: true }).waitFor({ state: 'visible' });
  ok(await preview.getByText('تمرین کوتاه در حین کار', { exact: true }).isVisible(), 'feature has requested Persian name');
  await preview.getByRole('button', { name: 'نمایش آزمایشی', exact: true }).last().click();
  await preview.waitForTimeout(5500);
  await nav(preview, 'گزارش سلامت و تمرکز').click();
  await preview.getByTestId('eye-care-score').waitFor();
  ok((await preview.getByTestId('eye-care-score').innerText()).includes('بدون داده کافی'), 'exercise preview does not create an adherence outcome');

  // A scheduled exercise finishing and one dismissed early each record one outcome.
  const completedSeed = structuredClone(base);
  completedSeed.timer.microBreakActive = true;
  completedSeed.timer.microBreakTotal = 5;
  completedSeed.timer.microBreakRemaining = 1;
  const completedExercise = await fresh({ snapshot: completedSeed, analytics: {} });
  await completedExercise.waitForTimeout(1400);
  await nav(completedExercise, 'گزارش سلامت و تمرکز').click();
  await completedExercise.getByTestId('eye-care-score').waitFor();
  ok((await completedExercise.getByTestId('eye-care-score').innerText()).includes('۱۰۰٪'), 'finished scheduled exercise is recorded');
  const skippedSeed = structuredClone(completedSeed);
  skippedSeed.timer.microBreakRemaining = 12;
  const skippedExercise = await fresh({ snapshot: skippedSeed, analytics: {}, win: 'micro-break', viewport: { width: 520, height: 188 } });
  await skippedExercise.getByRole('button', { name: 'بستن تمرین کوتاه' }).click();
  const skippedDb = await skippedExercise.evaluate(() => JSON.parse(localStorage.getItem('chashmyar.mock.analytics')));
  eq(Object.values(skippedDb)[0].observedExercisesSkipped, 1, 'dismissed scheduled exercise records a skipped outcome');

  const strictSeed = structuredClone(base);
  strictSeed.timer.phase = 'break';
  strictSeed.settings.lock.strictLock = true;
  const strict = await fresh({ snapshot: strictSeed, analytics: {} });
  ok(await strict.getByRole('button', { name: 'بازنشانی', exact: true }).isDisabled(), 'strict break cannot be bypassed by reset');

  // Solid theme surfaces, usable top X, and raised options in both themes.
  for (const theme of ['dark', 'light']) {
    const seed = structuredClone(base);
    seed.settings.system.theme = theme;
    seed.settings.system.widgetMode = 'docked';
    seed.settings.system.widgetHoverDelayMs = 100;
    seed.timer.phase = 'work';
    seed.timer.remainingSeconds = 30;
    seed.timer.totalSeconds = 1500;
    seed.timer.warningVisible = true;
    seed.timer.microBreakActive = true;
    seed.timer.microBreakTotal = 15;
    seed.timer.microBreakRemaining = 12;
    const expected = theme === 'dark' ? 'rgb(17, 29, 45)' : 'rgb(255, 255, 255)';
    const warning = await fresh({ snapshot: seed, analytics: {}, win: 'snooze-alert', viewport: { width: 452, height: 320 } });
    await warning.waitForTimeout(700);
    const surface = await surfaceInfo(warning.getByTestId('snooze-panel'));
    eq(surface.bg, expected, `${theme} warning is solid`);
    eq(surface.opacity, '1', `${theme} warning opacity is 1`);
    eq(surface.backdrop, 'none', `${theme} warning has no glass blur`);
    ok(surface.bottom <= 320, `${theme} warning fits its native viewport`);
    const x = warning.getByTestId('snooze-close');
    ok(await x.isVisible(), `${theme} warning has top X`);
    ok((await x.getAttribute('aria-label')).includes('بستن'), `${theme} X has an accessible label`);
    eq(await warning.locator('.snooze-choice').count(), 3, `${theme} warning exposes three choices`);
    const choiceStyle = await warning.locator('.snooze-choice').first().evaluate((el) => {
      const c = getComputedStyle(el); const r = el.getBoundingClientRect();
      return { cursor: c.cursor, border: c.borderTopWidth, height: r.height, background: c.backgroundColor };
    });
    eq(choiceStyle.cursor, 'pointer', `${theme} snooze choice looks clickable`);
    ok(parseFloat(choiceStyle.border) >= 1 && choiceStyle.height >= 36, `${theme} snooze choice is raised and sizeable`);
    if (theme === 'dark') {
      // Many same-frame click events can consume at most one snooze.
      await warning.locator('.snooze-choice').first().evaluate((el) => { for (let i = 0; i < 40; i++) el.click(); });
      await warning.waitForTimeout(200);
      const after = await read(warning);
      eq(after.timer.snoozeCount, 1, 'rapid snooze clicks are idempotent');
      eq(after.timer.remainingSeconds, 210, 'only one 3-minute snooze is applied');
    } else {
      await x.click();
      eq((await read(warning)).timer.warningVisible, false, 'X dismisses warning');
    }
    const toast = await fresh({ snapshot: seed, analytics: {}, win: 'micro-break', viewport: { width: 520, height: 188 } });
    await toast.waitForTimeout(700);
    const toastSurface = await surfaceInfo(toast.getByTestId('short-exercise-panel'));
    eq(toastSurface.bg, expected, `${theme} short-exercise toast is solid`);
    eq(toastSurface.opacity, '1', `${theme} short-exercise opacity is 1`);
    eq(toastSurface.backdrop, 'none', `${theme} short-exercise has no glass blur`);
    ok(toastSurface.bottom <= 188, `${theme} short-exercise fits its window`);
    const widget = await fresh({ snapshot: seed, analytics: {}, win: 'micro-bar', viewport: { width: 1000, height: 62 } });
    await widget.mouse.move(200, 50); await widget.mouse.move(200, 1); await widget.waitForTimeout(700);
    const dock = await surfaceInfo(widget.getByTestId('docked-widget-popup'));
    eq(dock.bg, expected, `${theme} expanded docked widget is solid`);
    eq(dock.opacity, '1', `${theme} docked widget opacity is 1`);
    eq(dock.backdrop, 'none', `${theme} docked widget has no glass blur`);
    ok(dock.bottom <= 62, `${theme} widget popup fits`);
  }

  // Simulated delayed native IPC: an old response or event must never undo a newer snapshot.
  const ipcContext = await browser.newContext({ viewport: { width: 1180, height: 790 } });
  contexts.push(ipcContext);
  await ipcContext.addInitScript((seed) => {
    const callbacks = new Map(); const listeners = new Map(); let next = 1;
    window.__nativeCreatorCalls = 0;
    const snapshot = (revision, theme) => ({ ...structuredClone(seed), revision, settings: { ...structuredClone(seed.settings), system: { ...seed.settings.system, theme } } });
    window.__testEmit = (revision, theme) => {
      for (const cb of listeners.values()) cb({ event: 'app://snapshot', id: 1, payload: snapshot(revision, theme) });
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback(cb) { const id = next++; callbacks.set(id, cb); return id; },
      unregisterCallback(id) { callbacks.delete(id); },
      invoke(command, args = {}) {
        if (command === 'plugin:event|listen') { if (args.event === 'app://snapshot') listeners.set(args.handler, callbacks.get(args.handler)); return Promise.resolve(args.handler); }
        if (command === 'plugin:event|unlisten') return Promise.resolve();
        if (command === 'get_snapshot') {
          window.setTimeout(() => window.__testEmit(2, 'dark'), 40);
          return new Promise((resolve) => window.setTimeout(() => resolve(snapshot(1, 'light')), 300));
        }
        if (command === 'analytics_get') return Promise.resolve({});
        if (command === 'patch_settings') return Promise.resolve(snapshot(4, 'dark'));
        if (command === 'open_creator_website') { window.__nativeCreatorCalls++; return Promise.resolve(); }
        return Promise.resolve(snapshot(1, 'light'));
      },
    };
  }, base);
  const ipcPage = await ipcContext.newPage();
  ipcPage.on('pageerror', (e) => errors.push(e.message));
  await ipcPage.goto(baseUrl, { waitUntil: 'networkidle' });
  await ipcPage.waitForTimeout(400);
  eq(await ipcPage.locator('html').getAttribute('data-theme'), 'dark', 'stale initial IPC response cannot overwrite a newer event');
  await ipcPage.evaluate(() => { window.__testEmit(5, 'light'); window.__testEmit(3, 'dark'); });
  await ipcPage.waitForTimeout(100);
  eq(await ipcPage.locator('html').getAttribute('data-theme'), 'light', 'older event cannot overwrite a newer event');
  await ipcPage.getByRole('button', { name: 'تم تاریک', exact: true }).click();
  await ipcPage.waitForTimeout(100);
  eq(await ipcPage.locator('html').getAttribute('data-theme'), 'light', 'stale command reply cannot overwrite newer state');
  // The redesigned cards must still invoke the native website command, not navigate the webview.
  await ipcPage.locator('aside [data-testid="credits-card"] a').click();
  await ipcPage.waitForFunction(() => window.__nativeCreatorCalls === 1);
  eq(await ipcPage.evaluate(() => window.__nativeCreatorCalls), 1, 'sidebar credit invokes native creator command');
  await nav(ipcPage, 'درباره').click();
  await ipcPage.locator('main [data-testid="credits-card"] a').click();
  await ipcPage.waitForFunction(() => window.__nativeCreatorCalls === 2);
  eq(await ipcPage.evaluate(() => window.__nativeCreatorCalls), 2, 'about credit invokes native creator command');

  // High-frequency event queue and debounced controls retain the final action.
  const stress = await fresh({ analytics: {} });
  // A new installation now starts the timer automatically; reset to exercise
  // the same 100-click start/pause ordering from a deterministic idle state.
  await stress.getByRole('button', { name: 'بازنشانی', exact: true }).click();
  await stress.getByRole('button', { name: 'شروع تمرکز', exact: true }).evaluate((el) => { for (let i = 0; i < 100; i++) el.click(); });
  await stress.waitForTimeout(350);
  const afterToggles = await read(stress);
  ok(afterToggles.timer.running && afterToggles.timer.paused, '100 rapid toggles stay ordered (even count ends paused)');
  const pausedClock = await stress.getByTestId('system-clock').innerText();
  await stress.waitForTimeout(1300);
  ok((await stress.getByTestId('system-clock').innerText()) !== pausedClock, 'system clock advances while timer is paused');
  eq((await read(stress)).timer.remainingSeconds, afterToggles.timer.remainingSeconds, 'paused timer remains frozen during clock update');
  const slider = stress.locator('input[type="range"]').first();
  for (const value of ['3000', '3550', '4200', '5000', '4750']) await slider.fill(value);
  await stress.waitForTimeout(300);
  eq((await read(stress)).settings.eye.kelvin, 4750, 'rapid slider movement persists final value');
  await nav(stress, 'پومودورو و تعویق').click();
  const step = stress.getByRole('button', { name: 'مدت تمرکز +', exact: true });
  await step.click();
  await nav(stress, 'داشبورد').click();
  await stress.waitForTimeout(300);
  ok((await read(stress)).settings.timer.workMinutes >= 26, 'debounced stepper change survives fast navigation');
  await stress.getByRole('button', { name: 'تم تاریک', exact: true }).click();
  await stress.getByRole('button', { name: 'تم روشن', exact: true }).click();
  await stress.getByRole('button', { name: 'تم تاریک', exact: true }).click();
  await stress.waitForTimeout(200);
  eq((await read(stress)).settings.system.theme, 'dark', 'rapid theme changes keep latest value');
  await stress.reload({ waitUntil: 'networkidle' });
  eq(await stress.locator('html').getAttribute('data-theme'), 'dark', 'last theme survives reload');
  eq(errors.length, 0, `no browser exceptions: ${errors.join('; ')}`);
  console.log(`PASS: ${checks} v2.3 browser/mock regression and stress assertions`);
} finally {
  await Promise.all(contexts.map((c) => c.close()));
  await browser.close();
}
