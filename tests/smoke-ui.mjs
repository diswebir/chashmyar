/** Browser-level smoke tests against the in-memory Tauri mock.
 * Start `npm run dev` first. These do not replace Windows-native testing. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url = process.env.CHASHMYAR_TEST_URL ?? 'http://127.0.0.1:1420/';
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };
const read = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('chashmyar.mock.snapshot')));
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const errors = [];
const motionWarnings = [];
const fresh = async (viewport = { width: 1180, height: 790 }, initial) => {
  const context = await browser.newContext({ viewport });
  if (initial) await context.addInitScript((state) => localStorage.setItem('chashmyar.mock.snapshot', JSON.stringify(state)), initial);
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'warning' && /strokeDashoffset|animat.*undefined/i.test(msg.text())) motionWarnings.push(msg.text()); });
  await page.goto(url, { waitUntil: 'networkidle' });
  return { context, page };
};
const nav = (page, name) => page.locator('nav').getByRole('button', { name: new RegExp(name) });
try {
  // Appearance and direction switch immediately, without losing the active tab.
  const main = await fresh();
  equal(await main.page.locator('html').getAttribute('data-theme'), 'light', 'fresh install defaults to light theme');
  const faClock = await main.page.locator('main .digits').first().innerText();
  ok(/[۰-۹]/.test(faClock), 'Persian interface uses Persian digits');
  ok((await main.page.locator('main .digits').first().evaluate(el => getComputedStyle(el).fontFamily)).includes('Vazirmatn'), 'Persian digits use Vazirmatn');
  await main.page.getByRole('button', { name: 'تم تاریک', exact: true }).click();
  await main.page.reload({ waitUntil: 'networkidle' });
  equal(await main.page.locator('html').getAttribute('data-theme'), 'dark', 'saved dark preference survives restart');
  await main.page.getByRole('button', { name: 'تم روشن', exact: true }).click();
  await nav(main.page, 'پومودورو و تعویق').click();
  await main.page.getByRole('button', { name: 'تم روشن', exact: true }).click();
  await main.page.getByRole('button', { name: 'English', exact: true }).click();
  await main.page.waitForTimeout(500);
  equal(await main.page.locator('html').getAttribute('data-theme'), 'light', 'light theme');
  equal(await main.page.locator('html').getAttribute('dir'), 'ltr', 'English direction');
  ok((await main.page.locator('main').innerText()).includes('Focus length'), 'language switch keeps the current tab');
  const focus = main.page.getByRole('slider', { name: 'Focus length' });
  const prior = Number(await focus.getAttribute('aria-valuenow'));
  const box = await focus.boundingBox();
  await main.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await main.page.mouse.down();
  await main.page.mouse.move(box.x + box.width / 2 + 36, box.y + box.height / 2, { steps: 6 });
  await main.page.mouse.up();
  await main.page.waitForTimeout(350);
  let saved = await read(main.page);
  ok(saved.settings.timer.workMinutes >= prior + 4, `drag should increase focus: ${prior} -> ${saved.settings.timer.workMinutes}`);
  const remainingAfterDrag = saved.timer.remainingSeconds;
  equal(remainingAfterDrag, saved.settings.timer.workMinutes * 60, 'idle countdown follows configured work minutes');
  await main.page.getByRole('button', { name: 'Focus length +', exact: true }).click();
  await main.page.waitForTimeout(250);
  const afterPlus = (await read(main.page)).settings.timer.workMinutes;
  ok(afterPlus > saved.settings.timer.workMinutes, 'plus button works');

  // Inputs accept Persian digits, display the active locale, and save ASCII clock values.
  await nav(main.page, 'Eye protection').click();
  const night = main.page.getByRole('textbox', { name: 'Night starts' });
  await night.fill('۲۲:۱۵');
  await night.blur();
  await main.page.waitForTimeout(250);
  saved = await read(main.page);
  equal(saved.settings.eye.scheduleStart, '22:15', 'Persian time input is normalized for the backend');
  equal(await night.inputValue(), '22:15', 'time input displays Latin digits in English');
  ok((await night.evaluate(el => getComputedStyle(el).fontFamily)).includes('Inter'), 'English time input font');
  await main.page.getByRole('button', { name: 'فارسی', exact: true }).click();
  const nightFa = main.page.getByRole('textbox', { name: 'شروع شب' });
  await nightFa.waitFor();
  equal(await nightFa.inputValue(), '۲۲:۱۵', 'existing input switches to Persian digits');
  ok((await nightFa.evaluate(el => getComputedStyle(el).fontFamily)).includes('Vazirmatn'), 'Persian time input font');
  await main.page.getByRole('button', { name: 'English', exact: true }).click();
  await main.page.getByRole('textbox', { name: 'Night starts' }).waitFor();
  equal(await main.page.getByRole('textbox', { name: 'Night starts' }).inputValue(), '22:15', 'existing input switches back to Latin digits');
  for (const title of ['Dashboard', 'Eye protection', 'Pomodoro & snooze', 'Break lock & exercises', 'Health & focus report', 'System', 'About']) {
    await nav(main.page, title).click();
    await main.page.waitForTimeout(330);
    const text = await main.page.locator('main').innerText();
    const persianLetters = text.replaceAll('فارسی', '').match(/[\u0600-\u06ef\u06fa-\u06ff]+/g);
    ok(!persianLetters, `${title} English view contains untranslated letters: ${persianLetters}`);
    ok(!/[۰-۹٠-٩]/.test(text), `${title} English view contains Persian or Arabic digits`);
  }
  const credit = main.page.locator('main a[href="https://disweb.ir/"]');
  equal(await credit.count(), 1, 'creator link present');
  ok((await main.page.locator('main').innerText()).includes('Made with love for your eyes'), 'heart credit');
  await nav(main.page, 'System').click();
  const auto = main.page.getByRole('switch', { name: /Run automatically/i });
  if (await auto.count()) {
    const initial = await auto.getAttribute('aria-checked');
    await auto.click();
    equal(await auto.getAttribute('aria-checked'), String(initial !== 'true'), 'autostart switch works in preview');
  }
  await nav(main.page, 'Dashboard').click();
  const timerFont = await main.page.locator('main .digits').first().evaluate(el => getComputedStyle(el).fontFamily);
  ok(timerFont.includes('Inter'), 'English countdown uses a Latin font');
  const clockText = await main.page.locator('main .digits').first().innerText();
  ok(/[0-9]/.test(clockText) && !/[۰-۹٠-٩]/.test(clockText), 'English countdown uses Latin digits');

  // Timer keeps its remaining seconds when paused/resumed, including from floating widget.
  await main.page.getByRole('button', { name: 'Start focusing' }).click();
  await delay(2200);
  await main.page.getByRole('button', { name: 'Pause', exact: true }).click();
  await main.page.waitForTimeout(150);
  const paused = await read(main.page);
  ok(paused.timer.running && paused.timer.paused, 'timer paused');
  ok(paused.timer.remainingSeconds < paused.timer.totalSeconds, 'timer actually counted down');
  await delay(1300);
  equal((await read(main.page)).timer.remainingSeconds, paused.timer.remainingSeconds, 'pause freezes without resetting');
  await main.page.getByRole('button', { name: 'Resume', exact: true }).click();
  await delay(1300);
  ok((await read(main.page)).timer.remainingSeconds < paused.timer.remainingSeconds, 'resume continues from saved remainder');
  // Instant break works even if auto-start is off and timer was paused.
  await main.page.getByRole('button', { name: 'Pause', exact: true }).click();
  await nav(main.page, 'Pomodoro & snooze').click();
  let autoBreak = main.page.getByRole('switch', { name: /Auto-start the break/i });
  if (await autoBreak.count() && await autoBreak.getAttribute('aria-checked') === 'true') await autoBreak.click();
  await nav(main.page, 'Dashboard').click();
  await main.page.getByRole('button', { name: 'Start break', exact: true }).click();
  saved = await read(main.page);
  equal(saved.timer.phase, 'break', 'instant break enters break state');
  ok(saved.timer.running && !saved.timer.paused, 'instant break runs even from pause');

  // Seed each auxiliary webview independently: browser mock is not Windows IPC.
  const baseline = structuredClone(saved);
  baseline.timer.phase = 'work'; baseline.timer.running = true; baseline.timer.paused = false;
  baseline.timer.totalSeconds = 1500; baseline.timer.remainingSeconds = 1495;
  baseline.settings.system.widgetMode = 'floating';
  const floating = await fresh({ width: 276, height: 56 }, baseline);
  await floating.page.goto(url + '?win=micro-bar', { waitUntil: 'networkidle' });
  await floating.page.getByRole('button', { name: 'Start', exact: true }).click();
  await delay(1300);
  await floating.page.getByRole('button', { name: 'Pause', exact: true }).click();
  const floatPaused = await read(floating.page);
  ok(floatPaused.timer.paused, 'floating widget pause');
  ok(floatPaused.timer.remainingSeconds <= 1495 && floatPaused.timer.remainingSeconds > 1400, 'floating pause did not reset');
  ok(await floating.page.getByRole('button', { name: 'ChashmYar settings' }).isVisible(), 'floating settings button');
  await floating.context.close();

  // Hover intent waits for the configured delay and then shows the controls.
  baseline.settings.system.widgetMode = 'docked';
  baseline.settings.system.widgetHoverDelayMs = 650;
  const bar = await fresh({ width: 1000, height: 62 }, baseline);
  await bar.page.goto(url + '?win=micro-bar', { waitUntil: 'networkidle' });
  await bar.page.mouse.move(300, 35);
  await bar.page.mouse.move(300, 1);
  await bar.page.waitForTimeout(250);
  equal(await bar.page.getByRole('button', { name: 'Start break', exact: true }).count(), 0, 'hover does not open too early');
  await bar.page.waitForTimeout(650);
  ok(await bar.page.getByRole('button', { name: 'Start break', exact: true }).isVisible(), 'hover opens after configured delay');
  await bar.context.close();

  // Break screen physically matches the supplied sketch in both languages.
  baseline.timer.phase = 'break'; baseline.timer.remainingSeconds = 200; baseline.timer.totalSeconds = 300;
  const lock = await fresh({ width: 1366, height: 768 }, baseline);
  await lock.page.goto(url + '?win=break-lock', { waitUntil: 'networkidle' });
  const layout = await lock.page.evaluate(() => {
    const r = sel => document.querySelector(sel).getBoundingClientRect();
    const a = r('[data-testid=rest-timer]'), b = r('[data-testid=rest-tips]'), c = r('[data-testid=rest-exercises]');
    return { ax:a.x, ar:a.right, ab:a.bottom, bx:b.x, by:b.y, cx:c.x, cw:c.width, ch:c.height };
  });
  ok(Math.abs(layout.ax - layout.bx) < 2 && layout.by >= layout.ab, 'tips sit underneath the timer');
  ok(layout.cx > layout.ar && layout.cw > 2 * (layout.ar - layout.ax), 'large exercise panel sits to the right');
  ok((await lock.page.locator('[data-testid=stand-reminder]').innerText()).includes('Please stand up from your desk'), 'standing instruction is prominent');
  ok((await lock.page.locator('body').innerText()).includes('Ctrl'), 'Ctrl key shown');
  ok((await lock.page.locator('body').innerText()).includes('Shift'), 'Shift key shown');
  ok(!(await lock.page.locator('body').innerText()).includes('Ctrl+Shift+U'), 'U is not required');
  equal(await lock.page.getByRole('button', { name: 'End the break early' }).count(), 0, 'strict break has no direct bypass');
  await lock.page.getByRole('button', { name: 'Next move' }).click();
  await lock.page.getByText('Gentle up and down gaze', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });
  ok((await lock.page.locator('body').innerText()).includes('Gentle up and down gaze'), 'carousel advances one exercise at a time');
  await lock.page.getByRole('button', { name: 'Tip 3', exact: true }).click();
  await lock.page.getByText(/Match screen brightness/).waitFor({ state: 'visible', timeout: 5000 });
  ok((await lock.page.locator('body').innerText()).includes('Match screen brightness'), 'tip indicators change advice');
  ok(await lock.page.getByRole('button', { name: 'Start break countdown' }).isVisible(), 'waiting break has a start button');
  await lock.page.getByRole('button', { name: 'Start break countdown' }).click();
  ok((await read(lock.page)).timer.running, 'waiting break can start');

  const exercises = [
    ['horizontal', 'Gentle left and right gaze'], ['vertical', 'Gentle up and down gaze'],
    ['infinity', 'Follow the figure eight'], ['twenty', 'Look into the distance'],
    ['neck', 'Gentle neck stretch'], ['wrist', 'Gentle wrist movement'],
    ['shoulder', 'Raise and lower the shoulders'], ['posture', 'Standing side stretch'],
  ];
  for (let i = 0; i < exercises.length; i++) {
    await lock.page.getByRole('button', { name: `Exercise ${i + 1}`, exact: true }).click();
    await lock.page.getByText(exercises[i][1], { exact: true }).waitFor({ state: 'visible', timeout: 5000 });
    const scene = lock.page.locator(`[data-exercise-scene="${exercises[i][0]}"]`);
    ok(await scene.isVisible(), `exercise ${exercises[i][0]} scene`);
    equal(await lock.page.locator('.rest-instructions li').count(), 3, `exercise ${exercises[i][0]} has three instructions`);
    const body = await lock.page.locator('body').innerText();
    ok(!/[۰-۹٠-٩]/.test(body), `English exercise ${exercises[i][0]} has Latin digits only`);
    ok(!/[\u0600-\u06ff]/.test(body), `English exercise ${exercises[i][0]} has no untranslated Persian`);
    // Wait for the carousel entrance to finish, then measure actual rendered frames.
    await lock.page.waitForTimeout(350);
    const part = scene.locator('[data-motion-part]').first();
    const frame = () => part.evaluate(el => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(n => Math.round(n * 10) / 10).join(','); });
    const before = await frame();
    await lock.page.waitForTimeout(900);
    const after = await frame();
    ok(before !== after, `${exercises[i][0]} actually animates`);
    if (['horizontal', 'vertical', 'infinity'].includes(exercises[i][0])) {
      // Compare the guide and pupils in SVG coordinates, not just DOM attributes.
      const m = await scene.locator('svg').evaluate(svg => {
        const dot = svg.querySelector('[data-motion-part="guide-dot"]');
        const pupil = svg.querySelector('[data-motion-part="pupil"]');
        const inverse = svg.getScreenCTM().inverse();
        const dm = inverse.multiply(dot.getScreenCTM());
        const pm = inverse.multiply(pupil.getScreenCTM());
        const guide = new DOMPoint(dot.cx.animVal.value, dot.cy.animVal.value).matrixTransform(dm);
        return { x: guide.x, y: guide.y, px: pm.e, py: pm.f };
      });
      const mode = exercises[i][0];
      if (mode === 'horizontal') ok(Math.abs((m.x - 105) / 270 - (m.px + 15) / 30) < .09, 'horizontal pupils follow the guide');
      if (mode === 'vertical') ok(Math.abs((m.y - 34) / 108 - (m.py + 8) / 16) < .09, 'vertical pupils follow the guide');
      if (mode === 'infinity') {
        ok(Math.abs((m.x - 100) / 280 - (m.px + 13) / 26) < .09, 'figure-eight pupils follow the guide horizontally');
        ok(Math.abs((m.y - 88) / 50 - m.py / 5) < .12, 'figure-eight pupils follow the guide vertically');
      }
    }
  }
  await lock.context.close();

  // Automatic tip and exercise rotation work independently, including a saved
  // 10-second exercise interval. Speed up only those two timers in this mock.
  const timedState = structuredClone(baseline); timedState.settings.lock.rotateSeconds = 10;
  const timedContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await timedContext.addInitScript(state => localStorage.setItem('chashmyar.mock.snapshot', JSON.stringify(state)), timedState);
  await timedContext.addInitScript(() => {
    const realSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, ms === 10_000 || ms === 20_000 ? 900 : ms, ...args);
  });
  const timedPage = await timedContext.newPage();
  timedPage.on('pageerror', e => errors.push(e.message));
  await timedPage.goto(url + '?win=break-lock', { waitUntil: 'domcontentloaded' });
  await timedPage.waitForFunction(() => document.querySelector('.rest-tip-dots [aria-current="true"]')?.getAttribute('aria-label') === 'Tip 2'
    && document.querySelector('.rest-exercise-dots [aria-current="true"]')?.getAttribute('aria-label') === 'Exercise 2', null, { timeout: 5000 });
  ok(true, 'educational tips and exercises advance automatically');
  await timedContext.close();

  // OS reduced-motion is respected immediately and can change without a restart.
  const reducedContext = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
  await reducedContext.addInitScript(state => localStorage.setItem('chashmyar.mock.snapshot', JSON.stringify(state)), baseline);
  const reducedPage = await reducedContext.newPage();
  reducedPage.on('pageerror', e => errors.push(e.message));
  await reducedPage.goto(url + '?win=break-lock', { waitUntil: 'networkidle' });
  const reducedScene = reducedPage.locator('[data-exercise-scene="horizontal"]');
  equal(await reducedScene.locator('animate, animateTransform, animateMotion').count(), 0, 'reduced-motion scenes are static');
  await reducedPage.emulateMedia({ reducedMotion: 'no-preference' });
  await reducedScene.locator('animate').first().waitFor({ state: 'attached' });
  await reducedPage.waitForTimeout(350);
  const guide = reducedScene.locator('[data-motion-part="guide-dot"]');
  const x1 = await guide.evaluate(el => el.getBoundingClientRect().x);
  await reducedPage.waitForTimeout(900);
  const x2 = await guide.evaluate(el => el.getBoundingClientRect().x);
  ok(Math.abs(x2 - x1) > 2, 'animations resume when reduced-motion is turned off');
  await reducedPage.emulateMedia({ reducedMotion: 'reduce' });
  await reducedPage.waitForFunction(() => !document.querySelector('[data-exercise-scene="horizontal"] animate'));
  equal(await reducedScene.locator('animate, animateTransform, animateMotion').count(), 0, 'animations stop when reduced-motion is turned on');
  await reducedContext.close();

  // Break screen honors each saved locale and theme; digits use the right fonts.
  for (const [lang, theme] of [['fa','light'], ['fa','dark'], ['en','dark']]) {
    const state = structuredClone(baseline); state.settings.system.language = lang; state.settings.system.theme = theme;
    const themed = await fresh({ width: 1366, height: 768 }, state);
    await themed.page.goto(url + '?win=break-lock', { waitUntil: 'networkidle' });
    equal(await themed.page.locator('html').getAttribute('data-theme'), theme, `${lang} break screen ${theme} theme`);
    const digitInfo = await themed.page.locator('[data-testid="break-countdown"]').evaluate(el => ({ text: el.innerText, font: getComputedStyle(el).fontFamily }));
    ok(lang === 'fa' ? /[۰-۹]/.test(digitInfo.text) && digitInfo.font.includes('Vazirmatn') : /[0-9]/.test(digitInfo.text) && !/[۰-۹٠-٩]/.test(digitInfo.text) && digitInfo.font.includes('Inter'), `${lang} break digits and font`);
    if (lang === 'fa') {
      ok((await themed.page.locator('[data-testid="stand-reminder"]').innerText()).includes('لطفاً از پشت میز بلند شوید'), 'Persian standing reminder');
      ok(!(await themed.page.locator('body').innerText()).includes('بدن ت'), 'incorrect Persian spelling is absent');
    }
    await themed.context.close();
  }

  // Simple mode and disabled-exercise states preserve their original behaviour.
  const simpleState = structuredClone(baseline); simpleState.settings.lock.strictLock = false;
  simpleState.settings.lock.eyeExercises = false; simpleState.settings.lock.bodyExercises = false;
  const simple = await fresh({ width: 1000, height: 650 }, simpleState);
  await simple.page.goto(url + '?win=break-lock', { waitUntil: 'networkidle' });
  ok((await simple.page.locator('body').innerText()).includes('Exercises are off'), 'empty exercise state');
  ok(await simple.page.getByRole('button', { name: 'End the break early' }).isVisible(), 'simple mode permits early exit');
  await simple.page.getByRole('button', { name: 'End the break early' }).click();
  equal((await read(simple.page)).timer.phase, 'work', 'early exit transitions to work');
  await simple.context.close();

  // Small screens may scroll, but the contents do not overlap or clip.
  for (const [width,height] of [[1000,650],[800,600],[530,700]]) {
    const small = await fresh({ width, height }, baseline);
    await small.page.goto(url + '?win=break-lock', { waitUntil: 'networkidle' });
    await small.page.getByRole('button', { name: 'Exercise 6', exact: true }).click();
    await small.page.getByText('Gentle wrist movement', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });
    const bounds = await small.page.evaluate(() => {
      const instructions = document.querySelector('.rest-instructions');
      const last = instructions.lastElementChild.getBoundingClientRect();
      const nav = document.querySelector('.rest-exercise-nav').getBoundingClientRect();
      return { last: last.bottom, nav: nav.top, scroll: document.querySelector('.lock-shell').scrollHeight, viewport: document.querySelector('.lock-shell').clientHeight, horizontal: document.documentElement.scrollWidth > innerWidth };
    });
    ok(bounds.last <= bounds.nav + 2, `instructions do not overlap navigation at ${width}x${height}: ${JSON.stringify(bounds)}`);
    ok(!bounds.horizontal, `no horizontal overflow at ${width}x${height}`);
    await small.context.close();
  }

  // Every auxiliary page honors the light theme and has no rendering errors.
  for (const [win, viewport] of [['snooze-alert', { width: 452, height: 320 }], ['micro-break', { width: 520, height: 188 }], ['dimmer-overlay', { width: 900, height: 600 }]]) {
    const aux = await fresh(viewport, baseline);
    await aux.page.goto(url + '?win=' + win, { waitUntil: 'networkidle' });
    equal(await aux.page.locator('html').getAttribute('data-theme'), 'light', `${win} theme`);
    equal(await aux.page.locator('html').getAttribute('lang'), 'en', `${win} language`);
    await aux.context.close();
  }
  equal(errors.length, 0, 'no uncaught React errors: ' + errors.join('; '));
  equal(motionWarnings.length, 0, 'no undefined animation warnings: ' + motionWarnings.join('; '));
  await main.context.close();
  console.log(`PASS: ${checks} browser assertions across all six windows`);
} finally { await browser.close(); }
