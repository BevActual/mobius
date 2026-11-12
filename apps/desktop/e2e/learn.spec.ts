import { expect, test } from '@playwright/test';
import { launch, startFixture, type Fixture, type Launched } from './harness';

let fixture: Fixture;
let mobius: Launched;

test.beforeEach(async () => {
  fixture = await startFixture();
  mobius = await launch(fixture.origin + '/');
});
test.afterEach(async () => {
  await mobius.close();
  await fixture.close();
});

const shell = () => mobius.shell;
const learn = () => shell().getByRole('complementary', { name: 'Learn' });
/** Mobius pinned beside the page (its message box is named after where you are, so find the panel itself). */
const mobiusBeside = () => shell().locator('.dock.right:not([data-learn])');

/** Help › Learn Mobius, as the launcher finds it (the launcher lists the menus' commands). */
const openLearn = async () => {
  await shell().keyboard.press('Control+K');
  const find = shell().getByRole('combobox', { name: 'Find apps, pages and commands' });
  await expect(find).toBeFocused();
  await find.fill('Learn Mobius');
  await shell().getByRole('option', { name: /Learn Mobius/ }).first().click();
};

test('Help › Learn Mobius opens lessons beside the page in place of Mobius, and Escape closes it', async () => {
  // These tests start with Mobius pinned beside the page: Learn takes that place.
  await expect(mobiusBeside()).toBeVisible({ timeout: 15_000 });
  await openLearn();
  await expect(learn()).toBeVisible();
  await expect(mobiusBeside()).toBeHidden();
  await expect(learn().getByRole('searchbox', { name: 'Search lessons' })).toBeFocused();

  // In the Browser, its own lesson comes first; lessons are the docs pages.
  const cards = learn().getByRole('list', { name: 'Lessons' }).getByRole('button');
  await expect(cards.first()).toContainText('This app');
  await expect(cards.first()).toContainText('Browser');
  await learn().getByRole('radio', { name: 'Your apps' }).click();
  await learn().getByRole('button', { name: /^Notes/ }).click();
  await expect(learn().getByRole('heading', { name: 'Notes', level: 2 })).toBeVisible();
  await expect(learn().getByRole('region', { name: 'What you can do' })).toContainText('History');
  await expect(learn()).toContainText('docs/apps/write-and-plan.md');

  // Escape steps back to the lessons, then closes.
  await shell().keyboard.press('Escape');
  await expect(learn().getByRole('searchbox', { name: 'Search lessons' })).toBeVisible();
  await shell().keyboard.press('Escape');
  await expect(learn()).toBeHidden();
});

test('searching lessons finds what an app can do', async () => {
  await openLearn();
  await learn().getByRole('searchbox', { name: 'Search lessons' }).fill('smart lists');
  await expect(learn().getByRole('list', { name: 'Lessons' }).getByRole('button')).toHaveCount(1);
  await expect(learn().getByRole('list', { name: 'Lessons' })).toContainText('Tasks');
});
