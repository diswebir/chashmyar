/** Browser/mock coverage only. This does not call Magnification or change any
 * physical display, and cannot establish that the recolouring helps a person. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.CHASHMYAR_TEST_URL ?? 'http://127.0.0.1:1420/';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const contexts = [];
const errors = [];
let checks = 0;
const ok = (v, message) => { assert.ok(v, message); checks++; };
const eq = (v, expected, message) => { assert.equal(v, expected, message); checks++; };
const read = page => page.evaluate(() => JSON.parse(localStorage.getItem('chashmyar.mock.snapshot')));
const nav = (page, name) => page.locator('nav').getByRole('button', { name: new RegExp(name) });
const status = page => page.getByTestId('color-vision-status');
const card = page => page.getByTestId('color-vision-card');
const radio = (page, id) => page.getByTestId(`color-vision-${id}`);

async function fresh({ seed, scenario, viewport = { width: 1180, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport });
  contexts.push(context);
  if (seed) await context.addInitScript(v => localStorage.setItem('chashmyar.mock.snapshot', JSON.stringify(v)), seed);
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const url = new URL(base);
  if (scenario) url.searchParams.set('cvd', scenario);
  await page.goto(url.href, { waitUntil: 'networkidle' });
  return page;
}
async function eyeTab(page, language = 'fa') {
  await nav(page, language === 'fa' ? 'محافظ چشم' : 'Eye care').click();
  await card(page).waitFor({ state: 'visible' });
}
async function waitSaved(page, field, value) {
  await page.waitForFunction(([key, expected]) => {
    const s = JSON.parse(localStorage.getItem('chashmyar.mock.snapshot') || 'null');
    return s?.settings?.eye?.[key] === expected;
  }, [field, value]);
}
async function expectStatus(page, value) {
  await page.waitForFunction(v => document.querySelector('[data-testid="color-vision-status"]')?.dataset.status === v, value);
  eq(await status(page).getAttribute('data-status'), value, `mock status is ${value}`);
}

try {
  const main = await fresh({ scenario: 'active' });
  await main.waitForFunction(() => localStorage.getItem('chashmyar.mock.snapshot') !== null);
  const initial = await read(main);
  eq(initial.settings.eye.colorVisionProfile, 'off', 'fresh installation is opt-in');
  eq(initial.settings.eye.colorVisionStrength, 60, 'fresh strength preference is 60');
  await eyeTab(main);
  eq(await main.evaluate(() => document.documentElement.dir), 'rtl', 'Persian direction');
  ok(await radio(main, 'off').isChecked(), 'off radio is selected initially');
  const slider = main.getByRole('slider', { name: 'شدت تغییر رنگ', exact: true });
  ok(await slider.isDisabled(), 'strength is unavailable while off');
  await expectStatus(main, 'off');
  ok(await main.getByTestId('color-vision-browser-note').isVisible(), 'browser limitation shown');
  for (const name of ['قرمز', 'سبز', 'آبی', 'خاکستری']) ok(await main.getByTestId('color-vision-samples').getByText(name, { exact: true }).isVisible(), `sample ${name} labelled`);

  for (const profile of ['protanopia', 'deuteranopia', 'tritanopia']) {
    await radio(main, profile).check();
    await waitSaved(main, 'colorVisionProfile', profile);
    ok(await radio(main, profile).isChecked(), `selectable ${profile}`);
    await expectStatus(main, 'active');
  }
  const afterSelection = await read(main);
  for (const key of ['enabled', 'kelvin', 'brightness', 'profile', 'scheduleEnabled', 'colorSafeEnabled']) {
    eq(afterSelection.settings.eye[key], initial.settings.eye[key], `colour selection leaves ${key} untouched`);
  }
  ok(await slider.isEnabled(), 'strength enabled with a profile');
  eq(await slider.evaluate(el => getComputedStyle(el).direction), 'ltr', 'physical slider direction stays LTR in Persian');
  await slider.focus();
  await slider.press('Home');
  await waitSaved(main, 'colorVisionStrength', 0);
  await expectStatus(main, 'off');
  ok(await radio(main, 'tritanopia').isChecked(), 'zero strength keeps the selected profile');
  for (let i = 0; i < 7; i++) await slider.press('ArrowRight');
  await waitSaved(main, 'colorVisionStrength', 35);
  await expectStatus(main, 'active');
  await main.getByRole('button', { name: 'محافظ چشم فعال', exact: true }).click();
  await waitSaved(main, 'enabled', false);
  await expectStatus(main, 'active');
  eq((await read(main)).settings.eye.colorVisionProfile, 'tritanopia', 'eye-care power switch does not clear colour-vision selection');
  await main.reload({ waitUntil: 'networkidle' });
  await eyeTab(main);
  ok(await radio(main, 'tritanopia').isChecked(), 'selected profile survives reload');
  eq(await slider.inputValue(), '35', 'strength survives reload');
  eq((await read(main)).settings.eye.enabled, false, 'eye power preference survives reload');
  await expectStatus(main, 'active');
  // Existing warmth presets remain independent and usable.
  await main.getByRole('button', { name: /مطالعه.*گرمای ملایم/ }).click();
  await waitSaved(main, 'profile', 'reading');
  const preset = await read(main);
  eq(preset.settings.eye.kelvin, 3900, 'warm preset still changes temperature');
  eq(preset.settings.eye.brightness, 88, 'warm preset still changes brightness');
  eq(preset.settings.eye.colorVisionProfile, 'tritanopia', 'warm preset leaves vision profile alone');
  eq(preset.settings.eye.colorVisionStrength, 35, 'warm preset leaves vision strength alone');
  await radio(main, 'off').check();
  await waitSaved(main, 'colorVisionProfile', 'off');
  await expectStatus(main, 'off');
  ok(await slider.isDisabled(), 'off disables the strength control');

  // Existing snapshots lacking the new fields keep their original preferences.
  const old = structuredClone(initial);
  delete old.settings.eye.colorVisionProfile;
  delete old.settings.eye.colorVisionStrength;
  delete old.eye.colorVisionStatus;
  old.settings.eye.kelvin = 3300;
  old.settings.eye.enabled = false;
  old.settings.system.soundEnabled = true;
  const migrated = await fresh({ seed: old });
  await eyeTab(migrated);
  ok(await radio(migrated, 'off').isChecked(), 'old mock snapshot starts with vision off');
  eq(await migrated.getByRole('slider', { name: 'شدت تغییر رنگ' }).inputValue(), '60', 'missing strength gets the new default');
  await radio(migrated, 'deuteranopia').check();
  await waitSaved(migrated, 'colorVisionProfile', 'deuteranopia');
  const migratedSaved = await read(migrated);
  eq(migratedSaved.settings.eye.kelvin, 3300, 'old colour temperature preserved');
  eq(migratedSaved.settings.eye.enabled, false, 'old power choice preserved');
  eq(migratedSaved.settings.system.soundEnabled, true, 'old unrelated sound choice preserved');
  await expectStatus(migrated, 'unsupported');

  const unknown = structuredClone(initial);
  unknown.settings.eye.colorVisionProfile = 'future-unknown';
  unknown.settings.eye.colorVisionStrength = 500;
  unknown.settings.eye.kelvin = 3400;
  const bad = await fresh({ seed: unknown });
  await eyeTab(bad);
  ok(await radio(bad, 'off').isChecked(), 'unrecognized mock profile fails closed');
  eq(await bad.getByRole('slider', { name: 'شدت تغییر رنگ' }).inputValue(), '100', 'out-of-range mock strength clamped');
  await radio(bad, 'protanopia').check();
  await waitSaved(bad, 'colorVisionProfile', 'protanopia');
  eq((await read(bad)).settings.eye.kelvin, 3400, 'normalization does not replace unrelated values');

  const corrupt = structuredClone(initial);
  corrupt.settings.eye.colorVisionProfile = 'protanopia';
  corrupt.settings.eye.colorVisionStrength = null;
  corrupt.settings.eye.kelvin = 3350;
  const malformed = await fresh({ seed: corrupt, scenario: 'active' });
  await eyeTab(malformed);
  ok(await radio(malformed, 'protanopia').isChecked(), 'malformed strength does not discard the selected profile');
  eq(await malformed.getByRole('slider', { name: 'شدت تغییر رنگ' }).inputValue(), '0', 'malformed present strength fails closed');
  await expectStatus(malformed, 'off');
  await radio(malformed, 'deuteranopia').check();
  await waitSaved(malformed, 'colorVisionProfile', 'deuteranopia');
  eq((await read(malformed)).settings.eye.kelvin, 3350, 'malformed strength does not replace older preferences');

  const white = structuredClone(initial);
  white.settings.eye.colorVisionProfile = 'deuteranopia';
  white.settings.eye.colorVisionStrength = 60;
  white.settings.eye.colorSafeEnabled = true;
  white.eye.whitelisted = true;
  const safe = await fresh({ seed: white, scenario: 'active' });
  await eyeTab(safe);
  await expectStatus(safe, 'paused');
  ok(await radio(safe, 'deuteranopia').isChecked(), 'whitelist pauses without losing selection');
  const safeToggle = safe.getByRole('switch', { name: /فعال‌سازی لیست رنگ‌ایمن/ });
  await safeToggle.click();
  await waitSaved(safe, 'colorSafeEnabled', false);
  await expectStatus(safe, 'active');
  await safeToggle.click();
  await waitSaved(safe, 'colorSafeEnabled', true);
  await expectStatus(safe, 'paused');

  for (const [scenario, english] of [
    ['active', 'Windows accepted the filter request'],
    ['conflict', 'Another full-screen effect was detected'],
    ['error', 'The filter could not be applied'],
    ['restoreError', 'Restoring the colour could not be confirmed'],
  ]) {
    const page = await fresh({ scenario, viewport: { width: 980, height: 760 } });
    await eyeTab(page);
    await radio(page, 'protanopia').check();
    await waitSaved(page, 'colorVisionProfile', 'protanopia');
    await expectStatus(page, scenario);
    if (scenario === 'conflict' || scenario === 'error') {
      const retry = page.getByTestId('color-vision-retry');
      ok(await retry.isVisible(), `${scenario} offers retry`);
      const revision = (await read(page)).revision;
      await retry.click();
      await page.waitForFunction(v => JSON.parse(localStorage.getItem('chashmyar.mock.snapshot')).revision > v, revision);
      await expectStatus(page, scenario); // scenario intentionally remains mocked
    } else eq(await page.getByTestId('color-vision-retry').count(), 0, `${scenario} has no inappropriate retry`);
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.getByRole('slider', { name: 'Recolouring strength', exact: true }).waitFor();
    eq(await page.evaluate(() => document.documentElement.dir), 'ltr', `${scenario}: English direction`);
    ok((await status(page).innerText()).includes(english), `${scenario}: status translated`);
    ok((await card(page).innerText()).includes('Colour-vision assistance'), `${scenario}: heading translated`);
    ok((await page.getByTestId('color-vision-browser-note').innerText()).includes('does not change the real display'), `${scenario}: browser caveat translated`);
    ok(await page.getByRole('radio', { name: /Protan \(red–green\)/ }).isChecked(), `${scenario}: selection survives language switch`);
    if (scenario === 'conflict' || scenario === 'error') ok((await page.getByTestId('color-vision-retry').innerText()).includes('Retry'), `${scenario}: retry translated`);
  }
  const unsupported = await fresh();
  await eyeTab(unsupported);
  await radio(unsupported, 'tritanopia').check();
  await expectStatus(unsupported, 'unsupported');
  await unsupported.getByRole('button', { name: 'English', exact: true }).click();
  ok((await status(unsupported).innerText()).includes('cannot be applied in this environment'), 'unsupported message translated');
  eq(errors.length, 0, `no uncaught page errors: ${errors.join('; ')}`);
  console.log(`PASS: ${checks} colour-vision browser/mock assertions (no native display changes)`);
} finally {
  await Promise.all(contexts.map(c => c.close()));
  await browser.close();
}
