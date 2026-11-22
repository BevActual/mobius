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
    panel: panel ? { blur: getComputedStyle(panel).backdropFilter, shadow: getComputedStyle(panel).boxShadow } : null,
    toolbar: { blur: getComputedStyle(toolbar).backdropFilter, shadow: getComputedStyle(toolbar).boxShadow },
  };
});

test('no glass anywhere: Mobius beside the page is a panel on the frame, the toolbar is flat, whatever the system asks', async () => {
  mobius = await launch(fixture.origin + '/');
  const shell = mobius.shell;
  await expect(shell.locator('.dock.right:not([data-floating]) > .chat')).toBeAttached({ timeout: 15_000 });
  const check = async (why: string) => {
    const got = await looks(shell);
    expect(got.panel?.blur, `panel, ${why}`).toBe('none');
    // Panels on the frame (docs/design/panel-look.md): a light along the top edge, the panel's own.
    expect(got.panel?.shadow, `panel, ${why}`).toContain('inset');
    expect(`${got.toolbar.blur} ${got.toolbar.shadow}`, `toolbar, ${why}`).toBe('none none');
  };
  await check('as it starts');
  const cdp = await shell.context().newCDPSession(shell);
  for (const feature of [{ name: 'prefers-reduced-transparency', value: 'reduce' }, { name: 'prefers-contrast', value: 'more' }]) {
    await cdp.send('Emulation.setEmulatedMedia', { features: [feature] });
    await check(feature.name);
  }
  // Panels on the frame off: everything flush again, with no shadow.
  await shell.evaluate(() => { document.documentElement.dataset.panels = 'flat'; });
  const flat = await looks(shell);
  expect(`${flat.panel?.blur} ${flat.panel?.shadow}`).toBe('none none');
});

test('corners are small and plain: a selected sidebar row has the control radius', async () => {
  mobius = await launch(fixture.origin + '/');
  const shell = mobius.shell;
  await shell.keyboard.press('Control+k');
  await shell.getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Search');
  await shell.keyboard.press('Enter');
  const radii = await shell.evaluate(() => {
    const expected = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--radius-control'));
    const row = document.querySelector(':is(.dock.left, .ui-dock[data-dock="left"]) [aria-current="page"].list-row');
    return { expected, row: row ? parseFloat(getComputedStyle(row).borderTopLeftRadius) : -1 };
  });
  expect(radii.expected).toBe(6);
  expect(radii.row).toBe(radii.expected);
});
