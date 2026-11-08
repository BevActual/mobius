import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coreCall, launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

// A stand-in MCP server built from crates/mobius-mcp (`cargo build -p mobius-mcp`).
const FAKE_SERVER = path.resolve(import.meta.dirname, '../../../target/debug', process.platform === 'win32' ? 'fake-mcp-server.exe' : 'fake-mcp-server');

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-mcp-'));
  fs.writeFileSync(path.join(userData, 'mcp.json'), JSON.stringify({ servers: { fake: { command: FAKE_SERVER } } }));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
  removeTestData(userData);
});

async function start(replies: ModelReply[]): Promise<Launched> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  return mobius;
}
const shell = () => mobius!.shell;
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });
const log = (): Locator => shell().getByRole('log', { name: 'Conversation' });
const card = (): Locator => shell().getByRole('group', { name: /Approval needed/ });
const say = async (text: string) => {
  await expect(shell().getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await composer().fill(text);
  await composer().press('Enter');
};

test('the model offered a tool from a configured MCP server, and using it asks first and returns the answer', async () => {
  await start([callsTool('mcp-fake-echo', { text: 'from the server' }), says(['Done.'])]);
  // The server starts in the background; its tools reach the core a moment after the window is ready.
  await expect.poll(async () => (await coreCall<Array<{ name: string }>>(mobius!.app, 'tools.list')).map((t) => t.name), { timeout: 30_000 }).toContain('mcp.fake.echo');
  await say('use it');
  await expect(card()).toBeVisible();
  await expect(card()).toContainText('mcp.fake');
  await card().getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('Done.');
  const toolsOffered = JSON.stringify((model!.requests[0] as { tools?: unknown[] }).tools ?? []);
  expect(toolsOffered).toContain('mcp-fake-echo');
  // The server's answer went back to the model as the result of the call.
  expect(JSON.stringify(model!.requests[1])).toContain('from the server');
});

test('with no mcp.json nothing about MCP appears', async () => {
  fs.rmSync(path.join(userData, 'mcp.json'));
  await start([says(['Hi.'])]);
  await say('hello');
  await expect(log().locator('.msg.assistant').last()).toHaveText('Hi.');
  expect(JSON.stringify((model!.requests[0] as { tools?: unknown[] }).tools ?? [])).not.toContain('mcp-');
});
