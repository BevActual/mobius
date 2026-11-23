import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expectOnApp, goButton, goTo, goToPlace, launch, openAllApps, resizeWindow, startFixture, type Fixture, type Launched, removeTestData, turnEnded } from './harness';
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
// No rail (docs/design/panel-layouts.md): the Go button names the app you are in and opens the launcher.
const onApp = (name: string) => expectOnApp(shell(), name);
const open = (name: string) => (name === 'Home' ? goToPlace(shell(), 'Home') : goTo(shell(), name));
const mobiusButton = (): Locator => shell().locator('.strip-right [data-mobius-face]');
const leftSide = (): Locator => shell().locator(':is(.dock.left, .ui-dock[data-dock="left"])');
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

test('the Go button opens every app through the launcher, says where you are, and reaches Settings', async () => {
  await start();
  await expect(shell().getByRole('navigation', { name: 'Apps' })).toHaveCount(0);
  await onApp('Browser');
  for (const [name, view] of [['Tasks', '.tasks-page'], ['Notes', 'aside[aria-label="Notebooks"]'], ['Search', '.search-page'], ['Home', '.chat.full']] as const) {
    await open(name);
    await expect(shell().locator(view)).toBeVisible();
    await onApp(name);
  }
  // Ctrl+1 opens the first pinned app (Home is the launcher's own place, so Search leads).
  await shell().keyboard.press('Control+1');
  await onApp('Search');
  await goToPlace(shell(), 'Settings');
  await expect(shell().getByRole('region', { name: 'Settings' })).toBeVisible();
  await onApp('Settings');
  // Going anywhere else from the launcher closes it.
  await open('Tasks');
  await expect(shell().getByRole('region', { name: 'Settings' })).toHaveCount(0);
});

test('Search finds notes, tasks and pages in one place and opens each in its own app', async () => {
  seed();
  await start();
  await open('Search');
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
  await onApp('Tasks');
  await expect(shell().locator('.toolbar-sub')).toHaveText('Inbox');

  await open('Search');
  await shell().getByRole('navigation', { name: 'Search in' }).getByRole('button', { name: 'All' }).click();
  await page.getByRole('searchbox', { name: 'Search everything' }).fill('frost');
  await page.getByRole('list', { name: 'Results' }).getByRole('button', { name: /Garden/ }).click();
  await expect(shell().getByRole('textbox', { name: 'Note text' })).toContainText('tulips before the frost');
});

test('asking from Search hands the question to the agent', async () => {
  await start([says(['Here is what I found.'])]);
  await open('Search');
  await shell().getByRole('searchbox', { name: 'Search everything' }).fill('what did I plan for the garden');
  await shell().getByRole('button', { name: /Ask Mobius/ }).click();
  await onApp('Home');
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('Here is what I found.');
});

test('while the agent works the composer says what it is doing, and a change elsewhere leaves a dot', async () => {
  await start([callsTool('tasks-add', { list: 'Inbox', text: 'Water the plants' }), says(['Added.'])]);
  await turnEnded(composer());
  await composer().fill('Remind me to water the plants');
  await composer().press('Enter');
  const activity = shell().getByRole('status', { name: 'Agent activity' });
  await expect(activity).toHaveText('Waiting for you to allow it');
  await shell().getByRole('button', { name: 'Allow once' }).click();
  await expect(shell().getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('Added.');
  // What Mobius used shows under the reply; what it sees is the chip in the message box, not a line of its own.
  await expect(shell().getByRole('button', { name: /^Sees / })).toHaveCount(0);
  await expect(shell().locator('.msg-sources').last()).toHaveText('Based on Tasks');
  await expect(activity).toHaveCount(0);
  // The agent changed Tasks while you were in the Browser: a dot on the Go button, and on Tasks in the launcher, until
  // you look.
  await expect(goButton(shell())).toHaveAccessibleName(/waiting/);
  await goButton(shell()).click();
  const pinned = shell().getByRole('dialog', { name: 'Launcher' }).getByRole('group', { name: 'Pinned' });
  await expect(pinned.getByRole('option', { name: 'Tasks, 1 waiting' })).toBeVisible();
  await pinned.getByRole('option', { name: 'Tasks, 1 waiting' }).click();
  // The turn's change is still waiting for Keep, so Tasks opens on the list it is in rather than Today.
  await expect(shell().locator('.toolbar-sub')).toHaveText('Inbox');
  await open('Browser');
  await expect(goButton(shell())).not.toHaveAccessibleName(/waiting/);
});

test('the app hub shows every app with what is happening in it, starts new things, and lists the apps to come', { tag: '@shell', annotation: { type: 'needs the shell', description: "the browser's own pages and tabs" } }, async () => {
  seed();
  fs.writeFileSync(path.join(userData, 'workspace', 'tasks', 'Inbox.md'), `# Inbox\n\n- [ ] Buy tulip bulbs (due 2001-01-01)\n`);
  await start();
  // All apps is one of the launcher's commands.
  const opener = { click: () => openAllApps(shell()) };
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
  await onApp('Tasks');

  // Start something new from anywhere: a task lands in the Inbox, with the cursor in the new-task box.
  await opener.click();
  await hub.getByRole('region', { name: 'Start something' }).getByRole('button', { name: 'New task' }).click();
  await expect(shell().locator('.toolbar-sub')).toHaveText('Inbox');
  const field = shell().getByRole('textbox', { name: 'New task', exact: true });
  await expect.poll(() => field.evaluate((el) => el === document.activeElement)).toBe(true);
  await opener.click();
  await hub.getByRole('button', { name: 'New note' }).click();
  await onApp('Notes');
  await expect(shell().getByRole('textbox', { name: 'Note text' }).locator('h1')).toHaveText('Untitled');
  await opener.click();
  await shell().keyboard.press('Escape');
  await expect(hub).toBeHidden();
});

test('the top bar runs the window’s width, and the list under it belongs to the open app', async () => {
  seed();
  await start();
  // The Browser's list is its own Tabs panel (its head is the space's name, with the panel's close), and New tab is the
  // last row of Today, as in Arc.
  await expect(leftSide().getByRole('button', { name: 'Hide Tabs' })).toBeVisible();
  await expect(leftSide().getByTitle('New tab (Ctrl+T)')).toBeVisible();
  await expect(shell().getByRole('complementary', { name: 'Tabs' })).toBeVisible();
  // It sits under the top bar, which starts with the Go button at the window's left edge.
  const side = (await leftSide().boundingBox())!;
  const bar = (await shell().locator('.context-strip').boundingBox())!;
  expect(side.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
  expect(bar.x).toBeLessThanOrEqual(1);
  expect((await goButton(shell()).boundingBox())!.x).toBeLessThan(side.x + side.width);
  await open('Tasks');
  // In Tasks, New is the first row of the app's sidebar (after search), and adding a task the first row of a list, so the
  // head's own Create button gives way.
  const lists = shell().getByRole('navigation', { name: 'Lists' });
  await expect(lists).toBeVisible();
  await expect(leftSide().locator('.app-side-new')).toHaveCount(0);
  await expect(shell().getByRole('complementary', { name: 'Lists' }).getByRole('button', { name: 'New list' })).toBeVisible();
  await lists.getByRole('button', { name: /^Inbox/ }).click();
  await expect(shell().locator('.toolbar-sub')).toHaveText('Inbox');
  await expect(shell().getByRole('textbox', { name: 'New task', exact: true })).toHaveAttribute('placeholder', 'Add to Inbox');
  // The lists are Tasks' own panel: its close button hides them, and Ctrl+\ hides and shows them.
  await leftSide().getByRole('button', { name: 'Hide Lists' }).click();
  await expect(leftSide()).toHaveCount(0);
  await onApp('Tasks');
  await shell().keyboard.press('Control+Backslash');
  await expect(lists).toBeVisible();
  await shell().keyboard.press('Control+Backslash');
  await expect(leftSide()).toHaveCount(0);
  await shell().keyboard.press('Control+Backslash');
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
  // Mobius starts under the top bar, which runs the window's width.
  const bar = (await shell().locator('.context-strip').boundingBox())!;
  expect((await beside.boundingBox())!.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
  expect(bar.x + bar.width).toBeGreaterThanOrEqual((await beside.boundingBox())!.x + (await beside.boundingBox())!.width - 1);
  await face.click();
  await expect(shell().locator('.dock.right')).toHaveCount(0);
  await expect(face).toHaveAttribute('aria-pressed', 'false');
  await face.click();
  await expect(beside).toBeVisible();
  await expect(composer()).toBeFocused();
  // The sidebar stays the app's own.
  await expect(shell().getByRole('complementary', { name: 'Tabs' })).toBeVisible();
  await expect(leftSide().getByRole('textbox', { name: 'Message Mobius' })).toHaveCount(0);
});

test('with the agent panel put away, the Mobius button brings it back on the right and its message box says what it would ask about', { tag: '@shell', annotation: { type: 'needs the shell', description: "the browser's own pages and tabs" } }, async () => {
  await start([says(['That page is the fixture home.'])]);
  // No second ask box in the toolbar: Mobius opens from the trefoil at the toolbar's end, and the corner glyphs say
  // what they are.
  await expect(shell().getByRole('button', { name: 'Show agent' })).toHaveCount(0);
  await expect(shell().getByRole('search', { name: 'Ask the agent' })).toHaveCount(0);
  for (const glyph of await shell().getByRole('group', { name: 'Applications' }).getByRole('button').all()) expect(await glyph.getAttribute('title')).toBeTruthy();
  // The panel has no close button: the Mobius button shows and hides it.
  await mobiusButton().click();
  await expect(shell().getByRole('complementary', { name: 'Agent', exact: true })).toHaveCount(0);
  await mobiusButton().click();
  const ask = composer();
  await expect(ask).toHaveAttribute('placeholder', 'Ask about this page');
  await ask.fill('What is this page?');
  await ask.press('Enter');
  await expect(shell().locator('.dock.right').getByRole('log', { name: 'Conversation' }).locator('.msg.assistant')).toHaveText('That page is the fixture home.');
});

test('Mobius’s own apps open from All apps and the launcher’s foot', async () => {
  await start();
  const fromHub = async (name: string) => { await openAllApps(shell()); await shell().getByRole('dialog', { name: 'Applications' }).getByRole('region', { name: 'Mobius' }).getByRole('button', { name, exact: true }).click(); };
  await fromHub('Agents');
  const side = shell().getByRole('complementary', { name: 'Chats' });
  await expect(side.getByRole('region', { name: 'Agents' })).toBeVisible();
  await fromHub('Activity');
  // Activity has its own sidebar and page in the Agent app's place.
  await expect(shell().getByRole('complementary', { name: 'Activity' })).toBeVisible();
  await expect(shell().getByRole('region', { name: 'Activity', exact: true })).toBeVisible();
  // Agent itself opens on the conversations.
  await goToPlace(shell(), 'Home');
  await onApp('Home');
  await expect(side.getByRole('region', { name: 'Agents' })).toHaveCount(0);
  await goToPlace(shell(), 'Store');
  await expect(shell().locator('.app')).toHaveAttribute('data-app', 'skills');
  await goToPlace(shell(), 'Settings');
  await expect(shell().getByRole('region', { name: 'Settings' })).toBeVisible();
});

test('every app and Mobius page is found in All apps by its name and opens with Enter', async () => {
  await start();
  const hub = shell().getByRole('dialog', { name: 'Applications' });
  const byKeys = async (name: string) => {
    await openAllApps(shell());
    await hub.getByRole('searchbox', { name: 'Find apps' }).fill(name);
    await expect(hub.getByRole('button', { name: new RegExp(`^${name}`) }).first()).toBeVisible();
    await shell().keyboard.press('Enter');
    await expect(hub).toBeHidden();
  };
  for (const [name, id] of [['Projects', 'projects'], ['Browser', 'browser'], ['Views', 'views'], ['Mail', 'mail']] as const) {
    await byKeys(name);
    await expect(shell().locator('.app'), `${name} opens`).toHaveAttribute('data-app', id);
  }
  // Settings and Store are places, not apps: All apps never lists them, and Ctrl K still finds both.
  for (const place of ['Store', 'Settings']) {
    await openAllApps(shell());
    await hub.getByRole('searchbox', { name: 'Find apps' }).fill(place);
    await expect(hub.getByRole('button', { name: new RegExp(`^${place}`) })).toHaveCount(0);
    await hub.getByRole('searchbox', { name: 'Find apps' }).fill('');
    await shell().keyboard.press('Escape');
    await expect(hub).toBeHidden();
  }
  await shell().keyboard.press('Control+k');
  await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Store');
  await shell().keyboard.press('Enter');
  await expect(shell().locator('.app'), 'Store opens from Ctrl K').toHaveAttribute('data-app', 'skills');
  // Reader is a mode of the Browser now: not an app of its own in All apps.
  await openAllApps(shell());
  await hub.getByRole('searchbox', { name: 'Find apps' }).fill('Reader');
  await expect(hub.getByRole('button', { name: /^Reader/ })).toHaveCount(0);
  // A search field's first Escape only clears it; with it empty, Escape closes All apps.
  await hub.getByRole('searchbox', { name: 'Find apps' }).fill('');
  await shell().keyboard.press('Escape');
  await expect(hub).toBeHidden();
  await byKeys('Agents');
  await expect(shell().getByRole('complementary', { name: 'Chats' }).getByRole('region', { name: 'Agents' })).toBeVisible();
  await byKeys('Activity');
  await expect(shell().getByRole('region', { name: 'Activity', exact: true })).toBeVisible();
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

test('Mobius beside the page is a panel of its own on the frame, a gap and its own edge and no second line, in every app, light and dark', async () => {
  await start();
  for (const theme of ['light', 'dark'] as const) {
    await shell().emulateMedia({ colorScheme: theme });
    for (const [name, id] of [['Docs', 'docs'], ['Notes', 'notes'], ['Mail', 'mail'], ['Browser', 'browser'], ['Sheets', 'sheets'], ['Music', 'studio'], ['Code', 'code'], ['Design', 'design']]) {
      await shell().keyboard.press('Control+k');
      await shell().getByRole('combobox', { name: 'Find apps, pages and commands' }).fill(name!);
      await shell().keyboard.press('Enter');
      await expect(shell().locator('.app')).toHaveAttribute('data-app', id!);
      // The Browser closes Mobius on arriving, so the page has the room; open it there to look at it.
      if (id === 'browser') await shell().getByRole('button', { name: 'Show Mobius' }).click();
      await expect(shell().locator('.dock.right:not([data-floating]) > .chat')).toBeVisible();
      // Every element whose left or right edge is where the panel starts: none draws a second line beside its own edge.
      const lines = await shell().evaluate(() => {
        const card = document.querySelector('.dock.right:not([data-floating]) > .chat');
        if (!card) return ['no pinned card'];
        const edge = card.getBoundingClientRect().left;
        const visible = (width: string, color: string) => parseFloat(width) > 0 && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(color);
        const found: string[] = [];
        // Panels on the frame (docs/design/panel-look.md): the panel's own edge is its one line, a gap from the page.
        const dock = card.closest('.dock.right')!;
        if (getComputedStyle(card).borderLeftWidth !== '1px') found.push('no edge on the Mobius panel');
        if (getComputedStyle(dock).borderLeftWidth !== '0px') found.push('a line on the dock as well as the panel');
        if (edge - document.querySelector('.stage')!.getBoundingClientRect().right < 6) found.push('no gap between the page and the panel');
        for (const el of Array.from(document.querySelectorAll('*'))) {
          // A table's own grid running up to the edge is content, not a line between zones.
          if (el === card || el === dock || el.closest('td, th')) continue;
          const r = el.getBoundingClientRect();
          if (r.height < 20) continue;
          const st = getComputedStyle(el);
          const label = el.tagName.toLowerCase() + '.' + String(el.className);
          if (Math.abs(r.left - edge) <= 2 && visible(st.borderLeftWidth, st.borderLeftColor)) found.push('left border on ' + label);
          if (Math.abs(r.right - edge) <= 2 && visible(st.borderRightWidth, st.borderRightColor)) found.push('right border on ' + label);
          if (Math.abs(r.left - edge) <= 2 && r.width <= 3 && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(st.backgroundColor)) found.push('hairline ' + label);
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
  await expect(leftSide().locator('.app-side-new')).toHaveCount(0);
  // The scopes show once: in their panel while it shows, as chips under the field when it is hidden.
  const chips = shell().locator('.search-page').getByRole('radiogroup', { name: 'Show' });
  await expect(chips).toBeHidden();
  await leftSide().getByRole('button', { name: 'Hide Scopes' }).click();
  await expect(chips.getByRole('radio', { name: 'Tasks' })).toHaveAttribute('aria-checked', 'true');
  await shell().keyboard.press('Control+Backslash');
  await expect(chips).toBeHidden();
  await expect(scopes).toBeVisible();
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
  const lists = shell().locator(':is(.dock.left, .ui-dock[data-dock="left"])');
  await expect(lists.getByRole('button', { name: /^Home/ }).first()).toBeVisible();
  await filter.click();
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
  await expect(lists.getByRole('button', { name: /^Home/ })).toHaveCount(0);
  await expect(lists.getByRole('button', { name: /^Inbox/ }).first()).toBeVisible();
  await filter.click();
  await expect(lists.getByRole('button', { name: /^Home/ }).first()).toBeVisible();
});
