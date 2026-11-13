import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, resizeWindow, startFixture, removeTestData, openSettings } from './harness';
import { callsTool, says, startModel } from './model-fixture';

// Not a test: pictures of the current app for design review. Run with MOBIUS_SHOTS=1 and MOBIUS_SHOTS_DIR=<folder>.
test.skip(process.env.MOBIUS_SHOTS !== '1', 'screenshots are only taken on request');
const out = process.env.MOBIUS_SHOTS_DIR ?? path.resolve(import.meta.dirname, '../../../docs/review');

for (const scheme of ['light', 'dark'] as const) {
  test(`review pictures, ${scheme}`, async () => {
    test.setTimeout(180_000);
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
      await expect(shell.getByRole('status', { name: 'Agent activity' })).toBeVisible();
      await shell.waitForTimeout(300);
      await shot('1a-agent-waiting');
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
      // Tasks, with a few tasks in two lists.
      const tasksDir = path.join(userData, 'workspace', 'tasks');
      fs.mkdirSync(tasksDir, { recursive: true });
      const d = new Date();
      const day = (n: number) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
      fs.writeFileSync(path.join(tasksDir, 'Inbox.md'), `# Inbox\n\n- [ ] Call the plumber (due ${day(0)})\n- [ ] Renew the passport (due ${day(-2)})\n- [ ] Book flights for the trip (due ${day(3)})\n- [ ] Read the onboarding guide\n- [x] Pay the electricity bill\n`);
      fs.writeFileSync(path.join(tasksDir, 'Work.md'), `# Work\n\n- [ ] Send the quarterly report (due ${day(0)})\n- [ ] Review the design notes\n`);
      await shell.keyboard.press('Control+k');
      await shell.getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Tasks');
      await shell.keyboard.press('Enter');
      await shell.getByRole('navigation', { name: 'Lists' }).getByRole('button', { name: /^Inbox/ }).click();
      await shell.waitForTimeout(500);
      await shell.locator('.tasks-page .task').nth(1).hover();
      await shot('3c-tasks');
      await shell.getByRole('navigation', { name: 'Lists' }).getByRole('button', { name: /^Today/ }).click();
      await shell.waitForTimeout(400);
      await shot('3d-tasks-today');
      await shell.getByRole('navigation', { name: 'Apps' }).getByRole('button', { name: 'Search', exact: true }).click();
      await shell.waitForTimeout(400);
      await shot('3e-search');
      await shell.getByRole('searchbox', { name: 'Search everything' }).fill('the');
      await shell.waitForTimeout(500);
      await shot('3f-search-results');
      await shell.getByRole('navigation', { name: 'Apps' }).getByRole('button', { name: 'Tasks', exact: true }).click();
      await shell.waitForTimeout(500);
      await shot('3g-sidebar-tasks');
      await shell.getByRole('navigation', { name: 'Apps' }).getByRole('button', { name: 'Browser', exact: true }).click();
      await shell.waitForTimeout(400);
      await shot('3h-sidebar-browser');
      await shell.getByRole('button', { name: 'Show tabs' }).click();
      await shell.waitForTimeout(400);
      await shot('3i-rail-browser');
      await shell.getByRole('button', { name: 'Show tabs' }).click();
      await shell.keyboard.press('Control+k');
      await shell.getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Agent');
      await shell.keyboard.press('Enter');
      await shell.waitForTimeout(300);
      await openSettings(shell);
      const page = shell.getByRole('region', { name: 'Settings' });
      await shell.waitForTimeout(800);
      await shot('3b-settings-opened');
      const nav = shell.getByRole('navigation', { name: 'Settings sections' });
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
      removeTestData(userData);
      fs.rmSync(dl, { recursive: true, force: true });
    }
  });
}
