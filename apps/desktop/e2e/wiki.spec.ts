import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
const memory = () => path.join(userData, 'memory.md');
const shared = () => path.join(userData, 'workspace', 'wiki', 'Shared', 'Shared notes.md');

test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-wiki-'));
  fs.writeFileSync(memory(), '# What Mobius remembers\n\n- Answers mail in the morning <!-- prefs · Mail -->\n- Vegetarian <!-- you · you added it -->\n');
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

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(shell().getByRole('textbox', { name: 'Message Mobius' })).toBeEnabled({ timeout: 15_000 });
}
async function openWiki(): Promise<void> {
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Wiki');
  await shell().keyboard.press('Enter');
}

test('How I work is what Mobius remembers: what it learned is dashed until Keep, Not true forgets it, and both undo', async () => {
  await start();
  await openWiki();
  const page = shell().getByRole('region', { name: 'How I work' });
  await expect(page).toContainText('Only you and your Mobius see this page.');
  const learned = page.getByRole('listitem', { name: 'Answers mail in the morning, Mobius learned this' });
  await expect(learned).toHaveAttribute('data-proposed');
  await expect(learned).toContainText('Mobius learned this · Mail');
  await expect(page.getByRole('listitem', { name: 'Vegetarian', exact: true })).not.toHaveAttribute('data-proposed');

  await learned.getByRole('button', { name: 'Keep' }).click();
  await expect(page.getByRole('listitem', { name: 'Answers mail in the morning', exact: true })).toBeVisible();
  await expect.poll(() => fs.readFileSync(memory(), 'utf8')).toContain('- Answers mail in the morning <!-- prefs · Mail · kept -->');
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(learned).toBeVisible();

  await learned.getByRole('button', { name: 'Not true' }).click();
  await expect(learned).toHaveCount(0);
  await expect.poll(() => fs.readFileSync(memory(), 'utf8')).not.toContain('Answers mail');
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(learned).toBeVisible();
  await expect.poll(() => fs.readFileSync(memory(), 'utf8')).toContain('- Answers mail in the morning <!-- prefs · Mail -->');
});

test('a line shared from How I work waits in Shared with this wiki: Edit first, Keep, Decline, and Undo', async () => {
  await start();
  await openWiki();
  const mine = shell().getByRole('region', { name: 'How I work' });
  await mine.getByRole('listitem', { name: 'Vegetarian', exact: true }).getByRole('button', { name: 'Share' }).click();
  await expect(mine.getByRole('status')).toContainText('Shared “Vegetarian” with this wiki');
  const side = shell().getByRole('navigation', { name: 'Wiki' });
  await expect(side.getByRole('button', { name: /Shared with this wiki/ })).toContainText('1');
  await side.getByRole('button', { name: /Shared with this wiki/ }).click();
  const queue = shell().getByRole('region', { name: 'Shared with this wiki' });
  const change = queue.getByRole('listitem', { name: 'From your wiki: Vegetarian' });
  await expect(change).toHaveAttribute('data-proposed');
  await change.getByRole('button', { name: 'Edit first' }).click();
  await change.getByRole('textbox', { name: 'Edit the line' }).fill('Vegetarian, no fish');
  await change.getByRole('button', { name: 'Keep' }).click();
  await expect(queue.getByRole('status')).toContainText('Kept on Shared notes.');
  await expect.poll(() => fs.existsSync(shared()) && fs.readFileSync(shared(), 'utf8')).toContain('- Vegetarian, no fish');
  await queue.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(change).toBeVisible();
  await expect.poll(() => fs.readFileSync(shared(), 'utf8')).not.toContain('Vegetarian');
  await change.getByRole('button', { name: 'Decline' }).click();
  await expect(change).toHaveCount(0);
  await queue.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(change).toBeVisible();
});

test('a wiki page keeps its earlier versions from the checkpoints, and one can be put back', async () => {
  const page = path.join(userData, 'workspace', 'wiki', 'Pages', 'Team rules.md');
  fs.mkdirSync(path.dirname(page), { recursive: true });
  fs.writeFileSync(page, '# Team rules\n\nBuilds start on Mondays.\n');
  await start([says(['Noted.'])]);
  // A turn starts with a checkpoint of the workspace, so this version of the page is kept.
  await shell().getByRole('textbox', { name: 'Message Mobius' }).fill('hello');
  await shell().getByRole('textbox', { name: 'Message Mobius' }).press('Enter');
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toContainText('Noted.');
  // The turn's checkpoints are taken in the background: wait until the turn has its end.
  await expect.poll(() => shell().evaluate(async () => {
    const m = (window as unknown as { mobius: { changes: { turns(c: string): Promise<{ ok: boolean; turns?: { end: string | null }[] }> } } }).mobius;
    const r = await m.changes.turns(window.localStorage.getItem('mobius.conversation') ?? '');
    return r.ok && (r.turns ?? []).some((t) => t.end !== null);
  }), { timeout: 15_000 }).toBe(true);
  fs.writeFileSync(page, '# Team rules\n\nBuilds start on Tuesdays.\n');
  await openWiki();
  await shell().getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /Team rules/ }).click();
  await expect(shell().getByRole('textbox', { name: 'Document text' })).toContainText('Tuesdays');
  await shell().getByRole('button', { name: 'Versions' }).click();
  const versions = shell().getByRole('region', { name: 'Versions' });
  await versions.getByRole('listitem').first().getByRole('button').click();
  await expect(versions.getByLabel('That version')).toContainText('Builds start on Mondays.');
  await versions.getByRole('button', { name: 'Put this version back' }).click();
  await expect.poll(() => fs.readFileSync(page, 'utf8'), { timeout: 10_000 }).toContain('Mondays');
});
