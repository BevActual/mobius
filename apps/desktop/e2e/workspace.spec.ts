import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, resizeWindow, startFixture, type Fixture, type Launched, removeTestData, turnEnded } from './harness';
import { callsTool, says, startModel, type ModelFixture, type ModelReply } from './model-fixture';

let fixture: Fixture;
let model: ModelFixture | undefined;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-workspace-'));
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
const rail = (): Locator => shell().getByRole('navigation', { name: 'Apps' });
const railButton = (name: string): Locator => rail().getByRole('button', { name, exact: true });
// The apps are always in the rail (zone 1 of the five zones): nothing to open first.
const showApps = async (): Promise<void> => { await expect(rail()).toBeVisible(); };
const mobiusButton = (): Locator => shell().locator('.context-strip [data-mobius-face]');
const leftSide = (): Locator => shell().locator('.dock.left');
const composer = (): Locator => shell().getByRole('textbox', { name: 'Message Mobius' });

async function start(replies: ModelReply[] = []): Promise<void> {
  model = await startModel(replies);
  mobius = await launch(fixture.origin + '/', { userData, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'fake-model' } });
  await expect(composer()).toBeEnabled({ timeout: 15_000 });
}
const seed = () => {
  fs.mkdirSync(path.join(userData, 'workspace', 'notes', 'Home'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace', 'notes', 'Home', 'Garden.md'), '# Garden\nPlant the tulips before the frost.\n');
  fs.mkdirSync(path.join(userData, 'workspace', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace', 'tasks', 'Inbox.md'), '# Inbox\n\n- [ ] Buy tulip bulbs\n- [ ] Call the bank\n');
};

test('the rail opens every app, shows where you are, and holds Settings', async () => {
  await start();
  await showApps();
  await expect(railButton('Browser')).toHaveAttribute('aria-current', 'page');
  for (const [name, view] of [['Tasks', '.tasks-page'], ['Notes', '[aria-label="Notes sidebar"]'], ['Search', '.search-page'], ['Agent', '.chat.full']] as const) {
    await showApps();
    await railButton(name).click();
    await expect(shell().locator(view)).toBeVisible();
    await showApps();
    await expect(railButton(name)).toHaveAttribute('aria-current', 'page');
  }
  await showApps();
  await expect(rail().locator('[aria-current="page"]')).toHaveCount(1);
  await railButton('Settings').click();
  await expect(shell().getByRole('region', { name: 'Settings' })).toBeVisible();
  // Settings is one of Mobius's own apps at the rail's end, and closes from there too.
  await expect(rail().locator('.rail-end').getByRole('button', { name: 'Settings', exact: true })).toHaveCount(1);
  await showApps();
  await railButton('Settings').click();
  await expect(shell().getByRole('region', { name: 'Settings' })).toHaveCount(0);
});

test('Search finds notes, tasks and pages in one place and opens each in its own app', async () => {
  seed();
  await start();
  await showApps();
  await railButton('Search').click();
  const page = shell().locator('.search-page');
  const box = page.getByRole('searchbox', { name: 'Search everything' });
  expect(await box.evaluate((el) => el === document.activeElement)).toBe(true);
  // Nothing typed: the latest things, from every app.
  await expect(page.getByRole('list', { name: 'Recent' })).toContainText('Garden');
  await box.fill('tulip');
  const results = page.getByRole('list', { name: 'Results' });
  await expect(results.getByRole('button')).toHaveCount(2);
  await expect(results).toContainText('Notes › Home');
  await expect(results).toContainText('Tasks › Inbox');
  await shell().getByRole('navigation', { name: 'Search in' }).getByRole('button', { name: 'Tasks' }).click();
  await expect(results.getByRole('button')).toHaveCount(1);
  await results.getByRole('button', { name: /Buy tulip bulbs/ }).click();
  await showApps();
  await expect(railButton('Tasks')).toHaveAttribute('aria-current', 'page');
  await expect(shell().locator('.strip-title')).toHaveText('Inbox');

  await showApps();
  await railButton('Search').click();
  await shell().getByRole('navigation', { name: 'Search in' }).getByRole('button', { name: 'All' }).click();
  await page.getByRole('searchbox', { name: 'Search everything' }).fill('frost');
  await page.getByRole('list', { name: 'Results' }).getByRole('button', { name: /Garden/ }).click();
  await expect(shell().getByRole('textbox', { name: 'Note text' })).toContainText('tulips before the frost');
});

test('asking from Search hands the question to the agent', async () => {
  await start([says(['Here is what I found.'])]);
  await showApps();
  await railButton('Search').click();
  await shell().getByRole('searchbox', { name: 'Search everything' }).fill('what did I plan for the garden');
  await shell().getByRole('button', { name: /Ask Mobius/ }).click();
  await showApps();
  await expect(railButton('Agent')).toHaveAttribute('aria-current', 'page');
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('Here is what I found.');
});

test('while the agent works the composer says what it is doing, the app it works in glows, and a change elsewhere leaves a dot', async () => {
  await start([callsTool('tasks-add', { list: 'Inbox', text: 'Water the plants' }), says(['Added.'])]);
  await turnEnded(composer());
  await composer().fill('Remind me to water the plants');
  await composer().press('Enter');
  const activity = shell().getByRole('status', { name: 'Agent activity' });
  await expect(activity).toHaveText('Waiting for you to allow it');
  await showApps();
  await expect(railButton('Tasks')).toHaveAttribute('data-working', 'true');
  await shell().getByRole('button', { name: 'Allow once' }).click();
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('Added.');
  // The panel says which apps Mobius has worked in during this conversation.
  // "Sees" names what is open in view now (this page); the apps it worked in are listed as "Has used".
  const context = shell().getByRole('button', { name: /^Sees this page / });
  await expect(context).toHaveText('Sees this page · Ask first');
  await context.click();
  await expect(shell().locator('.chat-sees')).toHaveText('Has used: Tasks');
  await expect(shell().getByRole('group', { name: 'What Mobius sees' })).toContainText('What Mobius may do here comes from Settings.');
  await expect(shell().locator('.msg-sources').last()).toHaveText('Based on Tasks');
  await expect(activity).toHaveCount(0);
  await showApps();
  await expect(railButton('Tasks')).not.toHaveAttribute('data-working');
  // The agent changed Tasks while you were in the Browser: a dot until you look.
  await showApps();
  await expect(railButton('Tasks')).toHaveAttribute('data-changed', 'true');
  await showApps();
  await railButton('Tasks').click();
  // The turn's change is still waiting for Keep, so Tasks opens on the list it is in rather than Today.
  await expect(shell().locator('.strip-title')).toHaveText('Inbox');
  await showApps();
  await railButton('Browser').click();
  await showApps();
  await expect(railButton('Tasks')).not.toHaveAttribute('data-changed');
});

test('the app hub shows every app with what is happening in it, starts new things, and lists the apps to come', async () => {
  seed();
  fs.writeFileSync(path.join(userData, 'workspace', 'tasks', 'Inbox.md'), `# Inbox\n\n- [ ] Buy tulip bulbs (due 2001-01-01)\n`);
  await start();
  // All apps is the last row of the switcher.
  await showApps();
  const opener = shell().getByRole('button', { name: /^Applications/ });
  await showApps();
  await opener.click();
  const hub = shell().getByRole('dialog', { name: 'Applications' });
  await expect(hub).toBeVisible();
  const apps = hub.getByRole('region', { name: 'Apps' });
  await expect(apps.getByRole('button', { name: 'Notes, 1 page' })).toBeVisible();
  await expect(apps.getByRole('button', { name: /^Tasks, 1 due today/ })).toBeVisible();
  await expect(apps.getByRole('button', { name: /^Browser, 1 tab open/ })).toHaveAttribute('aria-current', 'page');
  // Apps sit in groups by what they are for.
  await expect(apps.getByRole('group', { name: 'Write and plan' }).getByRole('button', { name: 'Notes, 1 page' })).toBeVisible();
  // A group of one joins the group beside it, so no app sits alone: Agent leads Browse and find, Review ends Create.
  await expect(apps.getByRole('group', { name: 'Browse and find' }).getByRole('button', { name: /^Agent/ })).toBeVisible();
  await expect(apps.getByRole('group', { name: 'Create' }).getByRole('button', { name: /^Review/ })).toBeEnabled();
  for (const group of await apps.getByRole('group').all()) expect(await group.getByRole('button').count()).toBeGreaterThan(1);
  // Nothing runs past the hub's right edge, and the Start actions show their whole words.
  expect(await hub.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  for (const start of await hub.getByRole('region', { name: 'Start something' }).locator('.hub-start > span:last-child').all()) expect(await start.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  // Typing narrows it; Enter opens the first app that matches.
  await hub.getByRole('searchbox', { name: 'Find apps' }).fill('tas');
  await expect(apps.getByRole('button')).toHaveCount(1);
  await hub.getByRole('searchbox', { name: 'Find apps' }).press('Enter');
  await expect(hub).toBeHidden();
  await showApps();
  await expect(railButton('Tasks')).toHaveAttribute('aria-current', 'page');

  // Start something new from anywhere: a task lands in the Inbox, with the cursor in the new-task box.
  await showApps();
  await opener.click();
  await hub.getByRole('region', { name: 'Start something' }).getByRole('button', { name: 'New task' }).click();
  await expect(shell().locator('.strip-title')).toHaveText('Inbox');
  const field = shell().getByRole('textbox', { name: 'New task', exact: true });
  await expect.poll(() => field.evaluate((el) => el === document.activeElement)).toBe(true);
  await showApps();
  await opener.click();
  await hub.getByRole('button', { name: 'New note' }).click();
  await showApps();
  await expect(railButton('Notes')).toHaveAttribute('aria-current', 'page');
  await expect(shell().getByRole('textbox', { name: 'Note text' }).locator('h1')).toHaveText('Untitled');
  await showApps();
  await opener.click();
  await shell().keyboard.press('Escape');
  await expect(hub).toBeHidden();
});

test('the rail holds the apps, and the sidebar is its own full-height column that belongs to the open app', async () => {
  seed();
  await start();
  await expect.poll(async () => Math.round((await rail().boundingBox())!.width)).toBe(52);
  // The sidebar's head names the app, and its New follows the app you are in.
  await expect(leftSide().getByRole('heading', { name: 'Browser', exact: true })).toBeVisible();
  await expect(leftSide().getByRole('button', { name: 'Create' })).toHaveAttribute('title', 'New tab');
  await expect(shell().getByRole('complementary', { name: 'Browser sidebar' })).toBeVisible();
  // It runs from the top of the window, beside the toolbar, not under it.
  const side = (await leftSide().boundingBox())!;
  const bar = (await shell().locator('.context-strip').boundingBox())!;
  expect(side.y).toBeLessThanOrEqual(bar.y + 1);
  expect(bar.x).toBeGreaterThanOrEqual(side.x + side.width - 1);
  await railButton('Tasks').click();
  // In Tasks, New is the first row of the app's sidebar (after search), and adding a task the first row of a list, so the
  // head's own Create button gives way.
  const lists = shell().getByRole('navigation', { name: 'Lists' });
  await expect(lists).toBeVisible();
  await expect(leftSide().getByRole('button', { name: 'Create' })).toHaveCount(0);
  await expect(shell().getByRole('complementary', { name: 'Tasks sidebar' }).getByRole('button', { name: 'New list' })).toBeVisible();
  await lists.getByRole('button', { name: /^Inbox/ }).click();
  await expect(shell().locator('.strip-title')).toHaveText('Inbox');
  await expect(shell().getByRole('textbox', { name: 'New task', exact: true })).toHaveAttribute('placeholder', 'Add to Inbox');
  // The toolbar's sidebar button hides and shows it; the rail stays.
  await shell().getByRole('button', { name: 'Show lists' }).click();
  await expect(leftSide()).toHaveCount(0);
  await expect(railButton('Tasks')).toHaveAttribute('aria-current', 'page');
  await shell().getByRole('button', { name: 'Show lists' }).click();
  await expect(lists).toBeVisible();
});

test('the Mobius button shows and hides Mobius in the right panel, and the sidebar stays the app’s', async () => {
  await start();
  // The Mobius button is the last thing in the toolbar.
  const face = mobiusButton();
  await expect(shell().getByRole('group', { name: 'Applications' }).getByRole('button').last()).toHaveAttribute('data-mobius-face');
  const beside = shell().locator('.dock.right > .chat');
  await expect(beside).toBeVisible();
  await expect(face).toHaveAttribute('aria-pressed', 'true');
  await face.click();
  await expect(shell().locator('.dock.right')).toHaveCount(0);
  await expect(face).toHaveAttribute('aria-pressed', 'false');
  await face.click();
  await expect(beside).toBeVisible();
  await expect(composer()).toBeFocused();
  // The sidebar stays the app's own.
  await expect(shell().getByRole('complementary', { name: 'Browser sidebar' })).toBeVisible();
  await expect(leftSide().getByRole('textbox', { name: 'Message Mobius' })).toHaveCount(0);
});

test('with the agent panel put away, the Mobius button brings it back on the right and its message box says what it would ask about', async () => {
  await start([says(['That page is the fixture home.'])]);
  // No second ask box in the toolbar: Mobius opens from the trefoil at the toolbar's end, and the corner glyphs say
  // what they are.
  await expect(shell().getByRole('button', { name: 'Show agent' })).toHaveCount(0);
  await expect(shell().getByRole('search', { name: 'Ask the agent' })).toHaveCount(0);
  for (const glyph of await shell().getByRole('group', { name: 'Applications' }).getByRole('button').all()) expect(await glyph.getAttribute('title')).toBeTruthy();
  await shell().getByRole('complementary', { name: 'Agent' }).getByRole('button', { name: 'Hide' }).click();
  await expect(shell().getByRole('complementary', { name: 'Agent' })).toHaveCount(0);
  await mobiusButton().click();
  const ask = composer();
  await expect(ask).toHaveAttribute('placeholder', 'Ask about this page');
  await ask.fill('What is this page?');
  await ask.press('Enter');
  await expect(shell().locator('.dock.right').getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('That page is the fixture home.');
});

test('Mobius’s own apps sit at the foot of the rail: Agents and Activity open their views of the Agent app, and Settings opens Settings', async () => {
  await start();
  const own = rail().locator('.rail-end');
  await own.getByRole('button', { name: 'Agents', exact: true }).click();
  const side = shell().getByRole('complementary', { name: 'Conversation list' });
  await expect(side.getByRole('tab', { name: 'Agents' })).toHaveAttribute('aria-selected', 'true');
  await expect(own.getByRole('button', { name: 'Agents', exact: true })).toHaveAttribute('aria-current', 'page');
  // Only Agents is where you are: not Agent too.
  await expect(rail().locator('[aria-current="page"]')).toHaveCount(1);
  await own.getByRole('button', { name: 'Activity', exact: true }).click();
  // Activity has its own sidebar and page in the Agent app's place.
  await expect(shell().getByRole('complementary', { name: 'Activity sidebar' })).toBeVisible();
  await expect(shell().getByRole('region', { name: 'Activity', exact: true })).toBeVisible();
  // Agent itself opens on the conversations.
  await railButton('Agent').click();
  await expect(side.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true');
  await own.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(shell().getByRole('region', { name: 'Settings' })).toBeVisible();
});

test('a narrow window still opens Mobius on the right, at no less than its narrowest width', async () => {
  await start();
  await resizeWindow(mobius!.app, 900, 700);
  const face = mobiusButton();
  if ((await face.getAttribute('aria-pressed')) === 'true') await face.click();
  await expect(shell().locator('.dock.right')).toHaveCount(0);
  await face.click();
  await expect(shell().locator('.dock.right > .chat')).toBeVisible();
  // A narrow window draws Mobius narrower than saved (dock-fit.ts), never under 280px.
  await expect.poll(async () => Math.round((await shell().locator('.dock.right').boundingBox())!.width)).toBeGreaterThanOrEqual(280);
  await expect(composer()).toBeVisible();
});

test('Mobius pinned beside is a card with no line between it and the page, in every app, light and dark', async () => {
  await start();
  for (const theme of ['light', 'dark'] as const) {
    await shell().emulateMedia({ colorScheme: theme });
    for (const [name, id] of [['Docs', 'docs'], ['Notes', 'notes'], ['Mail', 'mail'], ['Browser', 'browser'], ['Sheets', 'sheets'], ['Music', 'studio'], ['Code', 'code'], ['Design', 'design']]) {
      await shell().keyboard.press('Control+k');
      await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill(name!);
      await shell().keyboard.press('Enter');
      await expect(shell().locator('.app')).toHaveAttribute('data-app', id!);
      await expect(shell().locator('.dock.right:not([data-floating]) > .chat')).toBeVisible();
      // Every element whose left or right edge is within a few pixels of where the page meets the card: none draws a line.
      const lines = await shell().evaluate(() => {
        const card = document.querySelector('.dock.right:not([data-floating]) > .chat');
        if (!card) return ['no pinned card'];
        const edge = card.getBoundingClientRect().left;
        const visible = (width: string, color: string) => parseFloat(width) > 0 && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(color);
        const found: string[] = [];
        for (const el of Array.from(document.querySelectorAll('*'))) {
          const r = el.getBoundingClientRect();
          if (r.height < 20) continue;
          const st = getComputedStyle(el);
          const label = el.tagName.toLowerCase() + '.' + String(el.className);
          if (Math.abs(r.left - edge) <= 12 && visible(st.borderLeftWidth, st.borderLeftColor)) found.push('left border on ' + label);
          if (Math.abs(r.right - edge) <= 12 && visible(st.borderRightWidth, st.borderRightColor)) found.push('right border on ' + label);
          if (Math.abs(r.left - edge) <= 12 && r.width <= 3 && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(st.backgroundColor)) found.push('hairline ' + label);
        }
        return found;
      });
      expect(lines, `${name}, ${theme}`).toEqual([]);
    }
  }
});


test('design review: the title bar names the app, nothing claims a page it cannot see, Search has scopes, the Agent home lines up, and From Mobius filters', async () => {
  seed();
  fs.writeFileSync(path.join(userData, 'workspace', 'tasks', 'Home.md'), '# Home\n\n- [ ] Fix the gate\n');
  await start([callsTool('tasks-add', { list: 'Inbox', text: 'Water the plants' }), says(['Added.'])]);
  const open = async (name: string) => {
    await shell().keyboard.press('Control+k');
    await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill(name);
    await shell().keyboard.press('Enter');
  };
  // Docs with nothing open: the title bar says Docs, and Mobius beside it does not claim to see a page.
  await open('Docs');
  await expect(shell().locator('.strip-title')).toHaveText('Docs');
  await expect(shell().getByRole('button', { name: /^Sees / })).toHaveCount(0);
  // Search: scopes in its sidebar, the same as the page's, and nothing to create.
  await open('Search');
  const scopes = shell().getByRole('navigation', { name: 'Search in' });
  await expect(scopes.getByRole('button')).toHaveCount(9);
  await scopes.getByRole('button', { name: 'Tasks' }).click();
  await expect(scopes.getByRole('button', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');
  await expect(leftSide().getByRole('button', { name: 'Create' })).toHaveCount(0);
  // The scopes show once: in the sidebar while it shows, as chips under the field when it is folded away.
  const chips = shell().locator('.search-page').getByRole('radiogroup', { name: 'Show' });
  await expect(chips).toHaveCount(0);
  const scopesToggle = shell().getByRole('button', { name: 'Show scopes' });
  if ((await scopesToggle.getAttribute('aria-pressed')) === 'true') await scopesToggle.click();
  await expect(chips.getByRole('radio', { name: 'Tasks' })).toHaveAttribute('aria-checked', 'true');
  await scopesToggle.click();
  await expect(chips).toHaveCount(0);
  // The Agent home: what is in your apps is as wide as the message box, and centred with it.
  await open('Agent');
  // Measured once the page has settled (it grows in as the app opens).
  const offset = async () => {
    const desk = (await shell().locator('.chat.full .desk').boundingBox())!;
    const box = (await shell().locator('.chat.full .composer').boundingBox())!;
    return Math.max(Math.abs(desk.width - box.width), Math.abs(desk.x + desk.width / 2 - (box.x + box.width / 2)));
  };
  await expect.poll(offset).toBeLessThan(2);
  // From Mobius: a filter in the Tasks sidebar, not a second list of the same rows.
  await composer().fill('Remind me to water the plants');
  await composer().press('Enter');
  await shell().getByRole('button', { name: 'Allow once' }).click();
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('Added.');
  await open('Tasks');
  const filter = shell().getByRole('button', { name: /From Mobius/ });
  await expect(filter).toContainText('1');
  const lists = shell().locator('.dock.left, .rail');
  await expect(lists.getByRole('button', { name: /^Home/ }).first()).toBeVisible();
  await filter.click();
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
  await expect(lists.getByRole('button', { name: /^Home/ })).toHaveCount(0);
  await expect(lists.getByRole('button', { name: /^Inbox/ }).first()).toBeVisible();
  await filter.click();
  await expect(lists.getByRole('button', { name: /^Home/ }).first()).toBeVisible();
});
