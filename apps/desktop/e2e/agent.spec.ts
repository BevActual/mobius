import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { coreCall, coreHistory, crashCore, launch, startFixture, type Fixture, type Launched } from './harness';
import { callsTool, dataOf, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;

test.beforeEach(async () => {
  fixture = await startFixture();
});
test.afterEach(async ({}, testInfo) => {
  // A rare stall on the first turn: what the core did and what the model was asked, to see where it waited.
  if (testInfo.status !== testInfo.expectedStatus && mobius) {
    const history = await coreHistory(mobius.app).catch((e: unknown) => [`(no history: ${String(e)})`]);
    console.log(`[${testInfo.title}] model requests: ${model?.requests.length ?? 0}\ncore history:\n${history.join('\n')}`);
  }
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
});

/** Start the app with a pretend model already set up, so the conversation can be used straight away. */
async function start(replies: ModelReply[], env: Record<string, string> = {}, userData?: string): Promise<Launched> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model', ...env }, ...(userData ? { userData } : {}) });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  return mobius;
}
const composer = (): Locator => mobius!.shell.getByRole('textbox', { name: 'Message Mobius' });
const log = (): Locator => mobius!.shell.getByRole('log', { name: 'Conversation' });
const say = async (text: string) => {
  // A message typed while the previous turn is still finishing is not sent, so wait for it to end.
  await expect(mobius!.shell.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await composer().fill(text);
  await composer().press('Enter');
};

test('a message gets a streamed answer, and the model sees the system prompt and the question', async () => {
  await start([says(['Hello ', 'from ', 'the model.'], 60)]);
  await say('Say hello');
  await expect(log().locator('.msg.user')).toHaveText('Say hello');
  await expect(log().locator('.msg.assistant')).toHaveText('Hello from the model.');
  await expect(composer()).toBeEnabled();
  await expect(mobius!.shell.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  const body = model!.requests[0]!;
  expect(body.model).toBe('fake-model');
  const messages = body.messages as Array<{ role: string; content: string }>;
  expect(messages[0]!.role).toBe('system');
  // Just the question: the page open in the browser goes only when added.
  expect(messages.at(-1)).toEqual({ role: 'user', content: 'Say hello' });
  // And the standing instructions: say what changed from what the tools gave back.
  expect(messages[0]!.content).toContain('never report a change');
});

test('Enter sends, Shift+Enter adds a line, and a blank message cannot be sent', async () => {
  await start([says(['ok'])]);
  await composer().press('Enter');
  await expect(log().locator('.msg')).toHaveCount(0);
  await expect(mobius!.shell.getByRole('button', { name: 'Send' })).toBeDisabled();
  await composer().fill('line one');
  await composer().press('Shift+Enter');
  await composer().pressSequentially('line two');
  expect(await composer().inputValue()).toBe('line one\nline two');
  await composer().press('Enter');
  await expect(log().locator('.msg.user')).toHaveText('line one\nline two');
  await expect(composer()).toHaveValue('');
});

test('a question typed into the address bar goes to the agent instead of the web', async () => {
  await start([says(['Because physics.'])]);
  const address = mobius!.shell.getByRole('textbox', { name: 'Address or question' });
  await address.fill('why is the sky blue?');
  await address.press('Enter');
  await expect(log().locator('.msg.user')).toHaveText('why is the sky blue?');
  await expect(log().locator('.msg.assistant')).toHaveText('Because physics.');
  expect(fixture.hits.filter((h) => h.includes('sky'))).toEqual([]);
});

test('a tool call stops for approval, shows what will run, and carries on when allowed once', async () => {
  await start([callsTool('clock-now'), says(['It is noon.']), callsTool('clock-now'), says(['Still noon.'])]);
  await say('what time is it');
  const card = mobius!.shell.getByRole('group', { name: 'Approval needed: clock.now' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Mobius wants to check the time.');
  await expect(card.locator('.approval-text')).toHaveAttribute('title', 'clock.now');
  expect(model!.requests).toHaveLength(1);
  await card.getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('It is noon.');
  await expect(card).toHaveCount(0);
  // The row reads as a sentence where there is one; the tool's own name is its tooltip.
  await expect(log().locator('.tool .tool-name')).toHaveAttribute('title', 'clock.now');
  const second = model!.requests[1]!.messages as Array<{ role: string; content: string }>;
  const result = second.find((m) => m.role === 'tool')!;
  expect(JSON.parse(dataOf(result.content)).utc).toMatch(/^20\d\d-\d\d-\d\dT/);

  await say('and now?');
  await expect(mobius!.shell.getByRole('group', { name: 'Approval needed: clock.now' })).toBeVisible();
});

test('"Always allow" is remembered, so the next use does not ask', async () => {
  await start([callsTool('clock-now'), says(['First.']), callsTool('clock-now'), says(['Second.'])]);
  await say('time');
  await mobius!.shell.getByRole('group', { name: 'Approval needed: clock.now' }).getByRole('button', { name: 'Always allow' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('First.');
  await say('time again');
  await expect(log().locator('.msg.assistant').last()).toHaveText('Second.');
  await expect(mobius!.shell.getByRole('group', { name: /Approval needed/ })).toHaveCount(0);
  // Messages sent close together share one time, above the first.
  await expect(log().locator('.msg-stamp')).toHaveCount(1);
  await expect(log().locator('.msg-stamp')).toHaveText(/^Today \d{1,2}[:.]\d{2}/);
  // The composer says how full the model's window is, once the core has said.
  await expect(mobius!.shell.getByRole('meter', { name: 'Context used' })).toHaveText(/^\d{1,3}%$/);
});

test('declining tells the model, and the tool never runs', async () => {
  await start([callsTool('clock-now'), says(['Understood.'])]);
  await say('time');
  await mobius!.shell.getByRole('group', { name: 'Approval needed: clock.now' }).getByRole('button', { name: 'Decline' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('Understood.');
  await expect(log().locator('.tool')).toContainText('Declined');
  const second = model!.requests[1]!.messages as Array<{ role: string; content: string }>;
  expect(second.find((m) => m.role === 'tool')!.content).toContain('declined');
});

test('Stop ends a reply that is still arriving, and the conversation can continue', async () => {
  await start([says(['one ', 'two ', 'three ', 'four ', 'five ', 'six'], 700), says(['Back again.'])]);
  await say('talk for a while');
  await expect(log().locator('.msg.assistant')).toContainText('one');
  await mobius!.shell.getByRole('button', { name: 'Stop' }).click();
  await expect(mobius!.shell.getByRole('button', { name: 'Send' })).toBeVisible();
  const kept = await log().locator('.msg.assistant').first().textContent();
  await mobius!.shell.waitForTimeout(1500);
  expect(await log().locator('.msg.assistant').first().textContent()).toBe(kept);
  await say('hello again');
  await expect(log().locator('.msg.assistant').last()).toHaveText('Back again.');
});

test('a model error is shown in the conversation and does not wedge it', async () => {
  await start([]); // no replies left: the pretend server answers 500
  await say('hi');
  await expect(log().getByRole('alert')).toContainText('500');
  await expect(composer()).toBeEnabled();
  expect(await composer().inputValue()).toBe('');
});

test('reloading the window brings the conversation back, including a question still waiting', async () => {
  await start([callsTool('clock-now'), says(['Done.'])]);
  await say('time please');
  const card = mobius!.shell.getByRole('group', { name: /Approval needed/ });
  await expect(card).toBeVisible();
  await mobius!.shell.reload();
  await expect(log().locator('.msg.user')).toHaveText('time please');
  await expect(mobius!.shell.getByRole('group', { name: /Approval needed/ })).toBeVisible();
  await mobius!.shell.getByRole('group', { name: /Approval needed/ }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('Done.');
  await mobius!.shell.reload();
  await expect(log().locator('.msg.assistant')).toHaveText('Done.');
  await expect(log().locator('.msg.user')).toHaveText('time please');
});

test('a new person is welcomed, and chooses how much Mobius does before choosing a model', async () => {
  mobius = await launch(fixture.origin + '/', { newPerson: true });
  await expect(mobius.shell.getByRole('heading', { name: 'Hello.' })).toBeVisible({ timeout: 15_000 });
  const levels = mobius.shell.getByRole('radiogroup', { name: 'How much should Mobius do?' });
  // Review changes is where a new person starts: Mobius changes the workspace, and the changes wait to be kept.
  await expect(levels.getByRole('radio', { name: /^Review changes/ })).toHaveAttribute('aria-checked', 'true');
  await levels.getByRole('radio', { name: /^Auto/ }).click();
  await expect(levels.getByRole('radio', { name: /^Auto/ })).toHaveAttribute('aria-checked', 'true');
  expect((await mobius.shell.evaluate(() => window.mobius.preferences.get())).approvalMode).toBe('smart');
  await expect(mobius.shell.getByRole('form', { name: 'Model settings' })).toBeVisible();
});

test('settings: the model can be set up from the panel, survives a restart, and the key stays out of sight', async () => {
  model = await startModel([says(['Configured.']), says(['Still configured.'])]);
  mobius = await launch(fixture.origin + '/');
  await expect(mobius.shell.getByRole('form', { name: 'Model settings' })).toBeVisible({ timeout: 15_000 });
  await expect(composer()).toHaveCount(0);
  await mobius.shell.getByLabel('Server address').fill(model.url);
  await mobius.shell.getByLabel('Model', { exact: true }).fill('my-model');
  await mobius.shell.getByLabel('API key').fill('sk-very-secret-key');
  await mobius.shell.getByRole('button', { name: 'Save' }).click();
  await expect(composer()).toBeEnabled();
  await say('hi');
  await expect(log().locator('.msg.assistant')).toHaveText('Configured.');
  expect(model.authorization[0]).toBe('Bearer sk-very-secret-key');

  expect(await mobius.shell.evaluate(() => document.documentElement.outerHTML.includes('sk-very-secret-key'))).toBe(false);
  expect(JSON.stringify(await mobius.shell.evaluate(() => window.mobius.agent.getSettings()))).not.toContain('sk-very-secret-key');
  const saved = fs.readFileSync(path.join(mobius.userData, 'agent-settings.json'), 'utf8');
  expect(saved).not.toContain('sk-very-secret-key');
  expect(saved).toContain('my-model');

  const userData = mobius.userData;
  await mobius.close({ keepUserData: true });
  mobius = await launch(fixture.origin + '/', { userData });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  await say('hello again');
  // The earlier conversation is kept across the restart, so both replies are there.
  await expect(log().locator('.msg.assistant')).toHaveText(['Configured.', 'Still configured.']);
  expect(model.authorization[1]).toBe('Bearer sk-very-secret-key');
});

test('settings the core refuses are explained and not saved', async () => {
  mobius = await launch(fixture.origin + '/');
  await expect(mobius.shell.getByRole('form', { name: 'Model settings' })).toBeVisible({ timeout: 15_000 });
  await mobius.shell.getByLabel('Server address').fill('http://example.com/v1');
  await mobius.shell.getByLabel('Model', { exact: true }).fill('m');
  await mobius.shell.getByLabel('API key').fill('k');
  await mobius.shell.getByRole('button', { name: 'Save' }).click();
  await expect(mobius.shell.getByRole('alert')).toContainText('https');
  await expect(composer()).toHaveCount(0);
  expect(fs.existsSync(path.join(mobius.userData, 'agent-settings.json'))).toBe(false);
});

test('if the core restarts, the agent is set up again by itself', async () => {
  await start([says(['Before.']), says(['After.'])]);
  await say('one');
  await expect(log().locator('.msg.assistant')).toHaveText('Before.');
  await crashCore(mobius!.app);
  await expect.poll(async () => (await coreHistory(mobius!.app)).includes('restarting'), { timeout: 15_000 }).toBe(true);
  await expect(mobius!.shell.locator('.core-status')).toHaveText('Core ready', { timeout: 15_000 });
  await expect(composer()).toBeEnabled();
  await say('two');
  await expect(log().locator('.msg.assistant').last()).toHaveText('After.');
});

test('a web page cannot reach the agent, and the shell cannot call the core directly', async () => {
  await start([says(['x'])]);
  const keys = await mobius!.shell.evaluate(() => Object.keys(window.mobius).sort());
  expect(keys).toEqual(['agent', 'app', 'appearance', 'boards', 'bookmarks', 'bots', 'browser', 'calendar', 'changes', 'code', 'comments', 'context', 'core', 'databases', 'designs', 'docs', 'downloads', 'extensions', 'files', 'history', 'mail', 'memory', 'menu', 'mini', 'models', 'notes', 'photos', 'platform', 'preferences', 'profiles', 'projects', 'providers', 'reading', 'research', 'schedules', 'share', 'sheets', 'signins', 'skills', 'slides', 'songs', 'surface', 'tasks', 'terminal', 'tray', 'updates', 'usage', 'video', 'views', 'voice', 'wiki', 'window']);
  const coreKeys = await mobius!.shell.evaluate(() => Object.keys(window.mobius.core).sort());
  expect(coreKeys).toEqual(['getStatus', 'onStatus']);
  const outcomes = await mobius!.shell.evaluate(async () => ({
    badSend: await window.mobius.agent.send('../x', 'hi'),
    blank: await window.mobius.agent.send('main', '   '),
    badResolve: await window.mobius.agent.resolve(-1, true, 'once'),
    badDuration: await window.mobius.agent.resolve(1, true, 'forever' as never),
    badConfigure: await window.mobius.agent.configure({ baseUrl: '', model: '' }),
  }));
  for (const outcome of Object.values(outcomes)) expect(outcome).toMatchObject({ ok: false });
  const tabId = (await mobius!.shell.evaluate(() => window.mobius.browser.getState())).activeId!;
  const seen = await (await import('./harness')).runInPage(mobius!.app, tabId, 'typeof window.mobius + "," + typeof window.require');
  expect(seen).toBe('undefined,undefined');
});

test('while the agent waits for a person, the core still answers other requests', async () => {
  await start([callsTool('clock-now'), says(['Done.'])]);
  await say('time');
  await expect(mobius!.shell.getByRole('group', { name: /Approval needed/ })).toBeVisible();
  const ping = await coreCall<{ protocol: number }>(mobius!.app, 'core.ping');
  expect(ping.protocol).toBe(1);
});

type Chat = Array<{ role: string; content: string }>;
const toolResult = (index: number): Record<string, unknown> | string => {
  const content = dataOf((model!.requests[index]!.messages as Chat).findLast((m) => m.role === 'tool')!.content);
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return content;
  }
};
const tabTitles = () => mobius!.shell.locator('.tab-title');

test('the agent can open a page after you allow that site, and it shows up as a tab', async () => {
  await start([callsTool('browser-open', { url: fixture.origin + '/second' }), says(['Opened it.'])]);
  await say('open the second page');
  const card = mobius!.shell.getByRole('group', { name: 'Approval needed: browser.open' });
  await expect(card).toBeVisible();
  await expect(card).toContainText(fixture.origin + '/second');
  expect(fixture.hits.filter((h) => h.includes('second'))).toEqual([]);
  await card.getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant')).toHaveText('Opened it.');
  await expect(tabTitles()).toHaveText(['Fixture home', 'Second page']);
  expect(fixture.hits).toContain('/second');
  expect(toolResult(1)).toMatchObject({ tabId: expect.stringMatching(/^tab-/), loaded: true, title: 'Second page' });
});

test('allowing a site once covers all its pages when you choose Always, but not another site', async () => {
  const other = 'http://localhost:' + new URL(fixture.origin).port;
  await start([
    callsTool('browser-open', { url: fixture.origin + '/second' }), says(['one']),
    callsTool('browser-open', { url: fixture.origin + '/article' }), says(['two']),
    callsTool('browser-open', { url: other + '/' }), says(['three']),
  ]);
  await say('first');
  await mobius!.shell.getByRole('group', { name: 'Approval needed: browser.open' }).getByRole('button', { name: 'Always allow' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('one');
  await say('second');
  await expect(log().locator('.msg.assistant').last()).toHaveText('two');
  await expect(mobius!.shell.getByRole('group', { name: /Approval needed/ })).toHaveCount(0);
  await expect(tabTitles()).toHaveText(['Fixture home', 'Second page', 'Article']);
  await say('third');
  await expect(mobius!.shell.getByRole('group', { name: 'Approval needed: browser.open' })).toBeVisible();
});

test('reading a page returns its text marked as untrusted, and instructions inside it are not acted on', async () => {
  await start([
    callsTool('browser-open', { url: fixture.origin + '/article' }), says(['opened']),
    callsTool('browser-read', {}), says(['The article is about nothing.']),
  ]);
  await say('open the article');
  await mobius!.shell.getByRole('group', { name: 'Approval needed: browser.open' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('opened');
  // The reply text arrives before the turn is over; a message typed while it is still running is not sent.
  await expect(mobius!.shell.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await say('now read it');
  const card = mobius!.shell.getByRole('group', { name: 'Approval needed: browser.read' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('The article is about nothing.');
  const page = toolResult(3) as Record<string, string>;
  expect(page.title).toBe('Article');
  expect(page.text).toContain('The article');
  expect(page.text).toContain('IGNORE ALL PREVIOUS INSTRUCTIONS');
  expect(page.notice).toMatch(/untrusted/);
  expect((model!.requests[0]!.messages as Chat)[0]!.content).toMatch(/untrusted/);
  await expect(tabTitles()).toHaveText(['Fixture home', 'Article']);
  expect(fixture.hits.some((h) => h.includes('evil'))).toBe(false);
});

test('the agent can list tabs, and addresses that are not plain web addresses never reach you as a question', async () => {
  await start([
    callsTool('browser-tabs'), says(['One tab.']),
    callsTool('browser-open', { url: 'file:///C:/Windows/win.ini' }), says(['That did not work.']),
  ]);
  await say('what is open');
  await mobius!.shell.getByRole('group', { name: 'Approval needed: browser.tabs' }).getByRole('button', { name: 'Allow once' }).click();
  await expect(log().locator('.msg.assistant').last()).toHaveText('One tab.');
  expect(toolResult(1)).toMatchObject([{ title: 'Fixture home', active: true }]);
  await say('open a file');
  await expect(log().locator('.msg.assistant').last()).toHaveText('That did not work.');
  await expect(mobius!.shell.getByRole('group', { name: 'Approval needed: browser.open' })).toHaveCount(0);
  expect(toolResult(3)).toContain('plain http or https address');
  await expect(tabTitles()).toHaveText(['Fixture home']);
});

test('the core still knows the browser tools after it restarts', async () => {
  await start([says(['x']), callsTool('browser-tabs'), says(['ok'])]);
  await say('hi');
  await expect(log().locator('.msg.assistant')).toHaveText('x');
  await crashCore(mobius!.app);
  await expect.poll(async () => (await coreHistory(mobius!.app)).includes('restarting'), { timeout: 15_000 }).toBe(true);
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
  const tools = await coreCall<Array<{ name: string; external: boolean }>>(mobius!.app, 'tools.list');
  expect(tools.filter((t) => t.external).map((t) => t.name)).toEqual(['browser.click', 'browser.open', 'browser.read', 'browser.tabs', 'browser.type', 'calendar.add', 'calendar.free', 'calendar.list', 'calendar.suggest', 'calendar.update', 'code.commit', 'code.output', 'code.push', 'code.run', 'code.start', 'code.stop', 'code.test', 'comments.list', 'comments.reply', 'comments.resolve', 'db.execute', 'db.list', 'db.query', 'files.edit', 'files.list', 'files.move', 'files.read', 'files.search', 'files.write', 'images.generate', 'mail.draft', 'mail.read', 'mail.search', 'memory.forget', 'memory.remember', 'schedules.add', 'schedules.list', 'sheets.list', 'sheets.read', 'sheets.write', 'skills.list', 'skills.read', 'tasks.add', 'tasks.list', 'tasks.update', 'web.read', 'web.search']);
});
