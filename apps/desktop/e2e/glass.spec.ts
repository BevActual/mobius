import { expect, test, type Page } from '@playwright/test';
import { launch, startFixture, type Fixture, type Launched } from './harness';

let fixture: Fixture;
let mobius: Launched | undefined;
test.beforeEach(async () => { fixture = await startFixture(); });
test.afterEach(async () => { await mobius?.close(); mobius = undefined; await fixture.close(); });

/** The blur of the floating sidebar's card and of Mobius beside the page, as drawn now. */
const blurs = (shell: Page) => shell.evaluate(() => {
  const rail = document.querySelector('.rail[data-expanded]');
  const panel = document.querySelector('.dock.right:not([data-floating]) > .chat');
  return {
    sidebar: rail ? getComputedStyle(rail, '::before').backdropFilter : 'missing',
    panel: panel ? getComputedStyle(panel).backdropFilter : 'missing',
    toolbar: getComputedStyle(document.querySelector('.strip-right')!).backdropFilter,
  };
});

test('the sidebar, Mobius beside the page and the toolbar are glass, and turn solid when the system asks for less transparency', async () => {
  mobius = await launch(fixture.origin + '/');
  const shell = mobius.shell;
  await expect(shell.locator('.rail[data-expanded]')).toBeAttached({ timeout: 15_000 });
  // Mobius beside the page can mount a moment after the sidebar; wait for it too.
  await expect(shell.locator('.dock.right:not([data-floating]) > .chat')).toBeAttached({ timeout: 15_000 });
  const glass = await blurs(shell);
  for (const [where, filter] of Object.entries(glass)) expect(filter, where).toContain('blur(24px)');
  // Reduce Transparency, as the system says it.
  const cdp = await shell.context().newCDPSession(shell);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  for (const [where, filter] of Object.entries(await blurs(shell))) expect(filter, where).toBe('none');
  // Increase Contrast does the same.
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-contrast', value: 'more' }] });
  for (const [where, filter] of Object.entries(await blurs(shell))) expect(filter, where).toBe('none');
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  expect((await blurs(shell)).panel).toContain('blur(24px)');
});

test('with Windows transparency effects off (as the shell reads them), glass is solid from the start', async () => {
  mobius = await launch(fixture.origin + '/', { env: { MOBIUS_REDUCE_TRANSPARENCY: '1' } });
  const shell = mobius.shell;
  await expect(shell.locator('html[data-transparency="reduced"]')).toBeAttached({ timeout: 15_000 });
  for (const [where, filter] of Object.entries(await blurs(shell))) expect(filter, where).toBe('none');
});

test('corners are concentric: a selected row and the search field inside the sidebar card follow its corner, less its inset', async () => {
  mobius = await launch(fixture.origin + '/');
  const shell = mobius.shell;
  await shell.keyboard.press('Control+k');
  await shell.getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Search');
  await shell.keyboard.press('Enter');
  const radii = await shell.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const card = parseFloat(css.getPropertyValue('--panel-radius'));
    const inset = parseFloat(css.getPropertyValue('--panel-inset'));
    const row = document.querySelector('.rail-app [aria-current="page"].list-row, .dock.left [aria-current="page"].list-row');
    return { expected: card - inset, row: row ? parseFloat(getComputedStyle(row).borderTopLeftRadius) : -1 };
  });
  expect(radii.row).toBe(radii.expected);
});
