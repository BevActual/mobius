import { expect, test, type Locator } from '@playwright/test';
import { launch, startFixture, type Fixture, type Launched } from './harness';
import { refuses, says, startModel, type ModelFixture } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
test.beforeEach(async () => { fixture = await startFixture(); });
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
});

const composer = (): Locator => mobius!.shell.getByRole('textbox', { name: 'Message Mobius' });
const log = (): Locator => mobius!.shell.getByRole('log', { name: 'Conversation' });
const say = async (text: string) => {
  await expect(mobius!.shell.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await composer().fill(text);
  await composer().press('Enter');
};

test('when the model says the conversation is too long, earlier messages are summarised and the answer still comes', async () => {
  model = await startModel([
    says(['First answer.']),
    refuses(400, "This model's maximum context length is 2048 tokens. Please reduce the length of the messages."),
    says(['SECRET-SUMMARY-TEXT']),
    says(['Second answer.']),
  ]);
  mobius = await launch(fixture.origin + '/', { env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  await say('First question');
  await expect(log().locator('.msg.assistant')).toHaveText('First answer.');
  await say('Second question');
  await expect(log().locator('.msg.assistant').last()).toHaveText('Second answer.');
  await expect(log()).toContainText('Earlier messages were summarised to make room for the model.');
  // Everything stays on screen, and the summary itself is never shown as an answer.
  await expect(log().locator('.msg.user')).toHaveText(['First question', 'Second question']);
  await expect(log()).not.toContainText('SECRET-SUMMARY-TEXT');
  // The summary request offered no tools; the retried request carried the summary.
  expect(model.requests).toHaveLength(4);
  expect(model.requests[2]!.tools ?? []).toEqual([]);
  expect(JSON.stringify(model.requests[3]!.messages)).toContain('SECRET-SUMMARY-TEXT');
});
