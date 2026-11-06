import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched } from './harness';
import { says, startModel, type ModelFixture } from './model-fixture';

test.skip(process.env.MOBIUS_SHELL !== 'tauri', 'Providers are built in the Tauri shell');

let fixture: Fixture;
let first: ModelFixture | undefined;
let provider: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-providers-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await first?.close();
  await provider?.close();
  first = provider = undefined;
  await fixture.close();
  fs.rmSync(userData, { recursive: true, force: true });
});

const KEY = 'sk-e2e-provider-12345678';
const shell = () => mobius!.shell;
const page = (): Locator => shell().getByRole('region', { name: 'Settings' });
const openai = (): Locator => page().getByRole('listitem', { name: 'OpenAI', exact: true });

async function start(): Promise<void> {
  first = await startModel([says(['from the first server'])]);
  provider = await startModel([says(['from OpenAI'])], { models: ['gpt-b', 'gpt-a'] });
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: first.url, MOBIUS_AGENT_MODEL: 'first-model', MOBIUS_TEST_PROVIDER: `openai=${provider.url}` } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
  await shell().getByRole('button', { name: 'Settings', exact: true }).click();
  await page().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Providers', exact: true }).click();
  await expect(openai()).toBeVisible();
}

test('a key is added for one provider, its models are listed, and using it moves the agent there', async () => {
  await start();
  await expect(openai()).toContainText('No key');
  await expect(openai().getByRole('button', { name: 'Use OpenAI' })).toHaveCount(0);
  await openai().getByRole('button', { name: 'Add a key for OpenAI' }).click();
  await openai().getByRole('textbox', { name: 'OpenAI API key' }).fill(KEY);
  await openai().getByRole('button', { name: 'Save key' }).click();
  await expect(openai()).toContainText('Key saved');
  await expect(openai().getByRole('textbox', { name: 'OpenAI API key' })).toHaveCount(0);
  await openai().getByRole('button', { name: 'Use OpenAI' }).click();
  const choice = openai().getByRole('combobox', { name: 'OpenAI model' });
  await expect(choice.locator('option')).toHaveText(['gpt-a', 'gpt-b']);
  await choice.selectOption('gpt-b');
  await openai().getByRole('button', { name: 'Use this model' }).click();
  await expect(openai()).toContainText('In use');
  expect(provider!.authorization).toContain(`Bearer ${KEY}`);
  // The next message goes to the provider, with its key, and not to the server used before.
  await shell().keyboard.press('Escape');
  await shell().getByRole('textbox', { name: 'Message Mobius' }).fill('hello');
  await shell().getByRole('textbox', { name: 'Message Mobius' }).press('Enter');
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant').last()).toHaveText('from OpenAI');
  expect(provider!.requests.at(-1)?.model).toBe('gpt-b');
  expect(provider!.authorization.at(-1)).toBe(`Bearer ${KEY}`);
  expect(first!.requests).toHaveLength(0);
});

test('a key that is removed is no longer sent, and a provider without one cannot be used', async () => {
  await start();
  await openai().getByRole('button', { name: 'Add a key for OpenAI' }).click();
  await openai().getByRole('textbox', { name: 'OpenAI API key' }).fill('not a key');
  await openai().getByRole('button', { name: 'Save key' }).click();
  await expect(openai().getByRole('alert')).toContainText('does not look like a key');
  await openai().getByRole('textbox', { name: 'OpenAI API key' }).fill(KEY);
  await openai().getByRole('button', { name: 'Save key' }).click();
  await openai().getByRole('button', { name: 'Use OpenAI' }).click();
  await openai().getByRole('button', { name: 'Use this model' }).click();
  await expect(openai()).toContainText('In use');
  await openai().getByRole('button', { name: 'Remove the key for OpenAI' }).click();
  await expect(openai()).toContainText('No key');
  const settings = await shell().evaluate(() => window.mobius.agent.getSettings());
  expect(settings.hasKey).toBe(false);
  // Local servers need no key and say so.
  await expect(page().getByRole('listitem', { name: 'Ollama' })).toContainText('No key needed');
});
