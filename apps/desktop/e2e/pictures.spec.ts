import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startFixture, type Fixture, type Launched, removeTestData } from './harness';
import { says, startModel, type ModelFixture } from './model-fixture';

// A 4 × 4 picture: sky on top, hills below.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAEAgMAAADUn3btAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAJUExURX+z5m+PTv///yURNH0AAAABYktHRAJmC3xkAAAAB3RJTUUH6gsICzIQNf0gTgAAABBJREFUCNdjYGBgYAhlCAUAAVwAq6n8OZAAAAAASUVORK5CYII=', 'base64');

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-pictures-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model?.close();
  model = undefined;
  await fixture.close();
  removeTestData(userData);
});

type Part = { type: string; text?: string; image_url?: { url: string } };
const lastUser = (body: Record<string, unknown>) => (body.messages as Array<{ role: string; content: string | Part[] }>).filter((m) => m.role === 'user').pop()!;

test('a picture attached to a message goes to the model beside the words, and stays in the conversation', async () => {
  model = await startModel([says(['Rolling hills under a blue sky.'])]);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  const shell = mobius.shell;
  const composer = shell.getByRole('textbox', { name: 'Message Mobius' });
  await expect(composer).toBeEnabled({ timeout: 15_000 });
  await shell.getByLabel('Choose pictures').setInputFiles({ name: 'hills.png', mimeType: 'image/png', buffer: PNG });
  const chips = shell.getByRole('list', { name: 'Pictures for this message' });
  await expect(chips.getByRole('img', { name: 'Picture 1' })).toBeVisible();
  await composer.fill('What is in this picture?');
  await composer.press('Enter');
  await expect(shell.getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('Rolling hills under a blue sky.');
  await expect(chips).toHaveCount(0);
  await expect(shell.getByRole('list', { name: 'Pictures attached' }).getByRole('img')).toHaveCount(1);

  const content = lastUser(model.requests[0]!).content as Part[];
  expect(content[0]).toEqual({ type: 'text', text: 'What is in this picture?' });
  expect(content[1]!.type).toBe('image_url');
  expect(content[1]!.image_url!.url).toMatch(/^data:image\/jpeg;base64,/);
});
