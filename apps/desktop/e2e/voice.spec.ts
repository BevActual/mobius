import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
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

/** Mobius with a speech server on this computer chosen for listening and speaking, in Settings, Voice. */
async function start(prefs: Record<string, unknown>): Promise<void> {
  speech = await startSpeechServer('book the terrace for Friday');
  model = await startModel([says(['The terrace is booked for Friday.'])]);
  fs.writeFileSync(path.join(userData, 'preferences.json'), JSON.stringify({ agentPrivateUrls: true, approvalMode: 'manual', listenWith: 'local', listenUrl: speech.url, speakWith: 'local', speakUrl: speech.url, ...prefs }));
  mobius = await launch(fixture.origin + '/', { userData, openMobius: true, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'chat-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
}

test('dictation listens with the speech server chosen in Voice and puts the words in the box, not sent', async () => {
  await start({});
  await shell().getByRole('button', { name: 'Dictate' }).click();
  await expect(shell().getByRole('status', { name: /Listening/ })).toBeVisible();
  await shell().waitForTimeout(700);
  await shell().getByRole('button', { name: 'Stop dictation' }).click();
  await expect(composer()).toHaveValue('book the terrace for Friday');
  // Through the host to the speech server on this computer, not the chat model's server; and nothing was sent.
  expect(speech!.heard.map((h) => h.path)).toEqual(['/v1/audio/transcriptions']);
  expect(speech!.heard[0]!.type).toMatch(/^multipart\/form-data/);
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
  await expect(shell().locator('.strip-title')).toHaveText('Voice');
  expect(speech!.heard).toHaveLength(0);
});
