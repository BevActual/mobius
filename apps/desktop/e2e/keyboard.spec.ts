import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, quickEntry, startFixture, takeGlobalShortcut, type Fixture, type Launched, removeTestData, openSettings } from './harness';
import { startModel, type ModelFixture } from './model-fixture';

let fixture: Fixture;
let mobius: Launched | undefined;
let userData: string;
let model: ModelFixture | undefined;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-keys-'));
  model = await startModel([]);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  await fixture.close();
  removeTestData(userData);
});

const shell = () => mobius!.shell;
const launcher = (): Locator => shell().getByRole('combobox', { name: 'Find apps, pages and commands' });
const page = (): Locator => shell().getByRole('region', { name: 'Settings' });
const keys = (action: string): Locator => page().getByTestId(`keys-${action}`);
const openKeyboard = async () => {
  await openSettings(shell());
  await expect(page()).toBeVisible();
  await shell().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Keyboard', exact: true }).click();
};
const prefs = () => shell().evaluate(() => window.mobius.preferences.get());
const hook = async <T>(fn: (h: { quickEntry: { press(): void; active(): boolean } }) => T): Promise<T> => {
  const quick = quickEntry(mobius!.app);
  // The test names what it wants to do; both shells do it their own way.
  const source = fn.toString();
  if (source.includes('.press()')) return (await quick.press()) as T;
  return (await quick.active()) as T;
};

test('the usual keys work, and the settings page lists them', async () => {
  await shell().keyboard.press('Control+k');
  await expect(launcher()).toBeVisible();
  await shell().keyboard.press('Escape');
  await openKeyboard();
  await expect(keys('launcher')).toHaveText('Ctrl+K');
  await expect(keys('settings')).toHaveText('Ctrl+,');
  await expect(keys('quickEntry')).toHaveText('Not set');
  await expect(keys('holdToTalk')).toHaveText('Ctrl+Space');
});

test('a shortcut can be changed, the old keys stop working, and it can be put back', async () => {
  await openKeyboard();
  await page().getByRole('button', { name: 'Change Find apps, pages and commands' }).click();
  await shell().keyboard.press('Control+j');
  await expect(keys('launcher')).toHaveText('Ctrl+J');
  expect((await prefs()).keybindings.launcher).toBe('mod+j');
  await shell().keyboard.press('Escape');
  await shell().keyboard.press('Control+k');
  await expect(launcher()).toHaveCount(0);
  await shell().keyboard.press('Control+j');
  await expect(launcher()).toBeVisible();
  await shell().keyboard.press('Escape');
  await openKeyboard();
  await page().getByRole('button', { name: 'Reset Find apps, pages and commands' }).click();
  await expect(keys('launcher')).toHaveText('Ctrl+K');
  expect((await prefs()).keybindings.launcher).toBe('mod+k');
});

test('pressing keys while choosing does not run them, and Escape cancels', async () => {
  await openKeyboard();
  await page().getByRole('button', { name: 'Change Open a new tab' }).click();
  const before = (await shell().evaluate(() => window.mobius.browser.getState())).tabs.length;
  await shell().keyboard.press('Control+k');
  await expect(launcher()).toHaveCount(0);
  await expect(keys('newTab')).toHaveText('Ctrl+T');
  await shell().keyboard.press('Control+k');
  await expect(page().getByRole('alert')).toContainText('Already used');
  await shell().keyboard.press('Escape');
  await expect(page()).toBeVisible();
  await expect(page().getByRole('button', { name: 'Change Open a new tab' })).toHaveText('Change');
  expect((await shell().evaluate(() => window.mobius.browser.getState())).tabs.length).toBe(before);
  expect((await prefs()).keybindings.newTab).toBe('mod+t');
});

test('keys that would get in the way are refused with a reason', async () => {
  await openKeyboard();
  await page().getByRole('button', { name: 'Change Open settings' }).click();
  await shell().keyboard.press('Control+c');
  await expect(page().getByRole('alert')).toContainText('copy, paste and undo');
  await shell().keyboard.press('x');
  await expect(page().getByRole('alert')).toContainText('Ctrl');
  await shell().keyboard.press('Escape');
  expect((await prefs()).keybindings.settings).toBe('mod+,');
});

test('a shortcut can be cleared, and a clash is refused by the window as well', async () => {
  await openKeyboard();
  await page().getByRole('button', { name: 'Clear Close the current tab' }).click();
  await expect(keys('closeTab')).toHaveText('Not set');
  expect((await prefs()).keybindings.closeTab).toBe('');
  const refused = await shell().evaluate(async () => {
    const current = await window.mobius.preferences.get();
    const next = await window.mobius.preferences.set({ keybindings: { ...current.keybindings, find: 'mod+k' } });
    return next?.keybindings.find;
  });
  expect(refused).toBe('mod+f');
});

test('the choices survive a restart', async () => {
  await openKeyboard();
  await page().getByRole('button', { name: 'Change Open settings' }).click();
  await shell().keyboard.press('Control+Alt+s');
  await expect(keys('settings')).toHaveText('Ctrl+Alt+S');
  await mobius!.close({ keepUserData: true });
  mobius = await launch(fixture.origin + '/', { userData });
  await expect.poll(async () => (await prefs()).keybindings.settings).toBe('mod+alt+s');
  await shell().keyboard.press('Control+Alt+s');
  await expect(page()).toBeVisible();
});

test('quick entry is off until chosen, then it is registered with the system and can bring up a message', async () => {
  expect(await hook((h) => h.quickEntry.active())).toBe(false);
  await openKeyboard();
  await expect(page().getByTestId('quick-entry-working')).toHaveCount(0);
  await page().getByRole('button', { name: 'Change Bring Mobius up and start a message, from anywhere' }).click();
  await shell().keyboard.press('Control+Alt+Space');
  await expect(keys('quickEntry')).toHaveText('Ctrl+Alt+Space');
  await expect(page().getByTestId('quick-entry-working')).toBeVisible();
  await expect.poll(() => hook((h) => h.quickEntry.active())).toBe(true);
  await hook((h) => h.quickEntry.press());
  await expect(page()).toHaveCount(0);
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeFocused();
  await openKeyboard();
  await page().getByRole('button', { name: 'Clear Bring Mobius up and start a message, from anywhere' }).click();
  await expect(keys('quickEntry')).toHaveText('Not set');
  await expect.poll(() => hook((h) => h.quickEntry.active())).toBe(false);
});

test('a global shortcut another program already has is reported, not hidden', async () => {
  await takeGlobalShortcut(mobius!.app, 'CommandOrControl+Alt+J');
  await openKeyboard();
  await page().getByRole('button', { name: 'Change Bring Mobius up and start a message, from anywhere' }).click();
  await shell().keyboard.press('Control+Alt+j');
  await expect(keys('quickEntry')).toHaveText('Ctrl+Alt+J');
  await expect(page().getByTestId('quick-entry-taken')).toBeVisible();
  expect(await hook((h) => h.quickEntry.active())).toBe(false);
});
