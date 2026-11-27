import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { launch, openSettings, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { says, startModel, type ModelFixture } from './model-fixture';

/** A speech server on this computer, in OpenAI's audio format, as faster-whisper and Kokoro serve it. */
interface SpeechServer { url: string; heard: Array<{ path: string; type: string; text: string }>; close: () => Promise<void> }
// A tenth of a second of silence, as a WAV: enough for the window to play.
const SILENCE = (() => {
  const samples = 800;
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples * 2, 40);
  return b;
})();
async function startSpeechServer(transcript: string): Promise<SpeechServer> {
  const heard: SpeechServer['heard'] = [];
  const server = http.createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => parts.push(c));
    req.on('end', () => {
      const body = Buffer.concat(parts);
      heard.push({ path: req.url ?? '', type: String(req.headers['content-type'] ?? ''), text: body.toString('latin1').slice(0, 4000) });
      if (req.url === '/v1/audio/transcriptions') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ text: transcript })); return; }
      if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [] })); return; }
      if (req.url === '/v1/audio/speech') { res.writeHead(200, { 'content-type': 'audio/wav' }); res.end(SILENCE); return; }
      res.writeHead(404); res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, heard, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

let fixture: Fixture;
let model: ModelFixture | undefined;
let speech: SpeechServer | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-voice-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await speech?.close();
  speech = undefined;
  await fixture.close();
  removeTestData(userData);
});

const shell = () => mobius!.shell;
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });

/** Mobius with a speech server on this computer chosen for listening and speaking, in Settings, Models. */
async function start(prefs: Record<string, unknown>): Promise<void> {
  speech = await startSpeechServer('book the terrace for Friday');
  model = await startModel([says(['The terrace is booked for Friday.'])]);
  fs.writeFileSync(path.join(userData, 'preferences.json'), JSON.stringify({ agentPrivateUrls: true, approvalMode: 'manual', listenWith: 'local', listenUrl: speech.url, speakWith: 'local', speakUrl: speech.url, ...prefs }));
  mobius = await launch(fixture.origin + '/', { userData, openMobius: true, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'chat-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
}

test('dictation listens with the speech server chosen in Voice and puts the words in the box, not sent', async () => {
  await start({});
  await composer().press('Control+Shift+Space');
  await expect(shell().getByRole('status', { name: /Listening/ })).toBeVisible();
  await shell().waitForTimeout(700);
  await shell().getByRole('button', { name: 'Stop dictation' }).click();
  await expect(composer()).toHaveValue('book the terrace for Friday');
  // Through the host to the speech server on this computer, not the chat model's server; and nothing was sent.
  expect(speech!.heard.map((h) => h.path)).toEqual(['/v1/audio/transcriptions']);
  expect(speech!.heard[0]!.type).toMatch(/^multipart\/form-data/);
  expect(model!.requests).toHaveLength(0);
});

test('holding Ctrl+Shift+Space in the Mobius panel listens until let go, and puts the words in the box', async () => {
  await start({});
  await composer().focus();
  await shell().keyboard.down('Control');
  await shell().keyboard.down('Shift');
  await shell().keyboard.down('Space');
  await expect(shell().getByRole('status', { name: /Listening/ })).toBeVisible();
  await shell().waitForTimeout(700);
  await shell().keyboard.up('Space');
  await shell().keyboard.up('Shift');
  await shell().keyboard.up('Control');
  await expect(composer()).toHaveValue('book the terrace for Friday');
  expect(speech!.heard.map((h) => h.path)).toEqual(['/v1/audio/transcriptions']);
  expect(model!.requests).toHaveLength(0);
});

test('Speak reads a reply with the speech server chosen in Voice; Read replies aloud reads new ones by itself', async () => {
  await start({ readAloud: true });
  await composer().fill('Book the terrace');
  await composer().press('Enter');
  const log = shell().getByRole('log', { name: 'Conversation' });
  await expect(log.locator('.msg.assistant')).toHaveText('The terrace is booked for Friday.');
  // Read replies aloud: the new reply went to the speech server by itself.
  await expect.poll(() => speech!.heard.filter((h) => h.path === '/v1/audio/speech').length).toBe(1);
  expect(speech!.heard.find((h) => h.path === '/v1/audio/speech')!.text).toContain('The terrace is booked for Friday.');
  // Speak on the reply asks again.
  await log.getByRole('button', { name: /Read aloud|Stop reading/ }).first().click();
  await expect.poll(() => speech!.heard.filter((h) => h.path === '/v1/audio/speech').length).toBeGreaterThanOrEqual(1);
});

test('with nothing chosen to speak, Speak says so and offers Voice settings', async () => {
  await start({ speakWith: 'off', readAloud: false });
  await composer().fill('Book the terrace');
  await composer().press('Enter');
  const log = shell().getByRole('log', { name: 'Conversation' });
  await expect(log.locator('.msg.assistant')).toHaveText('The terrace is booked for Friday.');
  await log.getByRole('button', { name: 'Read aloud' }).click();
  await expect(log.getByRole('alert')).toContainText('Speaking is off');
  await log.getByRole('button', { name: 'Voice settings' }).click();
  await expect(shell().locator('.toolbar-sub')).toHaveText('Models');
  await expect(shell().locator('.settings-group[aria-label="Speaking"]')).toBeInViewport();
  // Only Voice's own check of the server on this computer; nothing was read aloud.
  expect(speech!.heard.filter((h) => !h.path.endsWith('/models'))).toHaveLength(0);
});

test('Voice, This computer says whether a speech server answers at the saved address', async () => {
  await start({});
  await openSettings(shell());
  await shell().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Models', exact: true }).click();
  const status = shell().getByTestId('voice-local-listen');
  await expect(status).toHaveText(`Ready: the speech server at ${speech!.url} answers.`);
  // Once it stops, coming back says so, and how to start one. Nothing is installed.
  await speech!.close();
  speech = undefined;
  await shell().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'General', exact: true }).click();
  await shell().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Models', exact: true }).click();
  await expect(status).toContainText('Not running at');
  await expect(status).toContainText('faster-whisper');
});

test('a meeting recorded in a note is written down in the page, and Fill in my notes is put to Mobius, not sent', async () => {
  await start({});
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Notes');
  await shell().keyboard.press('Enter');
  const side = shell().getByRole('complementary', { name: 'Notebooks' });
  await side.getByRole('button', { name: 'New notebook' }).first().click();
  await side.getByRole('textbox', { name: 'Notebook name' }).fill('Work');
  await side.getByRole('button', { name: 'Create' }).click();
  const format = shell().getByRole('toolbar', { name: 'Format' });
  await format.getByRole('button', { name: 'Insert' }).click();
  await shell().getByRole('menu', { name: 'Insert' }).getByRole('menuitem', { name: 'Record a meeting' }).click();
  const end = format.getByRole('button', { name: /^End meeting/ });
  await expect(end).toBeVisible();
  await shell().waitForTimeout(1200);
  await end.click();
  const page = shell().getByRole('textbox', { name: 'Note text' });
  await expect(page.getByRole('heading', { level: 2 })).toContainText('Meeting');
  await expect(page.getByRole('heading', { name: 'Transcript' })).toBeVisible();
  await expect(page).toContainText('book the terrace for Friday');
  expect(speech!.heard.filter((h) => h.path === '/v1/audio/transcriptions')).toHaveLength(1);
  // Filling in the notes and the actions are asked of Mobius in its box, ready to send; nothing went to the model yet.
  await shell().getByRole('button', { name: 'Fill in my notes' }).click();
  await expect(composer()).toHaveValue(/Add each action to Tasks/);
  expect(model!.requests).toHaveLength(0);
});

test('Record meeting on a calendar event opens its page in Meetings, says which event it was, and listens', async () => {
  const d = new Date();
  const today = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const iso = `${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6)}`;
  fs.mkdirSync(path.join(userData, 'workspace', 'calendar'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace', 'calendar', 'Work.ics'), `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Other//EN\r\nBEGIN:VEVENT\r\nUID:budget\r\nDTSTART:${today}T110000\r\nDTEND:${today}T120000\r\nSUMMARY:Budget review\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
  await start({});
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Calendar');
  await shell().keyboard.press('Enter');
  const cal = shell().locator('.calendar-page');
  await shell().getByRole('group', { name: 'Calendar' }).getByRole('radio', { name: 'Week' }).click();
  await cal.getByRole('button', { name: /^Budget review/ }).first().click({ button: 'right' });
  await shell().getByRole('menu', { name: 'Budget review' }).getByRole('menuitem', { name: 'Record meeting' }).click();
  const note = shell().getByRole('textbox', { name: 'Note text' });
  await expect(note.locator('h1')).toHaveText(`${iso} Budget review`);
  await expect(note).toContainText('Calendar: Work');
  const end = shell().getByRole('toolbar', { name: 'Format' }).getByRole('button', { name: /^End meeting/ });
  await expect(end).toBeVisible();
  await shell().waitForTimeout(1200);
  await end.click();
  await expect(note).toContainText('book the terrace for Friday');
  const kept = path.join(userData, 'workspace', 'notes', 'Meetings', `${iso} Budget review.md`);
  await expect.poll(() => (fs.existsSync(kept) ? fs.readFileSync(kept, 'utf8') : '')).toContain('### Transcript');
});

test('a meeting starting on the calendar is offered for recording, and Record opens its note and listens', async () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const at = `${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const iso = `${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6)}`;
  fs.mkdirSync(path.join(userData, 'workspace', 'calendar'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace', 'calendar', 'Work.ics'), `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Other//EN\r\nBEGIN:VEVENT\r\nUID:standup\r\nDTSTART:${today}T${at}\r\nDURATION:PT15M\r\nSUMMARY:Standup\r\nLOCATION:Room 4\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
  await start({});
  const nudge = shell().getByRole('status').filter({ hasText: 'Standup is starting' });
  await expect(nudge).toBeVisible();
  // It never takes focus: the page keeps what it had.
  expect(await shell().evaluate(() => document.activeElement?.closest('.ui-undo') ?? null)).toBeNull();
  await nudge.getByRole('button', { name: 'Record' }).click();
  await expect(nudge).toBeHidden();
  const note = shell().getByRole('textbox', { name: 'Note text' });
  await expect(note.locator('h1')).toHaveText(`${iso} Standup`);
  await expect(shell().getByRole('toolbar', { name: 'Format' }).getByRole('button', { name: /^End meeting/ })).toBeVisible();
});

test('Listen in Notes reads the open page aloud with whoever speaks, in parts, and with nothing set up says how to set it up', async () => {
  fs.mkdirSync(path.join(userData, 'workspace', 'notes', 'Home'), { recursive: true });
  const long = Array.from({ length: 14 }, (_, i) => `Sentence ${i + 1} is about the garden and the tulips by the wall.`).join(' ');
  fs.writeFileSync(path.join(userData, 'workspace', 'notes', 'Home', 'Garden.md'), `# Garden\n\nPlant the **tulips** before the frost.\n\n${long}\n`);
  await start({});
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('frost');
  await shell().getByRole('option', { name: /^Garden/ }).click();
  await expect(shell().getByRole('textbox', { name: 'Note text' })).toContainText('tulips before the frost');
  // Nothing is read until Listen is pressed.
  expect(speech!.heard.filter((h) => h.path === '/v1/audio/speech')).toHaveLength(0);
  await shell().getByRole('button', { name: 'Listen', exact: true }).click();
  // The page as words, without its Markdown, in parts of at most 500 characters: the first is asked for alone.
  await expect.poll(() => speech!.heard.filter((h) => h.path === '/v1/audio/speech').length).toBeGreaterThanOrEqual(2);
  const said = speech!.heard.filter((h) => h.path === '/v1/audio/speech').map((h) => JSON.parse(h.text).input as string);
  expect(said[0]).toContain('Garden. Plant the tulips before the frost.');
  expect(said.join(' ')).not.toContain('**');
  expect(said.every((s) => s.length <= 500)).toBe(true);

  // With speaking off, Listen says so and opens Settings, Models at Speaking.
  await shell().evaluate(() => window.mobius.preferences.set({ speakWith: 'off' }));
  const listen = shell().locator('[data-listen]');
  if ((await listen.getAttribute('aria-label')) !== 'Listen') await listen.click();
  await expect(listen).toHaveAttribute('aria-label', 'Listen');
  await listen.click();
  await expect(shell().locator('.listen-problem')).toContainText('Speaking is off');
  await shell().getByRole('button', { name: 'Set up speaking' }).click();
  await expect(shell().locator('.toolbar-sub')).toHaveText('Models');
});
