import { expect, test, type Locator } from '@playwright/test';
import { launch, startFixture, type Fixture, type Launched } from './harness';

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

const shell = () => mobius!.shell;
const page = (): Locator => shell().getByRole('region', { name: 'Settings' });
const open = async (tab: string) => {
  await shell().keyboard.press('Control+Comma');
  await expect(page()).toBeVisible();
  await page().getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Model', exact: true }).click();
  await page().getByRole('tab', { name: tab, exact: true }).click();
};

test('choosing a provider fills in its address and says where to get a key', async () => {
  mobius = await launch(fixture.origin + '/');
  await open('Server');
  const address = page().getByLabel('Server address');
  await page().getByLabel('Provider').selectOption('openrouter');
  await expect(address).toHaveValue('https://openrouter.ai/api/v1');
  await expect(page().getByText(/Make a key at openrouter\.ai/)).toBeVisible();
  await page().getByLabel('Provider').selectOption('ollama');
  await expect(address).toHaveValue('http://127.0.0.1:11434/v1');
  await expect(page().getByText(/No key needed/)).toBeVisible();
  await address.fill('https://my.own.example/v1');
  await expect(page().getByLabel('Provider')).toHaveValue('other');
  await address.fill('https://api.groq.com/openai/v1');
  await expect(page().getByLabel('Provider')).toHaveValue('groq');
});

test('the context size for local models is chosen from a list and remembered', async () => {
  mobius = await launch(fixture.origin + '/');
  await open('This computer');
  const size = page().getByRole('combobox', { name: 'Context size' });
  await expect(size).toHaveValue('16384');
  await size.selectOption('32768');
  await expect.poll(() => shell().evaluate(() => window.mobius.preferences.get().then((p) => p?.localContext))).toBe(32768);
  await size.selectOption('4096');
  await expect.poll(() => shell().evaluate(() => window.mobius.preferences.get().then((p) => p?.localContext))).toBe(4096);
});

test('the shell cannot set a context size that is not on the list', async () => {
  mobius = await launch(fixture.origin + '/');
  const after = await shell().evaluate(() => window.mobius.preferences.set({ localContext: 999999 }));
  expect(after?.localContext).toBe(16384);
});
