import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, openSettings, removeTestData, resizeWindow, startFixture } from './harness';
import { startModel } from './model-fixture';

// Pictures of every app, light and dark, for looking over in CI (the screens-N artifacts). No pixel checks: this only
// fails when an app does not open. Saved to apps/desktop/screens/NAME-light.png and NAME-dark.png.
const OUT = path.resolve(process.cwd(), 'screens');

/** Every app the launcher opens, as [its name, its id]. */
const APPS: Array<[string, string]> = [
  ['Browser', 'browser'], ['Agent', 'agent'], ['Mail', 'mail'], ['Notes', 'notes'], ['Docs', 'docs'], ['Projects', 'projects'],
  ['Knowledge', 'wiki'], ['Sheets', 'sheets'], ['Slides', 'slides'], ['Tasks', 'tasks'], ['Database', 'database'], ['Calendar', 'calendar'],
  ['Search', 'search'], ['Research', 'research'], ['Reader', 'reader'], ['Design', 'design'], ['Photo', 'photo'], ['Music', 'studio'],
  ['Video', 'video'], ['Code', 'code'], ['Terminal', 'terminal'], ['Canvas', 'canvas'], ['Files', 'files'], ['Review', 'review'], ['Views', 'views'],
];

const SONG = { version: 1, tempo: 112, key: 'A minor', bars: 4, tracks: [{ id: 't1', name: 'Keys', instrument: 'piano', volume: 0.8, notes: [57, 60, 64, 67].map((pitch, i) => ({ pitch, start: i * 2, length: 2, velocity: 0.7 })) }] };

/** A little of everything, so the pictures show apps in use rather than only their empty states. */
function seed(userData: string): void {
  const write = (rel: string, content: string) => { const f = path.join(userData, 'workspace', rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };
  write('notes/Home/Garden.md', '# Garden\n\nPlant the tulips before the frost.\n\n- Order bulbs\n- Clear the beds\n');
  write('notes/Work/Launch plan.md', '# Launch plan\n\nShip the beta on Friday, then gather feedback for a week.\n');
  write('docs/Work/Quarterly review.md', '# Quarterly review\n\n## Highlights\n\nRevenue grew 12% and churn fell.\n\n## Next\n\nHire two engineers.\n');
  write('slides/Talks/Kickoff.md', '## Kickoff\n\nWhy we are here\n\n---\n\n## Plan\n\n- Research\n- Build\n- Ship\n');
  write('tasks/Inbox.md', '# Inbox\n\n- [ ] Buy tulip bulbs\n- [ ] Call the bank\n- [x] Book the terrace\n');
  write('studio/Songs/Night Drive.json', JSON.stringify(SONG));
  write('views/Views/Today.json', JSON.stringify({ version: 1, tiles: [{ id: 't1', kind: 'mobius', size: 'wide' }, { id: 't2', kind: 'tasks', size: 'small', show: 'all' }, { id: 't3', kind: 'calendar', size: 'small', show: 'week' }, { id: 't4', kind: 'notes', size: 'small' }, { id: 't5', kind: 'next', size: 'small' }] }));
}

/** Fonts loaded, nothing still loading, and a moment for layout and motion to finish. */
async function settle(shell: Page): Promise<void> {
  await shell.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(shell.locator('[aria-busy="true"], .spinner, [data-loading="true"]')).toHaveCount(0, { timeout: 5000 }).catch(() => undefined);
  await shell.waitForTimeout(350);
}

async function both(shell: Page, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await shell.emulateMedia({ colorScheme: scheme });
    await settle(shell);
    await shell.screenshot({ path: path.join(OUT, `${name}-${scheme}.png`) });
  }
  await shell.emulateMedia({ colorScheme: 'light' });
}

test('screens: every app, Home, Settings and the Mobius panel, light and dark', async () => {
  test.setTimeout(240_000);
  fs.mkdirSync(OUT, { recursive: true });
  const fixture = await startFixture();
  const model = await startModel([]);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-screens-'));
  seed(userData);
  const mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'chat-model' } });
  const shell = mobius.shell;
  try {
    await resizeWindow(mobius.app, 1440, 900);
    await expect(shell.getByRole('textbox', { name: 'Message Mobius' }).first()).toBeEnabled({ timeout: 15_000 });
    const open = async (name: string, id: string) => {
      await shell.keyboard.press('Control+k');
      await shell.getByRole('combobox', { name: 'Find apps, pages and commands' }).fill(name);
      await shell.keyboard.press('Enter');
      await expect(shell.locator('.app'), `${name} opens`).toHaveAttribute('data-app', id);
    };
    // Every app, with Mobius pinned beside it.
    for (const [name, id] of APPS) {
      await open(name, id);
      await both(shell, id === 'agent' ? 'agent' : name.toLowerCase());
    }
    // Home: the Agent app's desk, with something scheduled next.
    await shell.evaluate(() => window.mobius.schedules?.add({ title: 'Morning brief', prompt: 'What is on today?', time: '08:00', days: [1, 2, 3, 4, 5, 6, 7], enabled: true }));
    await open('Agent', 'agent');
    await expect(shell.getByRole('region', { name: 'Desk' }).getByRole('group', { name: 'Next' })).toBeVisible();
    await both(shell, 'home');
    // The start page of a new tab.
    await open('Browser', 'browser');
    await shell.getByRole('button', { name: 'New tab' }).click();
    await expect(shell.getByRole('region', { name: 'New tab' })).toBeVisible();
    await both(shell, 'new-tab');
    // Settings.
    await openSettings(shell);
    await both(shell, 'settings');
    await openSettings(shell);
    // The Mobius panel beside a page, on the right.
    await open('Docs', 'docs');
    await expect(shell.locator('.dock.right > .chat')).toBeVisible();
    await both(shell, 'mobius-beside');
  } finally {
    await mobius.close();
    await model.close();
    await fixture.close();
    removeTestData(userData);
  }
});
