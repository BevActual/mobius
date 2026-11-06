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

test('a tab shows the icon its page offers, and a plain placeholder when it has none', async () => {
  mobius = await launch(fixture.origin + '/icon');
  const tab = mobius.shell.locator('.tab').first();
  await expect(tab.locator('img.tab-icon')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await mobius.shell.getByRole('textbox', { name: 'Address or question' }).fill(fixture.origin + '/second');
  await mobius.shell.keyboard.press('Enter');
  await expect(tab.locator('.tab-title')).toHaveText('Second page');
  await expect(tab.locator('img.tab-icon')).toHaveCount(0);
  await expect(tab.locator('.tab-icon.placeholder')).toHaveCount(1);
});
