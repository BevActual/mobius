import { expect, test, type Page } from '@playwright/test';
import { launch, openSettings, startFixture, type Fixture, type Launched } from './harness';
import { startModel, type ModelFixture } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture;
let mobius: Launched | undefined;
test.beforeEach(async () => {
  fixture = await startFixture();
  model = await startModel([]);
  mobius = await launch(fixture.origin + '/', { env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'chat-model' } });
  await expect(mobius.shell.getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  // The test window is hidden, where nothing animates; this one is watched, so motion runs as it does on screen.
  await mobius.shell.evaluate(() => document.documentElement.setAttribute('data-motion-always', ''));
});
test.afterEach(async () => { await mobius?.close(); mobius = undefined; await model.close(); await fixture.close(); });

/** The animations running on the composer's model menu: their keyframes' properties and length. */
const menuMotion = (shell: Page) => shell.evaluate(() => document.querySelector('.popmenu-list')?.getAnimations().map((a) => {
  const effect = a.effect as KeyframeEffect;
  const frames = effect.getKeyframes();
  return { props: [...new Set(frames.flatMap((f) => Object.keys(f).filter((k) => !['offset', 'computedOffset', 'easing', 'composite'].includes(k))))].sort(), duration: effect.getTiming().duration, last: frames.at(-1) };
}) ?? null);

test('a menu grows out of its button and goes back into it when it closes', async () => {
  const shell = mobius!.shell;
  await shell.getByRole('button', { name: 'Model' }).click();
  const opening = await menuMotion(shell);
  expect(opening?.some((a) => a.props.includes('transform') && a.props.includes('opacity'))).toBe(true);
  await shell.keyboard.press('Escape');
  // Still there for a moment, on its way out: shrinking and fading toward the button, quicker than it came.
  const leaving = await menuMotion(shell);
  expect(leaving?.some((a) => a.duration === 150 && a.last?.opacity === '0' || a.last?.opacity === 0)).toBe(true);
  await expect(shell.locator('.popmenu-list')).toHaveCount(0);
});

test('with Reduce Motion a menu fades, rather than moving or not animating at all', async () => {
  const shell = mobius!.shell;
  await shell.emulateMedia({ reducedMotion: 'reduce' });
  await shell.getByRole('button', { name: 'Model' }).click();
  const opening = await menuMotion(shell);
  expect(opening).toEqual([expect.objectContaining({ props: ['opacity'], duration: 150 })]);
  // And nothing repeats: the mark that moves while Mobius works stands still.
  expect(await shell.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dur-loop').trim())).toMatch(/^0m?s$/);
});

test('the message box says what it would ask about in the app that is showing, Settings included', async () => {
  const shell = mobius!.shell;
  const ask = shell.getByRole('complementary', { name: 'Agent', exact: true }).getByRole('textbox', { name: 'Message Mobius' });
  const open = async (name: string) => {
    await shell.keyboard.press('Control+k');
    await shell.getByRole('combobox', { name: 'Find apps, pages and commands' }).fill(name);
    await shell.keyboard.press('Enter');
  };
  await open('Calendar');
  await expect(ask).toHaveAttribute('placeholder', 'Ask about your calendar');
  await openSettings(shell);
  await expect(ask).toHaveAttribute('placeholder', 'Ask about settings');
  await openSettings(shell);
  await open('Mail');
  await expect(ask).toHaveAttribute('placeholder', 'Ask about your mail');
});

test('a field shows one soft focus ring: never a ring inside a ring', async () => {
  const shell = mobius!.shell;
  const rings = (selector: string) => shell.evaluate((s) => {
    const field = document.querySelector<HTMLElement>(s)!;
    const box = field.closest('.search-box, .hub-search') as HTMLElement | null;
    const ring = (el: HTMLElement) => { const st = getComputedStyle(el); return (st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) > 0 ? 1 : 0) + (st.boxShadow !== 'none' && /0px 0px 0px [1-9]/.test(st.boxShadow) ? 1 : 0); };
    return ring(field) + (box ? ring(box) : 0);
  }, selector);
  // Settings' search field, reached from the keyboard.
  await openSettings(shell);
  await shell.keyboard.press('Shift');
  await shell.getByRole('searchbox', { name: 'Search settings' }).focus();
  expect(await rings('input[aria-label="Search settings"]')).toBe(1);
  await openSettings(shell);
});
