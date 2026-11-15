import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData, openSettings } from './harness';
import { fakeLlama, patterned, startHub, type FakeHub, type FakeRepo } from './hub-fixture';
import { says, startModel, type ModelFixture } from './model-fixture';

let fixture: Fixture;
let hub: FakeHub | undefined;
let mobius: Launched | undefined;
let model: ModelFixture | undefined;

test.beforeEach(async () => {
  fixture = await startFixture();
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await hub?.close();
  hub = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
});

const repos = (): FakeRepo[] => [
  { id: 'acme/Tiny-1B-GGUF', downloads: 5000, files: [{ path: 'Tiny-1B-Q4_K_M.gguf', bytes: patterned(300_000) }, { path: 'Tiny-1B-Q8_0.gguf', bytes: patterned(500_000) }, { path: 'Tiny-1B-draft-Q8_0.gguf', bytes: patterned(900) }] },
  { id: 'acme/Voice-GGUF', pipeline_tag: 'text-to-speech', files: [{ path: 'Voice-Q8_0.gguf', bytes: patterned(1000) }] },
  { id: 'other/Coder-3B-GGUF', downloads: 300, files: [{ path: 'Coder-3B-Q4_K_M.gguf', bytes: patterned(400_000) }] },
];

/** The same computer on every machine: a graphics card with 8 GB, and 32 GB memory. What fits depends on it. */
const GB = 1e9;
const PRETEND_COMPUTER = JSON.stringify({ gpu_name: 'Test GPU', vram_total: 8 * GB, vram_free: 7 * GB, ram_total: 32 * GB, ram_free: 24 * GB });

async function start(options: { slowMs?: number; down?: number; llama?: string | null; userData?: string; repoList?: FakeRepo[]; agent?: Record<string, string> } = {}): Promise<Launched> {
  hub = await startHub(options.repoList ?? repos(), { ...(options.slowMs ? { slowMs: options.slowMs } : {}), ...(options.down ? { down: options.down } : {}) });
  const llama = options.llama === undefined ? fakeLlama() : options.llama;
  mobius = await launch(fixture.origin + '/', {
    env: { ...options.agent, MOBIUS_TEST_HUB: hub.url, MOBIUS_TEST_HARDWARE: PRETEND_COMPUTER, ...(llama ? { MOBIUS_TEST_LLAMA: llama } : { MOBIUS_TEST_LLAMA: 'C:/no/such/llama-server.exe' }) },
    ...(options.userData ? { userData: options.userData } : {}),
  });
  return mobius;
}
const shell = () => mobius!.shell;
const page = (): Locator => shell().getByRole('region', { name: 'Settings' });
const openLocal = async () => {
  await openSettings(shell());
  await shell().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Models', exact: true }).click();
  await page().getByRole('tab', { name: 'This computer', exact: true }).click();
};
const closeSettings = () => shell().keyboard.press('Escape');
const results = () => page().getByRole('list', { name: 'Model results' });
const mine = () => page().getByRole('list', { name: 'Models on this computer' });
const suggest = () => page().getByRole('button', { name: 'Suggest for this computer' }).click();

test('the page describes the computer and starts out empty', async () => {
  await start();
  await openLocal();
  await expect(page().getByText('Test GPU, 8.0 GB graphics memory (7.0 GB free). 32.0 GB memory (24.0 GB free).')).toBeVisible();
  await expect(page().getByText('Nothing is running.')).toBeVisible();
  await expect(page().getByText('No models yet.')).toBeVisible();
  await expect(page().getByText(/No engine yet/)).toHaveCount(0);
});

test('without llama.cpp the page says so and nothing can be run', async () => {
  await start({ llama: null });
  await openLocal();
  await expect(page().getByText(/No engine yet/)).toBeVisible();
});

test('suggestions come from Hugging Face, skip what is not a chat model or a helper file, and say how each would run', async () => {
  await start();
  await openLocal();
  await suggest();
  await expect(results().getByRole('listitem')).toHaveCount(2);
  await expect(results()).toContainText('acme/Tiny-1B-GGUF');
  await expect(results()).toContainText('other/Coder-3B-GGUF');
  await expect(results()).not.toContainText('Voice');
  await expect(results().getByRole('listitem').first()).toContainText(/Fits on your GPU|Slower|CPU only/);
  await expect(results().getByRole('listitem').filter({ hasText: 'acme/Tiny-1B-GGUF' })).toContainText('Q8_0');
  expect(hub!.requests.some((r) => r.includes('sort=trendingScore'))).toBe(true);
});

test('searching sends the words typed and shows only matching models', async () => {
  await start();
  await openLocal();
  await page().getByLabel('Search Hugging Face').fill('coder');
  await page().getByRole('button', { name: 'Search', exact: true }).click();
  await expect(results().getByRole('listitem')).toHaveCount(1);
  await expect(results()).toContainText('other/Coder-3B-GGUF');
  expect(hub!.requests.some((r) => r.includes('search=coder'))).toBe(true);
});

test('when Hugging Face is down the page says so', async () => {
  await start({ down: 503 });
  await openLocal();
  await suggest();
  await expect(page().getByRole('alert')).toContainText('503');
});

test('a model is downloaded with progress, checked, and then listed with a Run button', async () => {
  await start({ slowMs: 60 });
  await openLocal();
  await suggest();
  await results().getByRole('button', { name: 'Download Coder-3B-Q4_K_M' }).click();
  const progress = page().getByRole('progressbar', { name: 'Download progress' });
  await expect(progress).toBeVisible();
  await expect(page().getByRole('group', { name: 'Download' })).toContainText('Downloading Coder-3B-Q4_K_M.gguf');
  await expect(mine().getByRole('listitem')).toHaveCount(1, { timeout: 20_000 });
  await expect(mine()).toContainText('Coder-3B-Q4_K_M');
  await expect(mine()).toContainText('other/Coder-3B-GGUF');
  await expect(results().getByRole('listitem').filter({ hasText: 'other/Coder-3B-GGUF' })).toContainText('Downloaded');
  await expect(mine().getByRole('button', { name: 'Run Coder-3B-Q4_K_M' })).toBeEnabled();
  const stored = path.join(mobius!.userData, 'models', 'models--other--Coder-3B-GGUF', 'snapshots', 'main', 'Coder-3B-Q4_K_M.gguf');
  expect(fs.statSync(stored).size).toBe(400_000);
});

test('a download can be cancelled and leaves no model behind', async () => {
  await start({ slowMs: 150, repoList: [{ id: 'other/Coder-3B-GGUF', files: [{ path: 'Coder-3B-Q4_K_M.gguf', bytes: patterned(6_000_000) }] }] });
  await openLocal();
  await suggest();
  await results().getByRole('button', { name: 'Download Coder-3B-Q4_K_M' }).click();
  await expect(page().getByRole('progressbar')).toBeVisible();
  await page().getByRole('group', { name: 'Download' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page().getByText(/Cancelled/)).toBeVisible();
  await expect(page().getByText('No models yet.')).toBeVisible();
  await expect(results().getByRole('button', { name: 'Download Coder-3B-Q4_K_M' })).toBeEnabled();
});

test('a downloaded model is run, loaded, used by the agent, and stopped', async () => {
  await start();
  await openLocal();
  await suggest();
  await results().getByRole('button', { name: 'Download Tiny-1B-Q8_0' }).click();
  await expect(mine().getByRole('listitem')).toHaveCount(1, { timeout: 20_000 });
  await mine().getByRole('button', { name: 'Run Tiny-1B-Q8_0' }).click();
  const running = page().getByRole('status').filter({ hasText: 'Tiny-1B-Q8_0' });
  await expect(running).toContainText('Ready', { timeout: 20_000 });
  await expect(running).toContainText('The agent is using this model.');
  await expect(mine().getByRole('button', { name: 'Stop Tiny-1B-Q8_0' })).toBeVisible();

  await closeSettings();
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await expect(composer).toBeEnabled({ timeout: 15_000 });
  await composer.fill('hello there');
  await composer.press('Enter');
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('hello', { timeout: 15_000 });

  await openSettings(shell());
  await shell().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Models', exact: true }).click();
  await page().getByRole('tab', { name: 'This computer', exact: true }).click();
  await page().getByRole('button', { name: 'Stop Tiny-1B-Q8_0' }).click();
  await expect(page().getByText('Nothing is running.')).toBeVisible();
});

test('switching to a model on this computer mid-chat keeps the conversation going, and Usage shows it as free', async () => {
  // The demo's Settings moment: the same conversation moves from a hosted model to one on this computer.
  model = await startModel([says(['From the first model.'])]);
  await start({ agent: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  const replies = shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant');
  await expect(composer).toBeEnabled({ timeout: 15_000 });
  await composer.fill('first question');
  await composer.press('Enter');
  await expect(replies).toHaveText(['From the first model.']);

  await openLocal();
  await suggest();
  await results().getByRole('button', { name: 'Download Tiny-1B-Q8_0' }).click();
  await expect(mine().getByRole('listitem')).toHaveCount(1, { timeout: 20_000 });
  await mine().getByRole('button', { name: 'Run Tiny-1B-Q8_0' }).click();
  await expect(page().getByRole('status').filter({ hasText: 'Tiny-1B-Q8_0' })).toContainText('The agent is using this model.', { timeout: 20_000 });
  await closeSettings();

  // The same conversation, now answered on this computer.
  await expect(composer).toBeEnabled({ timeout: 15_000 });
  await composer.fill('second question');
  await composer.press('Enter');
  await expect(replies).toHaveText(['From the first model.', 'hello'], { timeout: 15_000 });

  await openSettings(shell());
  await shell().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Usage', exact: true }).click();
  await expect(page().getByRole('region', { name: 'Totals' })).toContainText(/Requests\s*2(?!\d)/, { timeout: 10_000 });
  const byModel = page().getByRole('table', { name: 'Usage by model' });
  await expect(byModel).toContainText('fake-model');
  const local = byModel.getByRole('row').filter({ hasText: 'Tiny-1B' });
  await expect(local).toHaveCount(1);
  await expect(local.getByRole('cell').last()).toHaveText('Free');
});

test('the context size chosen in settings is the one the model is started with', async () => {
  await start();
  await openLocal();
  await suggest();
  await results().getByRole('button', { name: 'Download Tiny-1B-Q8_0' }).click();
  await expect(mine().getByRole('listitem')).toHaveCount(1, { timeout: 20_000 });
  await page().getByRole('combobox', { name: 'Context size' }).selectOption('32768');
  await expect.poll(() => shell().evaluate(() => window.mobius.preferences.get().then((p) => p?.localContext))).toBe(32768);
  await mine().getByRole('button', { name: 'Run Tiny-1B-Q8_0' }).click();
  const running = page().getByRole('status').filter({ hasText: 'Tiny-1B-Q8_0' });
  await expect(running).toContainText('Ready', { timeout: 20_000 });
  await running.getByText('Details').click();
  await expect(running.locator('pre')).toContainText('context=32768');
});

test('a model downloaded earlier is still there after a restart', async () => {
  await start();
  await openLocal();
  await suggest();
  await results().getByRole('button', { name: 'Download Coder-3B-Q4_K_M' }).click();
  await expect(mine().getByRole('listitem')).toHaveCount(1, { timeout: 20_000 });
  const userData = mobius!.userData;
  await mobius!.close({ keepUserData: true });
  await hub?.close();
  hub = undefined;
  await start({ userData });
  await openLocal();
  await expect(mine().getByRole('listitem')).toHaveCount(1);
  await expect(mine()).toContainText('Coder-3B-Q4_K_M');
});

test('one button installs nothing it does not need, picks a model that fits, downloads it and starts it for the agent', async () => {
  await start();
  await openLocal();
  await page().getByRole('button', { name: 'Set it up for me' }).click();
  await expect(page().getByLabel('Setup progress')).toHaveText('Ready. The agent is using it.', { timeout: 30_000 });
  const running = page().locator('.running');
  await expect(running).toContainText('Ready', { timeout: 30_000 });
  await expect(running).toContainText('The agent is using this model.');
  // Exactly one model was fetched, and it is the one running.
  await expect(mine().getByRole('listitem')).toHaveCount(1);
  expect(new Set(hub!.requests.filter((r) => r.includes('/resolve/')).map((r) => r.split('?')[0])).size).toBe(1);
  await closeSettings();
  const composer = shell().getByRole('textbox', { name: 'Message Mobius' });
  await composer.fill('hello there');
  await composer.press('Enter');
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('hello', { timeout: 15_000 });
});

test('a model can start again by itself when Mobius opens', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-autostart-'));
  try {
    await start({ userData });
    await openLocal();
    await suggest();
    await results().getByRole('button', { name: 'Download Tiny-1B-Q8_0' }).click();
    await expect(mine().getByRole('listitem')).toHaveCount(1, { timeout: 20_000 });
    await mine().getByRole('button', { name: 'Run Tiny-1B-Q8_0' }).click();
    const running = () => page().getByRole('status').filter({ hasText: 'Tiny-1B-Q8_0' });
    await expect(running()).toContainText('Ready', { timeout: 20_000 });
    await page().getByRole('switch', { name: 'Start it when Mobius opens' }).click();
    await expect(page().getByRole('switch', { name: 'Start it when Mobius opens' })).toBeChecked();
    await mobius!.close({ keepUserData: true });
    await hub!.close();
    await start({ userData });
    await openLocal();
    await expect(running()).toContainText('Ready', { timeout: 30_000 });
    await expect(page().getByRole('switch', { name: 'Start it when Mobius opens' })).toBeChecked();
  } finally {
    await mobius?.close();
    mobius = undefined;
    removeTestData(userData);
  }
});

test('Models has a row for each job: chat, quick, listen and speak, and voice choices are the same as in Voice', async () => {
  await start();
  await openSettings(shell());
  await shell().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Models', exact: true }).click();
  for (const title of ['Chat model', 'Quick model', 'Listen', 'Speak']) await expect(page().getByRole('heading', { name: title, exact: true }).or(page().getByText(title, { exact: true })).first()).toBeVisible();
  await page().getByRole('combobox', { name: 'Speak with' }).selectOption({ label: 'ElevenLabs' });
  await expect(page().getByText('Voice: ElevenLabs')).toBeVisible();
  await expect.poll(async () => (await shell().evaluate(() => window.mobius.preferences.get())).speakWith).toBe('elevenlabs');
});

test('Images offers nothing until a gateway that makes pictures has a key', async () => {
  await start();
  await openSettings(shell());
  await shell().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Models', exact: true }).click();
  await expect(page().getByRole('combobox', { name: 'Image model' })).toHaveValue('none');
  await expect(page().getByText(/Add a key for OpenAI, OpenRouter/)).toBeVisible();
});
