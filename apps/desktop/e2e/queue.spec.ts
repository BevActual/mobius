import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-queue-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
  removeTestData(userData);
});

const shell = () => mobius!.shell;
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });
const queue = (): Locator => shell().getByRole('region', { name: 'Queued messages' });
/** What the person said last in each request the model got, oldest first. */
const asked = (): string[] => model!.requests.map((r) => {
  const messages = (r.messages ?? []) as Array<{ role: string; content: unknown }>;
  const last = messages.filter((m) => m.role === 'user').at(-1);
  return typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '');
});

async function start(replies: ModelReply[]): Promise<void> {
  model = await startModel(replies);
  fs.writeFileSync(path.join(userData, 'preferences.json'), JSON.stringify({ agentPrivateUrls: true, approvalMode: 'manual' }));
  mobius = await launch(fixture.origin + '/', { userData, openMobius: true, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'chat-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
}

test('Enter while Mobius works queues the message; queued ones can be edited and go in order as each turn ends', async () => {
  await start([says(['Looking ', 'at ', 'the ', 'menu.'], 500), says(['Booked ', 'the table.'], 400), says(['Done.'])]);
  await composer().fill('Read the menu');
  await composer().press('Enter');
  await expect(shell().getByRole('button', { name: 'Stop' })).toBeVisible();

  await composer().fill('Book a table for two');
  await composer().press('Enter');
  await composer().fill('Then tell Sam');
  await composer().press('Enter');
  await expect(composer()).toHaveValue('');
  await expect(queue().getByRole('listitem')).toHaveText([/Book a table for two/, /Then tell Sam/]);
  await expect(queue()).toContainText('2 waiting');

  // Edit the second one while it waits.
  await queue().getByRole('button', { name: 'Edit queued message 2' }).click();
  await queue().getByRole('textbox', { name: 'Edit queued message 2' }).fill('Then tell Sam and Alex');
  await queue().getByRole('textbox', { name: 'Edit queued message 2' }).press('Enter');
  await expect(queue().getByRole('listitem').nth(1)).toContainText('Then tell Sam and Alex');

  // Each goes when the turn before it ends, in order; then the queue is gone.
  await expect(queue()).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(() => model!.requests.length, { timeout: 15_000 }).toBe(3);
  const said = asked();
  expect(said[0]).toContain('Read the menu');
  expect(said[1]).toContain('Book a table for two');
  expect(said[2]).toContain('Then tell Sam and Alex');
  const log = shell().getByRole('log', { name: 'Conversation' });
  await expect(log.locator('.msg.assistant').last()).toHaveText('Done.');
});

test('Stop ends the running turn but keeps the queue: Send next goes on, Remove and Clear queue take messages out', async () => {
  await start([says(['Thinking ', 'about ', 'it ', 'for ', 'a ', 'long ', 'while.'], 1500), says(['First, done.']), says(['Second, done.']), says(['Checking ', 'the ', 'calendar ', 'slowly.'], 1500)]);
  await composer().fill('Plan the week');
  await composer().press('Enter');
  await expect(shell().getByRole('button', { name: 'Stop' })).toBeVisible();
  for (const text of ['Add Monday', 'Add Tuesday', 'Add Wednesday']) {
    await composer().fill(text);
    await composer().press('Enter');
  }
  await expect(queue().getByRole('listitem')).toHaveCount(3);

  await shell().getByRole('button', { name: 'Stop' }).click();
  await expect(queue()).toContainText('Stopped: 3 waiting');
  // Nothing more goes by itself after Stop.
  await shell().waitForTimeout(1500);
  expect(model!.requests).toHaveLength(1);

  await queue().getByRole('button', { name: 'Remove queued message 2' }).click();
  await expect(queue().getByRole('listitem')).toHaveText([/Add Monday/, /Add Wednesday/]);

  // Send next: the first goes now, and the one after it follows when that turn ends.
  await queue().getByRole('button', { name: 'Send next' }).click();
  await expect.poll(() => model!.requests.length, { timeout: 15_000 }).toBe(3);
  expect(asked().slice(1).map((s) => (s.includes('Add Monday') ? 'Monday' : s.includes('Add Wednesday') ? 'Wednesday' : s))).toEqual(['Monday', 'Wednesday']);
  await expect(queue()).toHaveCount(0);

  // Clear queue empties it: nothing it held is sent when the turn ends.
  await composer().fill('Check the calendar');
  await composer().press('Enter');
  await composer().fill('And book the dentist');
  await composer().press('Enter');
  await expect(queue().getByRole('listitem')).toHaveCount(1);
  await queue().getByRole('button', { name: 'Clear queue' }).click();
  await expect(queue()).toHaveCount(0);
  await expect(shell().getByRole('button', { name: 'Stop' })).toHaveCount(0, { timeout: 20_000 });
  await shell().waitForTimeout(800);
  expect(model!.requests).toHaveLength(4);
});
