import { expect, test, type Page } from '@playwright/test';
import { launch, startFixture, type Fixture, type Launched } from './harness';

let fixture: Fixture;
let mobius: Launched | undefined;
test.beforeEach(async () => { fixture = await startFixture(); });
test.afterEach(async () => { await mobius?.close(); mobius = undefined; await fixture.close(); });

/** How Mobius beside the page and the toolbar are drawn now: their blur and their shadow. */
const looks = (shell: Page) => shell.evaluate(() => {
  const panel = document.querySelector('.dock.right:not([data-floating]) > .chat');
  const toolbar = document.querySelector('.strip-right')!;
  return {
    panel: panel ? `${getComputedStyle(panel).backdropFilter} ${getComputedStyle(panel).boxShadow}` : 'missing',
    toolbar: `${getComputedStyle(toolbar).backdropFilter} ${getComputedStyle(toolbar).boxShadow}`,
  };
});

test('the frame is flat: Mobius beside the page and the toolbar have no glass and no shadow, whatever the system asks', async () => {
  mobius = await launch(fixture.origin + '/');
  const shell = mobius.shell;
  await expect(shell.locator('.dock.right:not([data-floating]) > .chat')).toBeAttached({ timeout: 15_000 });
  for (const [where, look] of Object.entries(await looks(shell))) expect(look, where).toBe('none none');
  const cdp = await shell.context().newCDPSession(shell);
  for (const feature of [{ name: 'prefers-reduced-transparency', value: 'reduce' }, { name: 'prefers-contrast', value: 'more' }]) {
    await cdp.send('Emulation.setEmulatedMedia', { features: [feature] });
    for (const [where, look] of Object.entries(await looks(shell))) expect(look, `${where}, ${feature.name}`).toBe('none none');
  }
});

test('corners are small and plain: a selected sidebar row has the control radius', async () => {
  mobius = await launch(fixture.origin + '/');
  const shell = mobius.shell;
  await shell.keyboard.press('Control+k');
  await shell.getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Search');
  await shell.keyboard.press('Enter');
  const radii = await shell.evaluate(() => {
    const expected = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--radius-control'));
    const row = document.querySelector('.rail-app [aria-current="page"].list-row, .dock.left [aria-current="page"].list-row');
    return { expected, row: row ? parseFloat(getComputedStyle(row).borderTopLeftRadius) : -1 };
  });
  expect(radii.expected).toBe(6);
  expect(radii.row).toBe(radii.expected);
});
