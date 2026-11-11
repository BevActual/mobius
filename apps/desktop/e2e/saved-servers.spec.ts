import { expect, test } from '@playwright/test';
import { launch, startFixture, type Fixture, type Launched, openSettings } from './harness';
import { says, startModel, type ModelFixture } from './model-fixture';


let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
test.beforeEach(async () => {
  fixture = await startFixture();
  model = await startModel([says(['ok'])]);
  mobius = await launch(fixture.origin + '/', { openMobius: true, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'chat-model' } });
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  await fixture.close();
});

test('the server in use can be saved under a name, switched away from and back to, and removed', async () => {
  const shell = mobius!.shell;
  await openSettings(shell);
  await shell.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Model', exact: true }).click();
  await shell.getByRole('textbox', { name: 'Name for this server' }).fill('Bench');
  await shell.getByRole('button', { name: 'Keep current server' }).click();
  const list = shell.getByRole('list', { name: 'Saved servers' });
  await expect(list.getByText('Bench')).toBeVisible();
  await expect(list.getByText(/chat-model/)).toBeVisible();
  await shell.getByRole('button', { name: 'Use Bench' }).click();
  await expect(shell.getByRole('alert')).toHaveCount(0);
  await shell.getByRole('button', { name: 'Remove Bench' }).click();
  await expect(list).toHaveCount(0);
});

test('an empty name cannot be saved', async () => {
  const shell = mobius!.shell;
  await openSettings(shell);
  await shell.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Model', exact: true }).click();
  await expect(shell.getByRole('button', { name: 'Keep current server' })).toBeDisabled();
});
