// Takes the README's picture of every app (docs/readme/apps/<app>.png and <app>-dark.png), from the preview build with
// its sample data, so the "Every app" gallery and the app pages can be refreshed in one go.
// Run from apps/desktop: `npm run readme-shots`. It starts its own dev server, so nothing else needs to be running.
// `npm run readme-shots -- music tasks` retakes only those. Look at every picture before committing it.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = resolve(root, '../../docs/readme/apps');
const only = process.argv.slice(2);
// The picture's name, and the app's row in the launcher (Ctrl+K). Settings opens with Ctrl+,.
const APPS = [
  ['agent', 'Agent'], ['agents', 'Agents'], ['activity', 'Activity'], ['abilities', 'Abilities'], ['settings', null],
  ['notes', 'Notes'], ['docs', 'Docs'], ['tasks', 'Tasks'], ['calendar', 'Calendar'], ['sheets', 'Sheets'],
  ['database', 'Database'], ['projects', 'Projects'], ['knowledge', 'Knowledge'],
  ['browser', 'Browser'], ['mail', 'Mail'], ['search', 'Search'], ['research', 'Research'], ['reader', 'Reader'], ['files', 'Files'],
  ['slides', 'Slides'], ['design', 'Design'], ['photo', 'Photo'], ['music', 'Music'], ['video', 'Video'], ['code', 'Code'],
  ['terminal', 'Terminal'], ['canvas', 'Canvas'],
  ['review', 'Review'], ['views', 'Views'],
];
// What to do once an app is open, so its picture shows it in use rather than empty.
const THEN = {
  mail: async (page) => { await page.getByText('Quote: 8 × 60 kWh packs').first().click(); },
  views: async (page) => { await page.locator('.ui-side').getByText('Today', { exact: true }).first().click(); },
};
mkdirSync(out, { recursive: true });

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', fs: { strict: false } } });
await server.listen();
const { port } = server.httpServer.address();
// CHROMIUM_PATH points at another Chromium when the one Playwright expects isn't installed.
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let taken = 0;
try {
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForSelector('.rail');
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: '*{caret-color:transparent!important}' });
    for (const [name, query] of APPS) {
      if (only.length && !only.includes(name)) continue;
      // Start each app from the window, not from a field the last app left focused (Mail's message keeps the keys).
      await page.keyboard.press('Escape');
      await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
      if (query) {
        await page.keyboard.press('Control+k');
        await page.waitForTimeout(300);
        await page.keyboard.type(query);
        // The row named as the app (its name, then its line, so "Agent" doesn't match "Agents"): the first row can be
        // "Ask Mobius".
        await page.locator('[role=option]').filter({ hasText: new RegExp(`^${query}(?![a-z])`) }).first().click();
      } else {
        await page.keyboard.press('Control+,');
      }
      await page.waitForTimeout(1200);
      if (THEN[name]) { await THEN[name](page); await page.waitForTimeout(800); }
      // The app's own window, without the Mobius panel beside it.
      // (Search has no panel of its own: its Mobius button goes Home, so it is left alone.)
      const mobius = page.locator('.rail-mobius[aria-pressed="true"]');
      if (name !== 'search' && await mobius.count()) { await mobius.click(); await page.waitForTimeout(400); }
      await page.mouse.move(1439, 899);
      await page.waitForTimeout(200);
      await page.screenshot({ path: resolve(out, `${name}${scheme === 'dark' ? '-dark' : ''}.png`), animations: 'disabled' });
      taken++;
    }
    await page.close();
  }
  console.log(`readme-shots: ${taken} pictures in docs/readme/apps`);
} finally {
  await browser.close();
  await server.close();
}
