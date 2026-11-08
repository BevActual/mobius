import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coreCall, coreHistory, corePid, crashCore, launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';

let fixture: Fixture;
let mobius: Launched | undefined;

test.beforeEach(async () => {
  fixture = await startFixture();
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await fixture.close();
});

const agent = { kind: 'agent', id: 'e2e-agent' };
const indicator = () => mobius!.shell.locator('.core-status');

type Outcome = { status: string; request_id?: number; result?: unknown };
const invoke = (tool: string, args: unknown = {}) => coreCall<Outcome>(mobius!.app, 'tools.invoke', { principal: agent, tool, args });

test('the core starts, the shell says so, and it answers over the real pipe', async () => {
  mobius = await launch(fixture.origin + '/');
  await expect(indicator()).toHaveText('Core ready');
  const ping = await coreCall<{ protocol: number }>(mobius.app, 'core.ping');
  expect(ping.protocol).toBe(1);
});

test('the permission gate works end to end through Electron: ask, approve once, run, ask again', async () => {
  mobius = await launch(fixture.origin + '/');
  await expect(indicator()).toHaveText('Core ready');
  const first = await invoke('demo.echo', { n: 1 });
  expect(first.status).toBe('needs_approval');
  const pending = await coreCall<Array<{ id: number; capability: string }>>(mobius.app, 'permissions.pending');
  expect(pending).toHaveLength(1);
  expect(pending[0]!.capability).toBe('demo.echo');
  await coreCall(mobius.app, 'permissions.resolve', { request_id: first.request_id, approve: true, duration: 'once' });
  const done = await invoke('demo.echo', { n: 2 });
  expect(done).toMatchObject({ status: 'completed', result: { echo: { n: 2 } } });
  expect((await invoke('demo.echo', { n: 3 })).status).toBe('needs_approval');
});

test('a command-style capability can only ever be approved one use at a time', async () => {
  mobius = await launch(fixture.origin + '/');
  await expect(indicator()).toHaveText('Core ready');
  const asked = await invoke('demo.exec_probe');
  await expect(
    coreCall(mobius.app, 'permissions.resolve', { request_id: asked.request_id, approve: true, duration: 'always' }),
  ).rejects.toThrow(/needs approval for each use/);
});

test('if the core crashes it is restarted, and nothing it had acknowledged is lost', async () => {
  mobius = await launch(fixture.origin + '/');
  await expect(indicator()).toHaveText('Core ready');
  const asked = await invoke('demo.echo');
  await coreCall(mobius.app, 'permissions.resolve', { request_id: asked.request_id, approve: true, duration: 'always' });
  expect((await invoke('demo.echo')).status).toBe('completed');
  const before = (await coreCall<unknown[]>(mobius.app, 'events.list', { limit: 100 })).length;
  const app = mobius.app;
  const oldPid = await corePid(app);

  await crashCore(app);

  await expect.poll(async () => { const pid = await corePid(app); return pid !== undefined && pid !== oldPid; }, { timeout: 15_000 }).toBe(true);
  await expect(indicator()).toHaveText('Core ready');
  const history = await coreHistory(mobius.app);
  expect(history.slice(history.indexOf('restarting'))).toEqual(['restarting', 'starting', 'ready']);
  expect((await invoke('demo.echo')).status, 'the standing approval survived the crash').toBe('completed');
  const after = await coreCall<unknown[]>(mobius.app, 'events.list', { limit: 100 });
  expect(after.length).toBeGreaterThan(before);
});

test('calls in flight when the core dies fail promptly instead of hanging', async () => {
  mobius = await launch(fixture.origin + '/');
  await expect(indicator()).toHaveText('Core ready');
  await crashCore(mobius.app);
  await expect(coreCall(mobius.app, 'core.ping')).rejects.toThrow(/core/i);
  await expect(indicator()).toHaveText('Core ready', { timeout: 15_000 });
});

test('the page-facing shell can read the core status but cannot call the core', async () => {
  mobius = await launch(fixture.origin + '/');
  await expect(indicator()).toHaveText('Core ready');
  const surface = await mobius.shell.evaluate(() => ({
    core: Object.keys((window as unknown as { mobius: { core: object } }).mobius.core).sort(),
    top: Object.keys((window as unknown as { mobius: object }).mobius).sort(),
  }));
  expect(surface.core).toEqual(['getStatus', 'onStatus']);
  expect(surface.top).toEqual(['agent', 'app', 'appearance', 'bookmarks', 'bots', 'browser', 'calendar', 'changes', 'context', 'core', 'downloads', 'history', 'memory', 'menu', 'mini', 'models', 'notes', 'platform', 'preferences', 'profiles', 'providers', 'schedules', 'share', 'surface', 'tasks', 'tray', 'window']);
});

test('without a core binary the shell still works and says the core is unavailable', async () => {
  mobius = await launch(fixture.origin + '/', { env: { MOBIUS_CORE_BIN: path.join(os.tmpdir(), 'no-such-mobius-cored.exe') } });
  await expect(indicator()).toHaveText('Core unavailable');
  await expect(mobius.shell.locator('.tab-title')).toHaveText(['Fixture home']);
  await mobius.shell.getByRole('textbox', { name: 'Address or question' }).fill(fixture.origin.replace('http://', '') + '/second');
  await mobius.shell.getByRole('textbox', { name: 'Address or question' }).press('Enter');
  await expect(mobius.shell.locator('.tab-title')).toHaveText(['Second page']);
});

test('quitting the app also ends the core process', async () => {
  mobius = await launch(fixture.origin + '/');
  await expect(indicator()).toHaveText('Core ready');
  const pid = (await corePid(mobius.app))!;
  expect(() => process.kill(pid, 0)).not.toThrow();
  await mobius.close();
  mobius = undefined;
  await expect.poll(() => { try { process.kill(pid, 0); return 'alive'; } catch { return 'gone'; } }, { timeout: 10_000 }).toBe('gone');
});

test('approvals made with "always" are still there after quitting and starting the app again', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-e2e-keep-'));
  try {
    mobius = await launch(fixture.origin + '/', { userData });
    await expect(indicator()).toHaveText('Core ready');
    const asked = await invoke('demo.echo');
    await coreCall(mobius.app, 'permissions.resolve', { request_id: asked.request_id, approve: true, duration: 'always' });
    await mobius.close({ keepUserData: true });
    mobius = await launch(fixture.origin + '/', { userData });
    await expect(indicator()).toHaveText('Core ready');
    expect((await invoke('demo.echo')).status).toBe('completed');
  } finally {
    await mobius?.close();
    mobius = undefined;
    removeTestData(userData);
  }
});
