import { expect, test, type Locator } from '@playwright/test';
import { clipboardText, launch, startFixture, type Fixture, type Launched, turnEnded } from './harness';
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

async function start(replies: ModelReply[]): Promise<Launched> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  return mobius;
}
const shell = () => mobius!.shell;
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });
const log = (): Locator => shell().getByRole('log', { name: 'Conversation' });
const say = async (text: string) => {
  await expect(shell().getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await composer().fill(text);
  await composer().press('Enter');
};

test('Copy puts a reply on the clipboard and says so', async () => {
  await start([says(['Copy this answer.'])]);
  await say('hi');
  await expect(log().locator('.msg.assistant')).toHaveText('Copy this answer.');
  await log().locator('.msg.assistant').hover();
  await shell().getByRole('button', { name: 'Copy reply' }).click();
  await expect(shell().getByRole('button', { name: 'Copy reply' })).toHaveText('Copied');
  expect(await clipboardText(mobius!.app)).toBe('Copy this answer.');
});

test('Try again asks the same question again and replaces the answer', async () => {
  await start([says(['First attempt.']), says(['Second attempt.'])]);
  await say('Tell me something');
  await expect(log().locator('.msg.assistant')).toHaveText('First attempt.');
  await shell().getByRole('button', { name: 'Try again' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('Second attempt.');
  await expect(log().locator('.msg.user')).toHaveCount(1);
  const last = model!.requests.at(-1)!.messages as Array<{ role: string; content: string }>;
  expect(last.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['Tell me something']);
});

test('Edit puts the last message back in the box to be changed, and sending it replaces the exchange', async () => {
  await start([says(['Answer to the first wording.']), says(['Answer to the new wording.'])]);
  await say('First wordnig');
  await expect(log().locator('.msg.assistant')).toHaveText('Answer to the first wording.');
  await shell().getByRole('button', { name: 'Edit message' }).click();
  await expect(composer()).toHaveValue('First wordnig');
  await expect(log().locator('.msg')).toHaveCount(0);
  await turnEnded(composer());
  await composer().fill('First wording');
  await composer().press('Enter');
  await expect(log().locator('.msg.assistant')).toHaveText('Answer to the new wording.');
  await expect(log().locator('.msg.user')).toHaveText('First wording');
  const last = model!.requests.at(-1)!.messages as Array<{ role: string; content: string }>;
  expect(last.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['First wording']);
});

test('only the last exchange can be taken back, and nothing while a reply is being written', async () => {
  await start([says(['One.']), says(['Two ', 'is ', 'slow.'], 400)]);
  await say('first');
  await expect(log().locator('.msg.assistant')).toHaveText('One.');
  await say('second');
  await expect(shell().getByRole('button', { name: 'Edit message' })).toHaveCount(0);
  await expect(log().locator('.msg.assistant').last()).toHaveText('Two is slow.');
  await expect(shell().getByRole('button', { name: 'Edit message' })).toHaveCount(1);
  await expect(shell().getByRole('button', { name: 'Try again' })).toHaveCount(1);
  await expect(shell().getByRole('button', { name: 'Copy reply' })).toHaveCount(2);
});

test('the actions work in the Agent app too', async () => {
  await start([says(['In the app.']), says(['Again in the app.'])]);
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Agent');
  await shell().keyboard.press('Enter');
  await say('hello');
  await expect(log().locator('.msg.assistant')).toHaveText('In the app.');
  await shell().getByRole('button', { name: 'Try again' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('Again in the app.');
});

test('a finished tool step shows what it was asked and what it returned', async () => {
  await start([callsTool('browser-tabs'), says(['You have one tab.'])]);
  await say('what tabs are open?');
  const approval = shell().getByRole('group', { name: /Approval needed/ });
  await approval.getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('You have one tab.');
  const toggle = shell().getByRole('button', { name: /Show details of/ });
  await expect(toggle).toBeVisible();
  await toggle.click();
  const details = shell().getByRole('group', { name: /Details of/ });
  await expect(details).toContainText('Asked');
  await expect(details).toContainText('Returned');
  await expect(details).toContainText(fixture.origin);
  await shell().getByRole('button', { name: /Hide details of/ }).click();
  await expect(details).toHaveCount(0);
});

test('a tool step that failed says so in its details', async () => {
  await start([callsTool('no-such-tool'), says(['That did not work.'])]);
  await say('do something odd');
  await expect(log().locator('.msg.assistant')).toHaveText('That did not work.');
  await shell().getByRole('button', { name: /Show details of/ }).click();
  await expect(shell().getByRole('group', { name: /Details of/ })).toContainText('It failed with');
});
