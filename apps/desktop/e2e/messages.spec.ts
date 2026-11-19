import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { startModel, type ModelFixture } from './model-fixture';

test.skip(process.env.MOBIUS_SHELL !== 'tauri', 'Messages is built in the Tauri shell');

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-messages-'));
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

async function start(): Promise<void> {
  model = await startModel([]);
  fs.writeFileSync(path.join(userData, 'preferences.json'), JSON.stringify({ installedApps: ['notes', 'tasks', 'calendar', 'mail', 'docs', 'browser', 'messages'] }));
  mobius = await launch(fixture.origin + '/', { userData, openMobius: true, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
}
const openMessages = async () => {
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Messages');
  await shell().keyboard.press('Enter');
};

test('with no accounts yet, Messages says where its channels will come from', async () => {
  await start();
  await openMessages();
  await expect(shell().getByRole('region', { name: 'No accounts yet' })).toBeVisible();
});

test('channels by account, a channel read and its thread, Send only from the person, and Catch me up put to Mobius', async () => {
  await start();
  // The accounts' bridge comes from the host (the Builder's part); this stands in for it with one Slack workspace.
  await shell().evaluate(() => {
    const t = (h: number, m: number) => new Date(2026, 10, 18, h, m).getTime();
    const sent: string[] = [];
    (window as unknown as { sentMessages: string[] }).sentMessages = sent;
    const history = [
      { id: 'm1', channel: 'general', author: { id: 'priya', name: 'Priya Nair' }, text: 'The build is red again', at: t(9, 5), replies: 1 },
      { id: 'm2', channel: 'general', author: { id: 'priya', name: 'Priya Nair' }, text: 'Can someone look before standup?', at: t(9, 6), reactions: [{ emoji: '👀', count: 2 }] },
    ];
    window.mobius.messages = {
      accounts: async () => [{ id: 'w', service: 'slack', name: 'Northway', status: 'ready' }],
      channels: async () => [{ id: 'general', account: 'w', name: 'general', kind: 'channel', unread: 2, mentions: 1, last: t(9, 6) }, { id: 'priya', account: 'w', name: 'Priya Nair', kind: 'direct', unread: 0, mentions: 0, last: t(8, 0) }],
      history: async (_a, _c, options) => (options?.thread ? [{ id: 'r1', channel: 'general', author: { id: 'lee', name: 'Lee Park' }, text: 'On it', at: t(9, 10), thread: 'm1' }] : history),
      send: async (_a, _c, text) => { sent.push(text); return { id: `s${sent.length}`, channel: 'general', author: { id: 'me', name: 'Me', me: true }, text, at: t(9, 20) }; },
      markRead: async () => undefined,
      onChanged: () => () => undefined,
    };
  });
  await openMessages();
  const side = shell().getByRole('complementary', { name: 'Channels' });
  await expect(side.getByRole('region', { name: 'Northway · Slack' })).toBeVisible();
  await side.getByRole('button', { name: /^#general/ }).click();
  const log = shell().getByRole('log', { name: '#general', exact: true });
  await expect(log).toContainText('Priya Nair');
  await expect(log).toContainText('Can someone look before standup?');
  await expect(log.getByRole('list', { name: 'Reactions' })).toHaveText('👀 2');
  // A thread opens beside the channel, on the right, with the message it hangs from; a reply there goes in the thread.
  await log.getByRole('button', { name: '1 reply' }).click();
  const thread = shell().getByRole('log', { name: 'Thread in #general' });
  await expect(thread).toContainText('The build is red again');
  await expect(thread).toContainText('On it');
  await expect(log).toBeVisible();
  const reply = shell().getByRole('textbox', { name: 'Reply in thread' });
  await reply.fill('Thanks Lee');
  await reply.press('Enter');
  await expect(thread).toContainText('Thanks Lee');
  await expect(log.getByRole('button', { name: '2 replies' })).toBeVisible();
  await shell().getByRole('button', { name: 'Hide Thread' }).click();
  await expect(thread).toHaveCount(0);
  // A sender's name opens the Person panel: who they are, here someone not in the address book.
  await log.getByRole('button', { name: 'Priya Nair' }).first().click();
  const person = shell().getByLabel('Contact', { exact: true });
  await expect(person).toContainText('Priya Nair');
  await expect(person).toContainText('Not in your contacts.');
  await shell().getByRole('button', { name: 'Hide Person' }).click();
  // Only the person's own Send sends.
  const box = shell().getByRole('textbox', { name: 'Message #general' });
  await box.fill('Looking now');
  await box.press('Enter');
  await expect(box).toHaveValue('');
  await expect(log).toContainText('Looking now');
  expect(await shell().evaluate(() => (window as unknown as { sentMessages: string[] }).sentMessages)).toEqual(['Thanks Lee', 'Looking now']);
  // Catch me up: the channel attached as someone else's words, and the ask in Mobius's box, not sent.
  await shell().getByRole('group', { name: 'Messages' }).getByRole('button', { name: 'Catch me up' }).click();
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toHaveValue(/^Catch me up on #general/);
  expect(model!.requests).toHaveLength(0);
});

test('a Matrix room this device cannot read yet shows one line instead of its messages', async () => {
  await start();
  await shell().evaluate(() => {
    window.mobius.messages = {
      accounts: async () => [{ id: 'm', service: 'matrix', name: '@ana:example.org', status: 'ready' }],
      channels: async () => [
        { id: '!dm:example.org', account: 'm', name: 'Lee Park', kind: 'direct', unread: 0, mentions: 0, last: 2000, encrypted: true },
        { id: '!ops:example.org', account: 'm', name: 'Ops', kind: 'channel', unread: 0, mentions: 0, last: 1000 },
      ],
      history: async () => [],
      send: async () => ({ ok: false, message: 'not here' }),
      markRead: async () => undefined,
      onChanged: () => () => undefined,
    };
  });
  await openMessages();
  const side = shell().getByRole('complementary', { name: 'Channels' });
  await expect(side.getByRole('region', { name: '@ana:example.org · Matrix' })).toBeVisible();
  await side.getByRole('button', { name: /^Lee Park/ }).click();
  await expect(shell().getByRole('status').filter({ hasText: 'Encrypted: verify this device in Settings > Messages to read' })).toHaveCount(1);
  await expect(shell().getByRole('textbox', { name: 'Message Lee Park' })).toHaveCount(0);
  await side.getByRole('button', { name: /^#Ops/ }).click();
  await expect(shell().getByRole('textbox', { name: 'Message #Ops' })).toBeVisible();
});
