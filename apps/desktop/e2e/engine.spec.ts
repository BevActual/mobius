import { expect, test, type Locator } from '@playwright/test';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, openSettings } from './harness';
import { startGithub, type GithubFixture } from './github-fixture';

test.skip(process.env.MOBIUS_SHELL !== 'tauri' || process.platform !== 'win32', 'Mobius installs its own engine on Windows in the Tauri shell');

const FAKE_LLAMA = path.resolve(import.meta.dirname, '../../../target/debug/mobius-fake-llama.exe');

let fixture: Fixture;
let github: GithubFixture | undefined;
let mobius: Launched | undefined;
test.beforeEach(async () => { fixture = await startFixture(); });
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await github?.close();
  github = undefined;
  await fixture.close();
});

const page = (): Locator => mobius!.shell.getByRole('region', { name: 'Settings' });

async function openThisComputer(): Promise<Locator> {
  await openSettings(mobius!.shell);
  await page().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Models', exact: true }).click();
  await page().getByRole('tab', { name: 'This computer', exact: true }).click();
  return page().locator('[data-setting="model.local.engine"]');
}

test('Mobius installs its own llama.cpp for this computer, shows what it found, and needs nothing else', async () => {
  github = await startGithub(FAKE_LLAMA, 'b600', 300);
  mobius = await launch(fixture.origin + '/', { openMobius: true, env: { MOBIUS_TEST_ENGINE_RELEASES: github.releasesUrl } });
  const row = await openThisComputer();
  await expect(row).toContainText('Not installed');
  await row.getByRole('button', { name: /^Install llama\.cpp/ }).click();
  await expect(row.getByRole('progressbar')).toBeVisible();
  await expect(row).toContainText('llama.cpp b600', { timeout: 30_000 });
  await expect(row).toContainText('Fake GPU');
  await expect(row.getByRole('progressbar')).toHaveCount(0);
  // Models can be run now: the "not found" message is gone.
  await expect(page()).not.toContainText('No engine yet');
  expect(github.downloads.some((d) => d.startsWith('llama-b600-bin-win-'))).toBe(true);
  // Checking again downloads nothing.
  const before = github.downloads.length;
  await row.getByRole('button', { name: 'Check for an update' }).click();
  await expect(row).toContainText('Up to date');
  expect(github.downloads.length).toBe(before);
});
