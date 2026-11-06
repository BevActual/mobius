import { expect, test } from '@playwright/test';
import { launch, startFixture, type Fixture, type Launched } from './harness';

let fixture: Fixture;
let mobius: Launched | undefined;
test.beforeEach(async () => {
  fixture = await startFixture();
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await fixture.close();
});

const bar = () => mobius!.shell.getByRole('search', { name: 'Find in page' });
const box = () => mobius!.shell.getByRole('textbox', { name: 'Find in page' });
const count = () => bar().getByRole('status');
async function open(path: string): Promise<Launched> {
  const app = await launch(fixture.origin + path);
  // The shortcuts are attached once the window has drawn itself.
  await expect(app.shell.getByRole('textbox', { name: 'Address or question' })).toBeVisible();
  await expect.poll(() => app.shell.evaluate(() => document.readyState)).toBe('complete');
  return app;
}

test('Ctrl+F opens a find bar, counts matches without caring about case, steps through them, and Escape clears it', async () => {
  mobius = await open('/find');
  await mobius.shell.keyboard.press('Control+f');
  await expect(box()).toBeFocused();
  await box().fill('apple');
  await expect(count()).toHaveText('1 of 3');
  await box().press('Enter');
  await expect(count()).toHaveText('2 of 3');
  await box().press('Enter');
  await expect(count()).toHaveText('3 of 3');
  await box().press('Enter');
  await expect(count()).toHaveText('1 of 3');
  await box().press('Shift+Enter');
  await expect(count()).toHaveText('3 of 3');
  await box().fill('zebra');
  await expect(count()).toHaveText('No matches');
  await expect(bar().getByRole('button', { name: 'Next match' })).toBeDisabled();
  await box().fill('banana');
  await expect(count()).toHaveText('1 of 1');
  await box().press('Escape');
  await expect(bar()).toHaveCount(0);
});

test('the buttons step through matches and the bar closes with its button', async () => {
  mobius = await open('/find');
  await mobius.shell.keyboard.press('Control+f');
  await box().fill('apple');
  await expect(count()).toHaveText('1 of 3');
  await bar().getByRole('button', { name: 'Next match' }).click();
  await expect(count()).toHaveText('2 of 3');
  await bar().getByRole('button', { name: 'Previous match' }).click();
  await expect(count()).toHaveText('1 of 3');
  await bar().getByRole('button', { name: 'Close find' }).click();
  await expect(bar()).toHaveCount(0);
});

test('find is not offered in the Agent app', async () => {
  mobius = await open('/find');
  await mobius.shell.keyboard.press('Control+k');
  await mobius.shell.getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Agent');
  await mobius.shell.keyboard.press('Enter');
  await mobius.shell.keyboard.press('Control+f');
  await expect(bar()).toHaveCount(0);
});
