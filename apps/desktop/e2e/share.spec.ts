import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData, openSettings } from './harness';

test.skip(process.env.MOBIUS_SHELL !== 'tauri', 'Sharing tools over MCP is built in the Tauri shell');

let fixture: Fixture;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-share-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await fixture.close();
  removeTestData(userData);
});

const shell = () => mobius!.shell;
const page = (): Locator => shell().getByRole('region', { name: 'Settings' });

const freePort = () => new Promise<number>((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)); });
});

async function mcp(url: string, token: string, body: object): Promise<{ status: number; json: any }> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: r.status, json: r.status === 202 ? null : await r.json() };
}

test('another agent can read the workspace over MCP once allowed, and change files only when allowed too', async () => {
  fs.mkdirSync(path.join(userData, 'workspace', 'notes'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace', 'notes', 'garden.md'), '# Garden\n');
  mobius = await launch(fixture.origin + '/', { userData, env: {} });
  const port = await freePort();
  await shell().waitForFunction(() => Boolean((window as unknown as { mobius: { share?: unknown } }).mobius.share));
  await shell().evaluate((p) => (window as unknown as { mobius: { share: { set(c: object): Promise<unknown> } } }).mobius.share.set({ port: p }), port);

  await openSettings(shell());
  await page().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Advanced', exact: true }).click();
  await page().getByRole('tab', { name: 'Other apps', exact: true }).click();
  await expect(page().getByLabel('Connect an app')).toHaveCount(0);
  await page().getByRole('switch', { name: 'Let other apps use Mobius' }).click();

  const setup = page().getByLabel('Connect an app');
  await expect(setup).toContainText(`http://127.0.0.1:${port}/mcp`);
  const command = await setup.getByLabel('Claude Code command').textContent();
  const token = /Bearer ([0-9a-f]{64})/.exec(command ?? '')![1]!;
  const url = `http://127.0.0.1:${port}/mcp`;

  const init = await mcp(url, token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  expect(init.json.result.serverInfo.name).toBe('mobius');
  const read = await mcp(url, token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'files.read', arguments: { path: 'notes/garden.md' } } });
  expect(read.json.result.content[0].text).toContain('# Garden');
  const refused = await mcp(url, token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'files.write', arguments: { path: 'notes/x.md', content: 'x' } } });
  expect(refused.json.error).toBeTruthy();
  expect((await mcp(url, 'f'.repeat(64), { jsonrpc: '2.0', id: 4, method: 'ping' })).status).toBe(401);

  await page().getByRole('switch', { name: 'Let them change files' }).click();
  await expect(page().getByRole('switch', { name: 'Let them change files' })).toBeChecked();
  const wrote = await mcp(url, token, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'files.write', arguments: { path: 'notes/from-claude.md', content: '# Hi\n' } } });
  expect(wrote.json.result.isError).toBe(false);
  expect(fs.readFileSync(path.join(userData, 'workspace', 'notes', 'from-claude.md'), 'utf8')).toBe('# Hi\n');

  // Turning it off closes the door.
  await page().getByRole('switch', { name: 'Let other apps use Mobius' }).click();
  await expect(setup).toHaveCount(0);
  await expect(fetch(url, { method: 'POST' })).rejects.toThrow();
});
