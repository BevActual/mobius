// Renders the README banner (docs/readme/banner-light.png and banner-dark.png) from banner.html, at 2x.
// Run from the repository root: `node docs/readme/source/render.mjs`. CHROMIUM_PATH points at another Chromium if needed.
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(resolve(here, '../../../apps/desktop/package.json'))('@playwright/test');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 280 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(resolve(here, 'banner.html')).href);
  await page.evaluate(() => document.fonts.ready);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => { document.body.className = t; }, theme);
    await page.screenshot({ path: resolve(here, `../banner-${theme}.png`) });
  }
  console.log('banner: docs/readme/banner-light.png and banner-dark.png');
} finally {
  await browser.close();
}
