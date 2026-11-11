/** Production browser/mock check of the header logo and favicon, not native Windows. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.env.CHASHMYAR_TEST_URL ?? 'http://127.0.0.1:1420/';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
let checks = 0;
const errors = [];
const ok = (condition, message) => { assert.ok(condition, message); checks++; };
const eq = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };

try {
  for (const viewport of [{ width: 1000, height: 680 }, { width: 1440, height: 900 }]) {
    for (const theme of ['light', 'dark']) for (const language of ['fa', 'en']) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(url, { waitUntil: 'networkidle' });
      if (theme === 'dark') await page.getByRole('button', { name: 'تم تاریک', exact: true }).click();
      if (language === 'en') await page.getByRole('button', { name: 'English', exact: true }).click();
      eq(await page.locator('html').getAttribute('data-theme'), theme, 'correct theme');
      eq(await page.locator('html').getAttribute('dir'), language === 'fa' ? 'rtl' : 'ltr', 'correct direction');
      const logo = page.getByTestId('brand-logo');
      eq(await logo.count(), 1, 'one header brand image');
      ok(await logo.isVisible(), 'header brand is visible');
      const data = await logo.evaluate((img) => {
        const rect = img.getBoundingClientRect();
        const header = img.closest('header').getBoundingClientRect();
        return {
          complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
          width: rect.width, height: rect.height,
          inside: rect.left >= header.left && rect.right <= header.right && rect.top >= header.top && rect.bottom <= header.bottom,
          alt: img.getAttribute('alt'), hidden: img.getAttribute('aria-hidden'),
        };
      });
      ok(data.complete && data.naturalWidth === 128 && data.naturalHeight === 128, '128px brand asset loaded');
      ok(data.width === 44 && data.height === 44 && data.inside, 'brand fits in the header');
      ok(data.alt === '' && data.hidden === 'true', 'brand is decorative next to the accessible heading');
      const heading = page.locator('header h1');
      ok((await heading.innerText()).includes(language === 'fa' ? 'چشم‌یار' : 'ChashmYar'), 'brand name remains accessible');
      const favicon = await page.evaluate(async () => {
        const link = document.querySelector('link[rel="icon"]');
        if (!link) return null;
        const response = await fetch(link.href);
        return { ok: response.ok, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
      });
      ok(favicon?.ok, 'favicon loads');
      ok(Buffer.from(favicon.bytes).equals(readFileSync('src-tauri/icons/32x32.png')), 'favicon matches the 32px app icon');
      await context.close();
    }
  }
  eq(errors.length, 0, `no browser errors: ${errors.join('; ')}`);
  console.log(`✓ Brand UI: ${checks} browser/mock checks across both themes and languages.`);
} finally {
  await browser.close();
}
