import { expect, test, type Locator } from '@playwright/test';
import { launch, startFixture, type Fixture, type Launched } from './harness';
import { says, startModel, type ModelFixture } from './model-fixture';


let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
test.beforeEach(async () => {
  fixture = await startFixture();
  model = await startModel([says(['First answer.']), says(['Second answer.'])]);
  mobius = await launch(fixture.origin + '/', { env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'chat-model' } });
  await openAgent();
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  await fixture.close();
});

const shell = () => mobius!.shell;
const openAgent = async () => {
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Agent');
  await shell().keyboard.press('Enter');
  await expect(list()).toBeVisible();
};
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });
const list = (): Locator => shell().getByRole('complementary', { name: 'Conversation list' });
const row = (title: string): Locator => list().locator('.clist-item', { hasText: title });
const say = async (text: string) => {
  await expect(shell().getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await composer().fill(text);
  await composer().press('Enter');
};

test('a conversation can be put away, found under Archived, and brought back', async () => {
  await say('Plan the harbour walk');
  await expect(list().getByText('Plan the harbour walk')).toBeVisible();
  await row('Plan the harbour walk').hover();
  await row('Plan the harbour walk').getByRole('button', { name: 'Archive Plan the harbour walk' }).click();
  await expect(list().getByRole('list', { name: 'Archived sessions' })).toHaveCount(0);
  await expect(list().getByRole('button', { name: /^Archived/ })).toBeVisible();
  await list().getByRole('button', { name: /^Archived/ }).click();
  await expect(list().getByRole('list', { name: 'Archived sessions' }).getByText('Plan the harbour walk')).toBeVisible();
  await row('Plan the harbour walk').hover();
  await row('Plan the harbour walk').getByRole('button', { name: 'Unarchive Plan the harbour walk' }).click();
  await expect(list().getByRole('button', { name: /^Archived/ })).toHaveCount(0);
  await row('Plan the harbour walk').hover();
  await expect(row('Plan the harbour walk').getByRole('button', { name: 'Archive Plan the harbour walk' })).toBeVisible();
});

test('what was put away is still put away after a restart', async () => {
  await say('Order new nets');
  await row('Order new nets').hover();
  await row('Order new nets').getByRole('button', { name: 'Archive Order new nets' }).click();
  await expect(list().getByRole('button', { name: /^Archived/ })).toBeVisible();
  const userData = mobius!.userData;
  await mobius!.close({ keepUserData: true });
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model!.url, MOBIUS_AGENT_MODEL: 'chat-model' } });
  await openAgent();
  await expect(list().getByRole('button', { name: /^Archived/ })).toBeVisible();
});
