/** v2.4 UI/mock regression. This does NOT exercise Win32 or capture APIs. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const baseUrl = process.env.CHASHMYAR_TEST_URL ?? 'http://127.0.0.1:1420/';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const contexts = [];
const errors = [];
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };
const read = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('chashmyar.mock.snapshot')));
const nav = (page, name) => page.locator('nav').getByRole('button', { name: new RegExp(name) });

async function fresh({ snapshot, win, trackSounds = false, viewport = { width: 1180, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport });
  contexts.push(context);
  if (trackSounds) await context.addInitScript(() => {
    window.__chimeCount = 0;
    const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
    class FakeAudioContext {
      constructor() { window.__chimeCount++; this.currentTime = 0; this.destination = {}; }
      createOscillator() { return { type: '', frequency: param(), connect: (to) => to, start() {}, stop() {} }; }
      createGain() { return { gain: param(), connect: (to) => to }; }
      close() { return Promise.resolve(); }
    }
    Object.defineProperty(window, 'AudioContext', { value: FakeAudioContext, configurable: true });
  });
  if (snapshot) await context.addInitScript((value) => localStorage.setItem('chashmyar.mock.snapshot', JSON.stringify(value)), snapshot);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const url = new URL(baseUrl);
  if (win) url.searchParams.set('win', win);
  await page.goto(url.href, { waitUntil: 'networkidle' });
  return page;
}

async function checkSlider(page, label, min, max, lang) {
  const input = page.getByRole('slider', { name: label, exact: true });
  await input.waitFor({ state: 'visible' });
  const info = await input.evaluate((element) => {
    const endpoints = element.parentElement.querySelector('[data-testid="slider-endpoints"]');
    const spans = endpoints.querySelectorAll('span');
    const boxes = [...spans].map((span) => ({ text: span.textContent, x: span.getBoundingClientRect().x }));
    return { inputDir: getComputedStyle(element).direction, labelsDir: getComputedStyle(endpoints).direction, boxes };
  });
  const digits = (v) => lang === 'fa' ? String(v).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]) : String(v);
  eq(info.inputDir, 'ltr', `${lang}: ${label} input physically increases left to right`);
  eq(info.labelsDir, 'ltr', `${lang}: ${label} labels match track direction`);
  eq(info.boxes[0].text, digits(min), `${lang}: ${label} minimum label`);
  eq(info.boxes[1].text, digits(max), `${lang}: ${label} maximum label`);
  ok(info.boxes[0].x < info.boxes[1].x, `${lang}: ${label} minimum on left and maximum on right`);
  const box = await input.boundingBox();
  await input.click({ position: { x: 2, y: box.height / 2 } });
  eq(await input.inputValue(), String(min), `${lang}: ${label} left click selects minimum`);
  await input.click({ position: { x: box.width - 2, y: box.height / 2 } });
  eq(await input.inputValue(), String(max), `${lang}: ${label} right click selects maximum`);
}

try {
  const main = await fresh();
  await main.waitForFunction(() => localStorage.getItem('chashmyar.mock.snapshot') !== null, null, { timeout: 5000 });
  const initial = await read(main);
  ok(initial.settings.eye.enabled && initial.settings.eye.scheduleEnabled && initial.settings.eye.colorSafeEnabled, 'fresh eye protection, night schedule and color-safe list are enabled');
  ok(initial.settings.timer.autoStartBreak && initial.settings.timer.autoStartNextWork && initial.settings.timer.idleDetectionEnabled, 'fresh helpful timer settings are enabled');
  ok(initial.settings.timer.microBreakEnabled, 'short exercises enabled by default');
  eq(initial.settings.timer.microBreakIntervalMinutes, 20, 'default short-exercise interval is 20 minutes');
  eq(initial.settings.timer.microBreakSeconds, 20, 'default short-exercise duration is 20 seconds');
  eq(initial.settings.lock.rotateSeconds, 20, 'default exercise rotation is 20 seconds');
  ok(initial.settings.lock.eyeExercises && initial.settings.lock.bodyExercises && initial.settings.lock.emergencyUnlock, 'eye/body activities and emergency exit enabled');
  ok(initial.settings.system.autostart && initial.settings.system.autoStartTimerOnLaunch, 'startup and automatic timer are enabled');
  ok(initial.timer.phase === 'work' && initial.timer.running, 'fresh browser simulation starts the work timer');
  await nav(main, 'پومودورو و تعویق').click();
  await main.getByText('کارت شناور ۲۰ ثانیه‌ای — بدون قفل کردن کیبورد و ماوس').waitFor({ state: 'visible' });
  ok(await main.getByText('کارت شناور ۲۰ ثانیه‌ای — بدون قفل کردن کیبورد و ماوس').isVisible(), 'Persian short-exercise duration matches saved default');
  await nav(main, 'داشبورد').click();

  await checkSlider(main, 'دمای رنگ', 2700, 6500, 'fa');
  await checkSlider(main, 'روشنایی نمایشگر', 10, 100, 'fa');
  await nav(main, 'محافظ چشم').click();
  await checkSlider(main, 'دمای رنگ (کلوین)', 2700, 6500, 'fa');
  await checkSlider(main, 'روشنایی نرم‌افزاری', 10, 100, 'fa');
  await checkSlider(main, 'کلوین شبانه', 2700, 6500, 'fa');
  await checkSlider(main, 'روشنایی شبانه', 20, 100, 'fa');
  ok((await main.getByTestId('capture-exclusion-status').innerText()).includes('تأیید نشد'), 'browser preview honestly reports no native exclusion');

  await main.getByRole('button', { name: 'English', exact: true }).click();
  await main.getByRole('slider', { name: 'Colour temperature (Kelvin)', exact: true }).waitFor();
  await checkSlider(main, 'Colour temperature (Kelvin)', 2700, 6500, 'en');
  await checkSlider(main, 'Software dimming', 10, 100, 'en');
  await checkSlider(main, 'Night Kelvin', 2700, 6500, 'en');
  await checkSlider(main, 'Night brightness', 20, 100, 'en');
  ok((await main.getByTestId('capture-exclusion-status').innerText()).includes('could not be confirmed'), 'capture warning translated to English');
  await nav(main, 'Pomodoro & snooze').click();
  await main.getByText('A 20-second floating card without locking the keyboard or mouse').waitFor({ state: 'visible' });
  ok(await main.getByText('A 20-second floating card without locking the keyboard or mouse').isVisible(), 'English short-exercise duration follows setting');
  await nav(main, 'Dashboard').click();
  await checkSlider(main, 'Colour temperature', 2700, 6500, 'en');
  await checkSlider(main, 'Screen brightness', 10, 100, 'en');

  for (const theme of ['light', 'dark']) {
    const seed = structuredClone(initial);
    seed.settings.system.theme = theme;
    seed.timer.microBreakActive = true;
    seed.timer.microBreakTotal = 20;
    seed.timer.microBreakRemaining = 15;
    const toast = await fresh({ snapshot: seed, win: 'micro-break', viewport: { width: 520, height: 188 } });
    const style = await toast.getByTestId('short-exercise-panel').evaluate((el) => {
      const css = getComputedStyle(el);
      return { shadow: css.boxShadow, backdrop: css.backdropFilter, background: css.backgroundColor, opacity: css.opacity };
    });
    eq(style.shadow, 'none', `${theme} short-exercise toast has no CSS shadow`);
    eq(style.backdrop, 'none', `${theme} short-exercise surface does not blur`);
    eq(style.background, theme === 'dark' ? 'rgb(17, 29, 45)' : 'rgb(255, 255, 255)', `${theme} short-exercise surface is solid`);
    eq(style.opacity, '1', `${theme} short-exercise opacity is one`);
  }

  // The warning webview exists while hidden: its creation must not play a
  // chime. A real visible warning should chime once, respecting soundEnabled.
  const silentSeed = structuredClone(initial);
  silentSeed.timer.warningVisible = false;
  silentSeed.settings.system.soundEnabled = true;
  const hiddenWarning = await fresh({ snapshot: silentSeed, win: 'snooze-alert', trackSounds: true, viewport: { width: 452, height: 320 } });
  await hiddenWarning.waitForTimeout(350);
  eq(await hiddenWarning.evaluate(() => window.__chimeCount), 0, 'creating hidden warning does not chime');
  const activeSeed = structuredClone(silentSeed);
  activeSeed.timer.warningVisible = true;
  const activeWarning = await fresh({ snapshot: activeSeed, win: 'snooze-alert', trackSounds: true, viewport: { width: 452, height: 320 } });
  await activeWarning.waitForFunction(() => window.__chimeCount === 1);
  eq(await activeWarning.evaluate(() => window.__chimeCount), 1, 'active warning chimes exactly once');
  await activeWarning.getByTestId('snooze-close').click();
  await activeWarning.waitForTimeout(150);
  eq(await activeWarning.evaluate(() => window.__chimeCount), 1, 'dismissing a warning does not chime again');
  activeSeed.settings.system.soundEnabled = false;
  const mutedWarning = await fresh({ snapshot: activeSeed, win: 'snooze-alert', trackSounds: true, viewport: { width: 452, height: 320 } });
  await mutedWarning.waitForTimeout(350);
  eq(await mutedWarning.evaluate(() => window.__chimeCount), 0, 'sound-disabled warning stays silent');

  const captureSeed = structuredClone(initial);
  captureSeed.eye.captureExcluded = true;
  const capturePage = await fresh({ snapshot: captureSeed });
  await nav(capturePage, 'محافظ چشم').click();
  await capturePage.getByTestId('capture-exclusion-status').waitFor();
  ok((await capturePage.getByTestId('capture-exclusion-status').innerText()).includes('روش‌های ضبط سازگار'), 'accepted capture exclusion is reported with compatibility caveat');

  // Browser simulation only: failure/recovery must not tint the ordinary
  // overlay. Native Gamma, capture and physical colour remain manual tests.
  const rejected = structuredClone(initial);
  rejected.settings.eye.enabled = true;
  rejected.settings.eye.coverWindowsMenus = false;
  rejected.eye.gammaSupported = false;
  rejected.eye.gammaAllAccepted = false;
  rejected.eye.effectiveKelvin = 4500; // previous warm LUT may have remained
  rejected.eye.targetKelvin = 3000;
  rejected.eye.effectiveBrightness = 100;
  rejected.eye.whitelisted = false;
  for (const target of [2700, 3000, 4200, 6500]) {
    for (const brightness of [100, 82]) {
      const seed = structuredClone(rejected);
      seed.eye.targetKelvin = target;
      seed.eye.effectiveBrightness = brightness;
      const overlay = await fresh({ snapshot: seed, win: 'dimmer-overlay', viewport: { width: 1000, height: 700 } });
      const layers = overlay.locator('.pointer-events-none > .absolute');
      eq(await layers.count(), 1, `${target}K/${brightness}% has one dimming-only layer`);
      const background = await layers.nth(0).evaluate(el => el.style.background);
      const match = background.match(/^rgba\(0, 0, 0, ([\d.]+)\)$/);
      ok(match && (brightness === 100 ? Number(match[1]) === 0 : Number(match[1]) > 0),
        `${target}K/${brightness}% is black only: ${background}`);
      await overlay.context().close();
    }
  }
  // Driver acceptance has no impact on the black layer either.
  const acceptedOverlay = structuredClone(rejected);
  acceptedOverlay.eye.gammaSupported = true; acceptedOverlay.eye.gammaAllAccepted = true;
  acceptedOverlay.eye.effectiveBrightness = 82;
  const black = await fresh({ snapshot: acceptedOverlay, win: 'dimmer-overlay' });
  eq(await black.locator('.pointer-events-none > .absolute').count(), 1, 'accepted Gamma still has only one black layer');
  ok(/^rgba\(0, 0, 0, 0\.[1-9]/.test(await black.getByTestId('brightness-overlay-layer').evaluate(el => el.style.background)),
    'software dimming survives Gamma acceptance');
  for (const disabled of ['disabled', 'whitelist']) {
    const seed = structuredClone(rejected);
    seed.eye.effectiveBrightness = 70;
    if (disabled === 'disabled') seed.settings.eye.enabled = false;
    else seed.eye.whitelisted = true;
    const p = await fresh({ snapshot: seed, win: 'dimmer-overlay' });
    const backgrounds = await p.locator('.pointer-events-none > .absolute').evaluateAll(els => els.map(el => el.style.background));
    eq(backgrounds.length, 1, `${disabled} retains only the dimming element`);
    ok(backgrounds.every(value => /, 0\)$/.test(value)), `${disabled} removes dimming`);
  }

  const failedPage = await fresh({ snapshot: rejected });
  await nav(failedPage, 'محافظ چشم').click();
  ok((await failedPage.getByTestId('temperature-source').innerText()).includes('درخواست ناموفق'), 'sidebar reports Gamma rejection');
  ok((await failedPage.getByTestId('temperature-engine-status').innerText()).includes('گرمای نرم‌افزاری جایگزین نمی‌شود'), 'failure explicitly says no software warmth');
  await failedPage.getByRole('button', { name: 'English', exact: true }).click();
  await failedPage.getByRole('slider', { name: 'Colour temperature (Kelvin)', exact: true }).waitFor();
  ok((await failedPage.getByTestId('temperature-source').innerText()).includes('request failed'), 'Gamma failure translated');
  const englishFailure = await failedPage.getByTestId('temperature-engine-status').innerText();
  ok(englishFailure.includes('software warmth will not replace it'), `no-fallback warning translated: ${englishFailure}`);

  const partial = structuredClone(rejected);
  partial.eye.gammaSupported = true; partial.eye.gammaAllAccepted = false;
  const partialPage = await fresh({ snapshot: partial });
  await nav(partialPage, 'محافظ چشم').click();
  ok((await partialPage.getByTestId('temperature-source').innerText()).includes('خطای جزئی'), 'partial Gamma rejection is not hidden by another successful call');
  ok((await partialPage.getByTestId('temperature-engine-status').innerText()).includes('برخی مسیرهای Gamma ناموفق بودند'), 'partial failure explained');
  await partialPage.getByRole('button', { name: 'English', exact: true }).click();
  await partialPage.getByRole('slider', { name: 'Colour temperature (Kelvin)', exact: true }).waitFor();
  ok((await partialPage.getByTestId('temperature-engine-status').innerText()).includes('Some Gamma paths failed'), 'partial failure translated');

  const scheduled = structuredClone(rejected);
  scheduled.eye.scheduled = true;
  const scheduledPage = await fresh({ snapshot: scheduled });
  ok(await scheduledPage.getByTestId('schedule-overrides-manual').isVisible(), 'dashboard warns when night schedule overrides manual sliders');
  await nav(scheduledPage, 'محافظ چشم').click();
  ok(await scheduledPage.getByTestId('schedule-overrides-manual').isVisible(), 'eye settings show the same schedule warning');
  await scheduledPage.getByRole('button', { name: 'English', exact: true }).click();
  await scheduledPage.getByRole('slider', { name: 'Colour temperature (Kelvin)', exact: true }).waitFor();
  ok((await scheduledPage.getByTestId('schedule-overrides-manual').innerText()).includes('manual sliders apply'), 'schedule warning translated');

  const legacy = structuredClone(initial);
  legacy.settings.eye.scheduleEnabled = false;
  legacy.settings.timer.autoStartNextWork = false;
  legacy.settings.timer.microBreakSeconds = 15;
  legacy.settings.lock.rotateSeconds = 45;
  legacy.settings.system.autostart = false;
  legacy.settings.system.autoStartTimerOnLaunch = false;
  const preserved = await fresh({ snapshot: legacy });
  await nav(preserved, 'پومودورو و تعویق').click();
  await preserved.getByText('کارت شناور ۱۵ ثانیه‌ای — بدون قفل کردن کیبورد و ماوس').waitFor({ state: 'visible' });
  ok(await preserved.getByText('کارت شناور ۱۵ ثانیه‌ای — بدون قفل کردن کیبورد و ماوس').isVisible(), 'saved 15-second exercise appears accurately');
  await nav(preserved, 'قفل صفحه و ورزش‌ها').click();
  await preserved.getByRole('slider', { name: 'فاصله نمایش تمرین بعدی', exact: true }).waitFor();
  eq(await preserved.getByRole('slider', { name: 'فاصله نمایش تمرین بعدی', exact: true }).getAttribute('aria-valuenow'), '45', 'saved 45-second exercise preference is preserved');
  await nav(preserved, 'محافظ چشم').click();
  await preserved.getByRole('switch', { name: /فعال‌سازی زمان‌بندی/ }).waitFor();
  eq(await preserved.getByRole('switch', { name: /فعال‌سازی زمان‌بندی/ }).getAttribute('aria-checked'), 'false', 'saved disabled schedule is preserved');

  eq(errors.length, 0, `no uncaught browser errors: ${errors.join('; ')}`);
  console.log(`PASS: ${checks} browser/mock assertions for sliders, defaults, Gamma reporting and dimming`);
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
}
