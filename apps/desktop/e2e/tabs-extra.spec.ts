import { expect, test } from '@playwright/test';
import { launch, startFixture, type Fixture, type Launched } from './harness';


let fixture: Fixture;
let mobius: Launched | undefined;
test.beforeEach(async () => {
  fixture = await startFixture();
  mobius = await launch(fixture.origin + '/');
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await fixture.close();
});

const shell = () => mobius!.shell;
const titles = () => shell().locator('.tab-title');
const openIn = async (path: string) => {
  await expect(titles().first()).toBeVisible();
  const before = await titles().count();
  await shell().getByRole('button', { name: 'New tab' }).click();
  await expect(titles()).toHaveCount(before + 1);
  await expect(shell().getByRole('textbox', { name: 'Address or question' })).toHaveValue('');
  const address = shell().getByRole('textbox', { name: 'Address or question' });
  await address.fill(fixture.origin + path);
  await address.press('Enter');
};

test('a tab can be pinned to the front, and unpinned', async () => {
  await openIn('/second');
  await expect(titles()).toHaveText(['Fixture home', 'Second page']);
  await shell().getByRole('button', { name: 'Pin Second page' }).click();
  await expect(titles()).toHaveText(['Second page', 'Fixture home']);
  await expect(shell().getByRole('button', { name: 'Unpin Second page' })).toHaveAttribute('aria-pressed', 'true');
  await shell().getByRole('button', { name: 'Unpin Second page' }).click();
  await expect(shell().getByRole('button', { name: 'Pin Second page' })).toHaveAttribute('aria-pressed', 'false');
});

test('a tab can be duplicated and a closed one brought back', async () => {
  await shell().getByRole('button', { name: 'Duplicate Fixture home' }).click();
  await expect(titles()).toHaveText(['Fixture home', 'Fixture home']);
  await openIn('/second');
  await expect(titles()).toHaveText(['Fixture home', 'Fixture home', 'Second page']);
  await shell().getByRole('button', { name: 'Close Second page' }).click();
  await expect(titles()).toHaveCount(2);
  await shell().getByRole('button', { name: 'Reopen closed tab' }).click();
  await expect(titles()).toHaveText(['Fixture home', 'Fixture home', 'Second page']);
});
