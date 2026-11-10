import { expect, test, type Locator } from '@playwright/test';
import { launch, startFixture, type Fixture, type Launched, openSettings } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
test.beforeEach(async () => {
  fixture = await startFixture();
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
});

// The fixture pages are on 127.0.0.1, which is exactly what the rule is about.
async function start(replies: ModelReply[]): Promise<Launched> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { realNetworkRules: true, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  return mobius;
}
const shell = () => mobius!.shell;
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });
const page = (): Locator => shell().getByRole('region', { name: 'Settings' });
const log = (): Locator => shell().getByRole('log', { name: 'Conversation' });
const say = async (text: string) => {
  await expect(shell().getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await composer().fill(text);
  await composer().press('Enter');
};
const tabCount = () => shell().locator('.tab').count();

test('by default the agent cannot open a local address, and says why', async () => {
  await start([callsTool('browser-open', { url: fixture.origin + '/second' }), says(['It would not open.'])]);
  expect(await tabCount()).toBe(1);
  await say('open the second page');
  await shell().getByRole('group', { name: /Approval needed/ }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('It would not open.');
  expect(await tabCount()).toBe(1);
  await shell().getByRole('button', { name: /Show details of browser.open/ }).click();
  await expect(shell().getByRole('group', { name: /Details of/ })).toContainText('local network');
});

test('the switch in settings turns the rule off and on', async () => {
  await start([]);
  const allowed = () => shell().evaluate(() => window.mobius.preferences.get().then((p) => p?.agentPrivateUrls));
  expect(await allowed()).toBe(false);
  await openSettings(shell());
  await expect(page()).toBeVisible();
  await page().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Browser', exact: true }).click();
  await page().getByRole('tab', { name: 'Network', exact: true }).click();
  const toggle = page().getByRole('switch', { name: 'Let the agent use local addresses' });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect.poll(allowed).toBe(true);
  await toggle.uncheck();
  await expect.poll(allowed).toBe(false);
});

test('once allowed, the agent can open a local address', async () => {
  await start([callsTool('browser-open', { url: fixture.origin + '/second' }), says(['Opened it.'])]);
  await shell().evaluate(() => window.mobius.preferences.set({ agentPrivateUrls: true }));
  await say('open the second page');
  await shell().getByRole('group', { name: /Approval needed/ }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('Opened it.');
  await expect.poll(tabCount).toBe(2);
});

test('the person can still open a local address themselves', async () => {
  await start([]);
  const address = shell().getByRole('textbox', { name: 'Address or question' });
  await address.fill(fixture.origin + '/second');
  await address.press('Enter');
  await expect(shell().locator('.tab-title').first()).toHaveText('Second page');
});

test('the agent cannot read a local page the person has open, until allowed', async () => {
  await start([callsTool('browser-read', {}), says(['I could not read it.'])]);
  await say('read this page');
  await shell().getByRole('group', { name: /Approval needed/ }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('I could not read it.');
  await shell().getByRole('button', { name: /Show details of browser.read/ }).click();
  await expect(shell().getByRole('group', { name: /Details of/ })).toContainText('local network');
  await expect(shell().getByRole('group', { name: /Details of/ })).not.toContainText('Fixture home');
});
