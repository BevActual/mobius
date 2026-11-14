// Takes a picture of every group on the reference sheet (src/ui-sheet) for the component library pages.
// Run from apps/desktop: `npm run ui-shots`. It starts its own dev server, so nothing else needs to be running.
// Each `<Card shot="…">` becomes docs/developers/ui/img/<shot>.png (light theme, comfortable density, 2x).
// `npm run ui-shots -- buttons fields` retakes only those.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = resolve(root, '../../docs/developers/ui/img');
const only = process.argv.slice(2);
// Shots that show a control open: what to click first. Menus open in a layer above the page, inside the card's area.
const OPEN = { menus: '[aria-label="Permission"]' };
mkdirSync(out, { recursive: true });

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', fs: { strict: false } } });
await server.listen();
const { port } = server.httpServer.address();
// CHROMIUM_PATH points at another Chromium when the one Playwright expects isn't installed.
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto(`http://127.0.0.1:${port}/ui-sheet.html`);
  await page.waitForSelector('[data-shot]');
  await page.evaluate(() => document.fonts.ready);
  // No caret blinking or hover states in the pictures.
  // Cards hug their own content, so a short card is not stretched to its taller neighbour.
  await page.addStyleTag({ content: '*{caret-color:transparent!important} .sheet-grid{align-items:start}' });
  await page.mouse.move(0, 0);
  const shots = await page.$$eval('[data-shot]', (els) => els.map((el) => el.getAttribute('data-shot')));
  let taken = 0;
  for (const shot of shots) {
    if (only.length && !only.includes(shot)) continue;
    const card = page.locator(`[data-shot="${shot}"]`);
    await card.scrollIntoViewIfNeeded();
    if (OPEN[shot]) {
      await card.locator(OPEN[shot]).click();
      await page.waitForSelector('.ui-menu-positioner');
      await page.mouse.move(0, 0);
    }
    await card.screenshot({ path: resolve(out, `${shot}.png`), animations: 'disabled' });
    if (OPEN[shot]) await page.keyboard.press('Escape');
    taken++;
  }
  console.log(`ui-shots: ${taken} pictures in docs/developers/ui/img`);
} finally {
  await browser.close();
  await server.close();
}
