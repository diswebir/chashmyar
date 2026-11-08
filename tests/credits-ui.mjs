/** Creator-card regression checks in both themes/languages. Browser mock, not native Windows. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url = process.env.CHASHMYAR_TEST_URL ?? 'http://127.0.0.1:1420/';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
let checks = 0;
const errors = [];
const ok = (value, msg) => { assert.ok(value, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

try {
  for (const viewport of [{ width: 1000, height: 680 }, { width: 1440, height: 900 }]) {
    for (const theme of ['light', 'dark']) for (const lang of ['fa', 'en']) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(url, { waitUntil: 'networkidle' });
      if (theme === 'dark') await page.getByRole('button', { name: 'تم تاریک', exact: true }).click();
      if (lang === 'en') await page.getByRole('button', { name: 'English', exact: true }).click();
      eq(await page.locator('html').getAttribute('data-theme'), theme, 'theme switched');
      eq(await page.locator('html').getAttribute('dir'), lang === 'fa' ? 'rtl' : 'ltr', 'language direction');
      const cards = [page.locator('aside [data-testid="credits-card"]')];
      await page.locator('nav').getByRole('button', { name: lang === 'fa' ? /درباره/ : /About/ }).click();
      const aboutCard = page.locator('main [data-testid="credits-card"]');
      await aboutCard.waitFor({ state: 'visible' });
      cards.push(aboutCard);

      for (const card of cards) {
        await card.scrollIntoViewIfNeeded();
        eq(await card.getByTestId('credits-heart').count(), 1, 'exactly one heart in each card');
        eq(await card.locator('.credits-heart svg path').count(), 1, 'single heart shape');
        eq(await card.locator('a').count(), 1, 'creator name and website share one link');
        const link = card.locator('a');
        eq(await link.getAttribute('href'), 'https://disweb.ir/', 'correct author URL');
        eq(await link.getAttribute('target'), '_blank', 'link opens in new window');
        ok((await link.getAttribute('rel')).includes('noopener'), 'safe external link');
        const text = await card.innerText();
        ok(text.includes(lang === 'fa' ? 'رضا جنترانی' : 'Reza Jantrani'), 'creator name visible');
        ok(text.includes('disweb.ir'), 'domain visible');
        ok(text.includes(lang === 'fa' ? 'ساخته شده با قلب برای چشمان شما' : 'Made with love for your eyes'), 'signature visible');
        const info = await card.evaluate((el) => {
          const name = el.querySelector('.credits-name');
          const tagline = el.querySelector('.credits-tagline');
          const domain = el.querySelector('.credits-domain');
          const heart = el.querySelector('[data-testid="credits-heart"]');
          const bounds = el.getBoundingClientRect();
          const inside = (node) => {
            const r = node.getBoundingClientRect();
            return r.left >= bounds.left - 1 && r.right <= bounds.right + 1 && r.top >= bounds.top - 1 && r.bottom <= bounds.bottom + 1;
          };
          const rgb = (css) => (css.match(/\d+(?:\.\d+)?/g) || []).slice(0, 3).map(Number);
          const lum = (c) => c.map((x) => x / 255).map((x) => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4).reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0);
          const bg = rgb(getComputedStyle(el).backgroundColor);
          const contrast = (node) => {
            const l1 = lum(rgb(getComputedStyle(node).color)), l2 = lum(bg);
            return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          };
          return {
            inside: [name, tagline, domain, heart].every(inside),
            noOverflow: el.scrollWidth <= el.clientWidth,
            taglineLines: Math.round((tagline.getBoundingClientRect().height - parseFloat(getComputedStyle(tagline).paddingTop) - 1) / parseFloat(getComputedStyle(tagline).lineHeight)),
            nameContrast: contrast(name), taglineContrast: contrast(tagline), domainContrast: contrast(domain),
          };
        });
        ok(info.inside && info.noOverflow, 'card contents fit within bounds');
        eq(info.taglineLines, 1, 'signature fits on one line');
        ok(info.nameContrast >= 4.5 && info.taglineContrast >= 4.5 && info.domainContrast >= 4.5, `text contrast meets 4.5:1 (${JSON.stringify(info)})`);
      }
      await context.close();
    }
  }
  eq(errors.length, 0, `no browser exceptions: ${errors.join('; ')}`);
  console.log(`PASS: ${checks} creator-card assertions across themes, languages and viewports`);
} finally { await browser.close(); }
