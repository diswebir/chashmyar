// Browser/mock checks only: native updater, signatures and Windows swap are
// covered separately. No network request or executable installation occurs.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.env.CHASHMYAR_TEST_URL ?? 'http://127.0.0.1:1420/';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
let checks = 0;
const errors = [];
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (a, b, message) => { assert.equal(a, b, message); checks++; };
const pageFor = async (query, viewport = { width: 1000, height: 680 }) => {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}${query}`, { waitUntil: 'networkidle' });
  return { context, page };
};

try {
  for (const viewport of [{ width: 1000, height: 680 }, { width: 1440, height: 900 }]) {
    for (const theme of ['light', 'dark']) for (const language of ['fa', 'en']) for (const kind of ['installed', 'portable']) {
      const { context, page } = await pageFor(`?update=ready&kind=${kind}`, viewport);
      if (theme === 'dark') await page.getByRole('button', { name: 'تم تاریک', exact: true }).click();
      if (language === 'en') await page.getByRole('button', { name: 'English', exact: true }).click();
      eq(await page.locator('html').getAttribute('data-theme'), theme, 'theme');
      eq(await page.locator('html').getAttribute('dir'), language === 'fa' ? 'rtl' : 'ltr', 'direction');
      const badge = page.getByTestId('update-header');
      await badge.waitFor({ state: 'visible' });
      await badge.click();
      const card = page.getByTestId('update-card');
      await card.waitFor({ state: 'visible' });
      const state = card.getByTestId('update-status');
      eq(await state.getAttribute('data-phase'), 'ready', 'signed update is ready');
      const text = await state.innerText();
      ok(text.includes(language === 'en' ? 'signature verified' : 'امضای آن تأیید شد'), 'signature status is explained');
      ok(text.includes(kind === 'portable' ? (language === 'en' ? 'Portable build' : 'پرتابل') : (language === 'en' ? 'Installed build' : 'نصبی')), 'correct build flavour');
      await page.getByTestId('update-install-open').click();
      const dialog = page.getByTestId('update-confirm');
      ok(await dialog.isVisible(), 'confirmation is required before install');
      ok((await dialog.innerText()).includes(language === 'en' ? 'timer will stop' : 'تایمر جاری متوقف'), 'confirmation explains timer');
      ok((await dialog.innerText()).includes(language === 'en' ? 'settings and reports' : 'تنظیمات و گزارش'), 'confirmation explains preserved data');
      const rect = await dialog.boundingBox();
      ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width && rect.y + rect.height <= viewport.height, 'dialog fits viewport');
      if (process.env.CHASHMYAR_SCREENSHOTS && viewport.width === 1000 && language === 'fa' && kind === 'portable') {
        mkdirSync(process.env.CHASHMYAR_SCREENSHOTS, { recursive: true });
        await page.screenshot({ path: `${process.env.CHASHMYAR_SCREENSHOTS}/update-${theme}.png` });
      }
      await page.getByRole('button', { name: language === 'en' ? 'Not now' : 'فعلاً نه', exact: true }).click();
      ok(!(await dialog.isVisible()), 'cancel closes confirmation');
      eq(await state.getAttribute('data-phase'), 'ready', 'cancel never installs');
      await page.getByTestId('update-install-open').click();
      await page.keyboard.press('Escape');
      ok(!(await dialog.isVisible()), 'Escape cancels');
      eq(await state.getAttribute('data-phase'), 'ready', 'Escape never installs');
      await page.getByTestId('update-install-open').click();
      await page.getByTestId('update-confirm-install').click();
      await page.waitForFunction(() => document.querySelector('[data-testid=update-status]')?.getAttribute('data-phase') === 'installing');
      eq(await state.getAttribute('data-phase'), 'installing', 'only confirmed action starts mocked install');
      await context.close();
    }
  }

  {
    const { context, page } = await pageFor('?update=download');
    await page.getByRole('button', { name: /درباره/ }).first().click();
    const bar = page.getByRole('progressbar', { name: 'پیشرفت دریافت' });
    eq(await bar.getAttribute('aria-valuenow'), '50', 'download progress is accessible');
    ok(await page.getByTestId('update-check').isDisabled(), 'check disabled while downloading');
    await context.close();
  }
  {
    const { context, page } = await pageFor('?update=error');
    await page.getByRole('button', { name: /درباره/ }).first().click();
    const state = page.getByTestId('update-status');
    eq(await state.getAttribute('data-phase'), 'error', 'offline/failure state shown');
    ok(await page.getByTestId('update-check').isEnabled(), 'retry is available after failure');
    await context.close();
  }
  {
    const { context, page } = await pageFor('?update=unconfigured');
    await page.getByRole('button', { name: /درباره/ }).first().click();
    eq(await page.getByTestId('update-status').getAttribute('data-phase'), 'unconfigured', 'missing key is explicit');
    ok(await page.getByTestId('update-check').isDisabled(), 'missing key fails closed');
    await context.close();
  }
  {
    const { context, page } = await pageFor('?update=portable-error&kind=portable');
    await page.getByTestId('update-header').click();
    await page.getByTestId('update-install-open').click();
    await page.getByTestId('update-confirm-install').click();
    await page.getByRole('alert').waitFor();
    ok((await page.getByRole('alert').innerText()).includes('پرتابل'), 'portable write failure has recovery guidance');
    eq(await page.getByTestId('update-status').getAttribute('data-phase'), 'ready', 'failure does not falsely report success');
    await context.close();
  }
  for (const language of ['fa', 'en']) {
    const { context, page } = await pageFor('?update=settings-error');
    if (language === 'en') await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.getByTestId('update-header').click();
    await page.getByTestId('update-install-open').click();
    await page.getByTestId('update-confirm-install').click();
    const alert = page.getByRole('alert');
    await alert.waitFor();
    ok((await alert.innerText()).includes(language === 'en' ? 'installation was stopped' : 'نصب متوقف شد'), 'save failure explains the stop');
    eq(await page.getByTestId('update-status').getAttribute('data-phase'), 'ready', 'save failure keeps verified update ready');
    ok(await page.getByTestId('update-install-open').isEnabled(), 'save failure can be retried');
    await context.close();
  }
  for (const language of ['fa', 'en']) {
    const { context, page } = await pageFor('?update=installer-error');
    if (language === 'en') await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.getByTestId('update-header').click();
    await page.getByTestId('update-install-open').click();
    await page.getByTestId('update-confirm-install').click();
    const alert = page.getByRole('alert');
    await alert.waitFor();
    ok((await alert.innerText()).includes(language === 'en' ? 'temporary folder' : 'پوشه موقت'), 'installer preparation error gives recovery guidance');
    eq(await page.getByTestId('update-status').getAttribute('data-phase'), 'ready', 'preparation error keeps verified update ready');
    ok(await page.getByTestId('update-install-open').isEnabled(), 'preparation error can be retried without downloading again');
    await context.close();
  }
  {
    const { context, page } = await pageFor('');
    await page.getByRole('button', { name: /درباره/ }).first().click();
    await page.getByTestId('update-check').click();
    eq(await page.getByTestId('update-status').getAttribute('data-phase'), 'upToDate', 'manual check updates status in mock');
    await context.close();
  }
  {
    const { context, page } = await pageFor('?win=update-alert&update=ready&kind=portable', { width: 430, height: 146 });
    const notice = page.getByTestId('update-notice');
    ok(await notice.isVisible(), 'passive notice renders independently');
    const rect = await notice.boundingBox();
    ok(rect.width <= 430 && rect.height <= 146, 'passive notice fits native window');
    ok(await page.getByRole('button', { name: 'مشاهده و نصب' }).isVisible(), 'notice offers details, not immediate install');
    ok(await page.getByRole('button', { name: 'بستن اعلان به‌روزرسانی' }).isVisible(), 'notice can be dismissed');
    await context.close();
  }
  eq(errors.length, 0, `no browser errors: ${errors.join('; ')}`);
  console.log(`✓ Updates UI: ${checks} browser/mock checks across sizes, themes, languages, flavours and states.`);
} finally { await browser.close(); }
