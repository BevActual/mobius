import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, resizeWindow, startFixture } from './harness';
import { callsTool, says, startModel } from './model-fixture';

// Not a test: pictures of the current app for design review. Run with MOBIUS_SHOTS=1 and MOBIUS_SHOTS_DIR=<folder>.
test.skip(process.env.MOBIUS_SHOTS !== '1', 'screenshots are only taken on request');
const out = process.env.MOBIUS_SHOTS_DIR ?? path.resolve(import.meta.dirname, '../../../docs/review');

for (const scheme of ['light', 'dark'] as const) {
  test(`review pictures, ${scheme}`, async () => {
    fs.mkdirSync(out, { recursive: true });
    const fixture = await startFixture();
    const model = await startModel([callsTool('browser-tabs'), says(['You have one tab open, the fixture home page.'])]);
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-shots-'));
    const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-shots-dl-'));
    const mobius = await launch(fixture.origin + '/icon', { userData, env: { MOBIUS_DOWNLOADS_DIR: dl, MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'qwen3.5-9b' } });
    const shell = mobius.shell;
    const shot = async (name: string) => shell.screenshot({ path: path.join(out, `${name}-${scheme}.png`) });
    try {
      await resizeWindow(mobius.app, 1360, 840);
      await shell.emulateMedia({ colorScheme: scheme });
      const composer = shell.getByRole('textbox', { name: 'Message Mobius' });
      await expect(composer).toBeEnabled({ timeout: 15_000 });
      await shell.getByRole('button', { name: 'Bookmark this page' }).click();
      const address = shell.getByRole('textbox', { name: 'Address or question' });
      await address.fill(fixture.origin + '/file.txt');
      await address.press('Enter');
      await expect(shell.getByRole('region', { name: 'Downloads' })).toContainText('Done');
      await address.fill(fixture.origin + '/second');
      await address.press('Enter');
      await composer.fill('What tabs are open?');
      await composer.press('Enter');
      await shell.getByRole('group', { name: /Approval needed/ }).getByRole('button', { name: 'Allow once' }).click();
      await expect(shell.locator('.msg.assistant').last()).toContainText('one tab');
      await shell.getByRole('button', { name: /Show details of/ }).click();
      await shell.waitForTimeout(400);
      await shot('1-browser');
      await shell.getByRole('button', { name: /^Applications/ }).click();
      await shell.waitForTimeout(300);
      await shot('2-launcher');
      await shell.getByRole('dialog').getByText('Agent', { exact: true }).first().click();
      await shell.waitForTimeout(400);
      await shot('3-assistant');
      await shell.getByRole('button', { name: 'Settings', exact: true }).click();
      const page = shell.getByRole('region', { name: 'Settings' });
      await shell.waitForTimeout(800);
      await shot('3b-settings-opened');
      const nav = page.getByRole('navigation', { name: 'Settings sections' });
      const visit = async (section: string, tab: string | null, name: string) => {
        await nav.getByRole('button', { name: section, exact: true }).click();
        if (tab) await page.getByRole('tab', { name: tab, exact: true }).click();
        await shell.waitForTimeout(500);
        await shot(name);
      };
      await visit('Appearance', null, '4-settings-appearance');
      await visit('Model', null, '5-settings-model');
      await visit('Model', 'This computer', '6-settings-local-models').catch(() => undefined);
      await visit('Safety', null, '7-settings-safety');
      await visit('Browser', 'History', '8-settings-history');
      await visit('Browser', 'Bookmarks', '9-settings-bookmarks');
    } finally {
      await mobius.close();
      await model.close();
      await fixture.close();
      fs.rmSync(userData, { recursive: true, force: true });
      fs.rmSync(dl, { recursive: true, force: true });
    }
  });
}
