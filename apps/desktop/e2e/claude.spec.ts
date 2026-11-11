import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData, openSettings } from './harness';
import { startModel, type ModelFixture } from './model-fixture';
import { startAnthropic, type AnthropicFixture, type AnthropicReply } from './anthropic-fixture';

test.skip(process.env.MOBIUS_SHELL !== 'tauri', 'The Claude subscription is built in the Tauri shell');

// A stand-in for the Claude Code CLI, built from crates/mobius-claude.
const FAKE_CLAUDE = path.resolve(import.meta.dirname, '../../../target/debug', process.platform === 'win32' ? 'fake-claude.exe' : 'fake-claude');

let fixture: Fixture;
let first: ModelFixture | undefined;
let anthropic: AnthropicFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-claude-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await first?.close();
  await anthropic?.close();
  first = anthropic = undefined;
  await fixture.close();
  removeTestData(userData);
});

const shell = () => mobius!.shell;
const page = (): Locator => shell().getByRole('region', { name: 'Settings' });
const row = (): Locator => page().getByRole('listitem', { name: 'Claude subscription' });
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });
const log = (): Locator => shell().getByRole('log', { name: 'Conversation' });

async function start(replies: AnthropicReply[]): Promise<void> {
  first = await startModel([]);
  anthropic = await startAnthropic(replies);
  mobius = await launch(fixture.origin + '/', { openMobius: true, userData, env: { MOBIUS_AGENT_URL: first.url, MOBIUS_AGENT_MODEL: 'first-model', MOBIUS_TEST_CLAUDE: FAKE_CLAUDE, MOBIUS_TEST_CLAUDE_UPSTREAM: anthropic.url } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  await openSettings(shell());
  await page().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Providers', exact: true }).click();
  await expect(row().getByRole('status')).toHaveText('Signed in as person@example.com', { timeout: 15_000 });
  await row().getByRole('button', { name: 'Use Claude subscription' }).click();
  await row().getByRole('combobox', { name: 'Claude subscription model' }).selectOption('sonnet');
  await row().getByRole('button', { name: 'Use this model' }).click();
  await expect(row()).toContainText('In use');
  await shell().keyboard.press('Escape');
}
const say = async (text: string) => {
  await expect(shell().getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await composer().fill(text);
  await composer().press('Enter');
};

test('signed in through Claude Code, the agent answers on the subscription with Claude Code\'s own sign-in', async () => {
  await start([{ text: 'Hello from Claude.' }]);
  await say('hi');
  await expect(log().locator('.msg.assistant').last()).toHaveText('Hello from Claude.');
  expect(anthropic!.requests).toHaveLength(1);
  expect(anthropic!.requests[0]!.headers.authorization).toBe('Bearer fake-oauth-token');
  const tools = (anthropic!.requests[0]!.body.tools as Array<{ name: string }>).map((t) => t.name);
  expect(tools).toContain('mcp__mobius__files-write');
  expect(first!.requests).toHaveLength(0);
});

test('a tool Claude asks for still goes through Mobius\'s own approval, and runs only once allowed', async () => {
  await start([{ tool: { name: 'files-write', input: { path: 'from-claude.md', content: '# Hi\n' } } }, { text: 'Saved it.' }]);
  await say('save a note');
  const card = shell().getByRole('group', { name: /Approval needed/ });
  await expect(card).toBeVisible({ timeout: 15_000 });
  expect(fs.existsSync(path.join(userData, 'workspace', 'from-claude.md'))).toBe(false);
  await card.getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Saved it.');
  expect(fs.readFileSync(path.join(userData, 'workspace', 'from-claude.md'), 'utf8')).toBe('# Hi\n');
  // The second request carried the tool result back to Claude.
  expect(JSON.stringify(anthropic!.requests[1]!.body.messages)).toContain('tool_result');
});
