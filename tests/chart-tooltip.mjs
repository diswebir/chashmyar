/** Weekly-chart tooltip regression: browser/mock only, not native Windows. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.env.CHASHMYAR_TEST_URL ?? 'http://127.0.0.1:1420/';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const errors = [];
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };
const normalize = (text) => text
  .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x6f0))
  .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660))
  .replace(/٪/g, '%').replace(/\s+/g, ' ').trim();

try {
  for (const viewport of [{ width: 1000, height: 680 }, { width: 1440, height: 900 }]) {
    for (const theme of ['light', 'dark']) for (const language of ['fa', 'en']) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      await context.addInitScript(() => {
        // All data is synthetic. Match the mock backend's date arithmetic.
        const now = new Date(), records = {};
        for (let i = 0; i < 7; i++) {
          const day = new Date(now.getTime() - (6 - i) * 86400000);
          const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
          records[key] = {
            deepWorkMinutes: 172 + i * 40,
            snoozeUsedCount: i + 2,
            observedBreaksCompleted: i + 1,
            observedBreaksSkipped: 1,
          };
        }
        localStorage.setItem('chashmyar.mock.analytics', JSON.stringify(records));
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(url, { waitUntil: 'networkidle' });
      if (theme === 'dark') await page.getByRole('button', { name: 'تم تاریک', exact: true }).click();
      if (language === 'en') await page.getByRole('button', { name: 'English', exact: true }).click();
      await page.locator('nav').getByRole('button', {
        name: language === 'fa' ? /گزارش سلامت و تمرکز/ : /Health & focus report/,
      }).click();
      const chart = page.getByTestId('weekly-chart');
      await chart.waitFor({ state: 'visible' });
      const days = chart.getByTestId('weekly-chart-day');
      eq(await days.count(), 7, 'all seven day hit areas are present');
      eq(await page.locator('html').getAttribute('data-theme'), theme, 'correct theme');
      eq(await page.locator('html').getAttribute('dir'), language === 'fa' ? 'rtl' : 'ltr', 'correct language direction');

      // First, middle and last days: verify the hovered data, not just colors.
      for (const i of [0, 3, 6]) {
        await days.nth(i).scrollIntoViewIfNeeded();
        // The colored bar can cover the transparent hit area; both belong to
        // the same day group, so move the real pointer to the group's center.
        await days.nth(i).hover({ force: true });
        const tooltip = chart.getByTestId('weekly-chart-tooltip');
        await tooltip.waitFor({ state: 'visible' });
        const text = normalize(await tooltip.innerText());
        const minutes = 172 + i * 40, h = Math.floor(minutes / 60), m = minutes % 60;
        const time = language === 'fa' ? `${h} ساعت و ${m} دقیقه` : `${h} hr ${m} min`;
        const count = language === 'fa' ? `${i + 2} بار` : `${i + 2} times`;
        const score = Math.round(100 * (i + 1) / (i + 2));
        ok(text.includes(time), `${theme}/${language} day ${i}: correct work time (${text})`);
        ok(text.includes(count), `${theme}/${language} day ${i}: correct snooze count (${text})`);
        ok(text.includes(`${score}%`), `${theme}/${language} day ${i}: correct score (${text})`);
        ok(text.includes(language === 'fa' ? 'زمان تایمر کاری' : 'Work-timer time'), 'localized work label');
        ok(text.includes(language === 'fa' ? 'تعویق' : 'Snooze'), 'localized snooze label');
        eq(await tooltip.getAttribute('dir'), language === 'fa' ? 'rtl' : 'ltr', 'tooltip direction');
        const style = await tooltip.evaluate((el) => {
          const css = getComputedStyle(el), rect = el.getBoundingClientRect();
          const rgb = (color) => (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
          const luminance = (c) => c.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
            .reduce((sum, v, n) => sum + v * [0.2126, 0.7152, 0.0722][n], 0);
          const background = rgb(css.backgroundColor), bgLuminance = luminance(background);
          const contrasts = [...el.querySelectorAll('span')].map((node) => {
            const fg = luminance(rgb(getComputedStyle(node).color));
            return (Math.max(fg, bgLuminance) + 0.05) / (Math.min(fg, bgLuminance) + 0.05);
          });
          return { background: css.backgroundColor, opacity: css.opacity, pointerEvents: css.pointerEvents, contrasts,
            rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } };
        });
        eq(style.background, theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(11, 17, 32)', `${theme} tooltip background`);
        eq(style.opacity, '1', 'tooltip is not faded');
        eq(style.pointerEvents, 'none', 'tooltip cannot block hovering the chart');
        eq(style.contrasts.length, 6, 'day, score, labels and values all present');
        ok(style.contrasts.every((contrast) => contrast >= 4.5), `${theme}/${language}: all tooltip text contrast >= 4.5:1 (${style.contrasts})`);
        ok(style.rect.left >= 0 && style.rect.right <= viewport.width && style.rect.top >= 0 && style.rect.bottom <= viewport.height,
          `${theme}/${language}: tooltip fits within the viewport (${JSON.stringify(style.rect)})`);
      }
      await page.mouse.move(0, 0);
      await chart.getByTestId('weekly-chart-tooltip').waitFor({ state: 'detached' });
      ok(true, 'tooltip hides when the pointer leaves the chart');
      await context.close();
    }
  }
  eq(errors.length, 0, `no browser errors: ${errors.join('; ')}`);
  console.log(`✓ Weekly chart tooltip: ${checks} browser/mock assertions across themes, languages, viewports and days.`);
} finally {
  await browser.close();
}
