import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData, openSettings } from './harness';
import { startModel, type ModelFixture } from './model-fixture';
import { startOpenAi, type OpenAiFixture } from './openai-fixture';

test.skip(process.env.MOBIUS_SHELL !== 'tauri', 'The ChatGPT sign-in is built in the Tauri shell');

let fixture: Fixture;
let first: ModelFixture | undefined;
let openai: OpenAiFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-chatgpt-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await first?.close();
  await openai?.close();
  first = openai = undefined;
  await fixture.close();
  removeTestData(userData);
});

const shell = () => mobius!.shell;
const page = (): Locator => shell().getByRole('region', { name: 'Settings' });
const row = (): Locator => page().getByRole('listitem', { name: 'ChatGPT subscription' });
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });
const log = (): Locator => shell().getByRole('log', { name: 'Conversation' });

async function openProviders(): Promise<void> {
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  await openSettings(shell());
  await shell().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Gateways', exact: true }).click();
}

test('signing in with a code on OpenAI\'s site lets the agent answer on the ChatGPT plan', async () => {
  first = await startModel([]);
  openai = await startOpenAi(['Hello from ChatGPT.']);
  mobius = await launch(fixture.origin + '/', { openMobius: true, userData, env: { MOBIUS_AGENT_URL: first.url, MOBIUS_AGENT_MODEL: 'first-model', MOBIUS_TEST_CHATGPT: openai.url } });
  await openProviders();
  await expect(row().getByRole('status')).toHaveText('Not signed in', { timeout: 15_000 });
  await row().getByRole('button', { name: 'Sign in to ChatGPT subscription' }).click();
  // The code to enter is shown; Mobius waits for the person.
  const code = row().getByLabel('Sign-in code');
  await expect(code).toContainText('MOBI-2026');
  await expect(row().getByRole('status')).toHaveText('Waiting for you to enter the code');
  openai.approve();
  await expect(row().getByRole('status')).toHaveText('Signed in as me@chatgpt.example', { timeout: 15_000 });
  await expect(code).toHaveCount(0);
  // The token is kept in the secret store, never in the settings files.
  for (const file of fs.readdirSync(userData).filter((f) => f.endsWith('.json') && f !== 'test-secrets.json')) {
    expect(fs.readFileSync(path.join(userData, file), 'utf8'), file).not.toContain('refresh-e2e');
  }

  await row().getByRole('button', { name: 'Use ChatGPT subscription' }).click();
  await row().getByRole('combobox', { name: 'ChatGPT subscription model' }).selectOption('gpt-5.5');
  await row().getByRole('button', { name: 'Use this model' }).click();
  await expect(row()).toContainText('In use');
  await shell().keyboard.press('Escape');

  await composer().fill('hi');
  await composer().press('Enter');
  await expect(log().locator('.msg.assistant').last()).toHaveText('Hello from ChatGPT.');
  const call = openai.requests.find((r) => r.path === '/backend-api/codex/responses')!;
  expect(call.headers['chatgpt-account-id']).toBe('acct-e2e');
  expect(call.headers.authorization).toMatch(/^Bearer h\./);
  expect(JSON.parse(call.body)).toMatchObject({ model: 'gpt-5.5', store: false });
  expect(first.requests).toHaveLength(0);

  // Signing out forgets the sign-in.
  await openProviders();
  await row().getByRole('button', { name: 'Sign out of ChatGPT subscription' }).click();
  await expect(row().getByRole('status')).toHaveText('Not signed in');
});

test('a sign-in that is waiting for a code can be cancelled', async () => {
  first = await startModel([]);
  openai = await startOpenAi([]);
  mobius = await launch(fixture.origin + '/', { openMobius: true, userData, env: { MOBIUS_AGENT_URL: first.url, MOBIUS_AGENT_MODEL: 'first-model', MOBIUS_TEST_CHATGPT: openai.url } });
  await openProviders();
  await row().getByRole('button', { name: 'Sign in to ChatGPT subscription' }).click();
  await expect(row().getByLabel('Sign-in code')).toContainText('MOBI-2026');
  await row().getByRole('button', { name: 'Cancel' }).click();
  await expect(row().getByRole('status')).toHaveText('Not signed in', { timeout: 15_000 });
  await expect(row().getByLabel('Sign-in code')).toHaveCount(0);
});
