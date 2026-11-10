import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { launch, startFixture, type Fixture, type Launched } from './harness';


let fixture: Fixture;
let mobius: Launched | undefined;
test.beforeEach(async () => {
  fixture = await startFixture();
  mobius = await launch(fixture.origin + '/');
});
test.afterEach(async () => {
  await mobius?.close().catch(() => undefined);
  mobius = undefined;
  await fixture.close();
});

const openAbout = async () => {
  const shell = mobius!.shell;
  await shell.keyboard.press('Control+Comma');
  await shell.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'About', exact: true }).click();
};

test('removing data asks first, and cancelling changes nothing', async () => {
  await openAbout();
  const shell = mobius!.shell;
  await shell.getByRole('button', { name: 'Remove my data…' }).click();
  await expect(shell.getByRole('group', { name: 'Confirm removing all data' })).toBeVisible();
  await shell.getByRole('button', { name: 'Cancel' }).click();
  await expect(shell.getByRole('button', { name: 'Remove my data…' })).toBeVisible();
  expect(fs.existsSync(`${mobius!.userData}/appearance.json`) || fs.readdirSync(mobius!.userData).length > 0).toBe(true);
});

test('confirming empties the data folder', async () => {
  await openAbout();
  const shell = mobius!.shell;
  fs.writeFileSync(`${mobius!.userData}/marker.txt`, 'x');
  await shell.getByRole('button', { name: 'Remove my data…' }).click();
  await shell.getByRole('button', { name: 'Yes, remove everything' }).click();
  await expect.poll(() => fs.existsSync(`${mobius!.userData}/marker.txt`), { timeout: 15_000 }).toBe(false);
});
