import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { corePid, launch, removeTestData, type Launched } from './harness';

// Speed budgets: how long Mobius takes to start, to switch apps and to open a long list, and how much memory it holds
// after a long stretch of use. Every pull request measures them here, on the CI machine's debug build; each figure is
// kept with the test (the run summary prints them, see scripts/e2e-summary.mjs) and one over its budget fails the
// test. Budgets live in speed-budgets.json and are explained in docs/developers/speed.md.
test.skip(process.env.MOBIUS_SHELL !== 'tauri', 'Measured on the Tauri shell');
test.describe.configure({ timeout: 300_000 });

const budgets = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'speed-budgets.json'), 'utf8')) as Record<string, number>;
type Name = string;

/** Keeps one figure with the test and checks it against its budget. A budget of 0 is measured only. */
function measured(name: Name, value: number, unit: 'ms' | 'MB' | 'nodes'): void {
  const budget = budgets[name] ?? 0;
  const rounded = Math.round(value * 10) / 10;
  test.info().annotations.push({ type: 'speed', description: JSON.stringify({ name, value: rounded, unit, budget }) });
  console.log(`[speed] ${name}: ${rounded} ${unit} (budget ${budget || 'none'})`);
  if (budget > 0) expect.soft(rounded, `${name} is over its budget`).toBeLessThanOrEqual(budget);
}

/** The apps a switch goes between, each with the panel that shows it has drawn. */
const APPS: Array<[string, string]> = [
  ['Notes', 'Notebooks'],
  ['Tasks', 'Lists'],
  ['Calendar', 'Calendars'],
  ['Mail', 'Mailboxes'],
  ['Docs', 'Documents'],
  ['Files', 'Places'],
];

/**
 * Opens an app from the launcher and gives how long it took, in the page's own clock: from the Enter that chooses it to
 * the first frame drawn with the app's panel showing. Playwright's polling is not in the figure.
 */
async function switchTo(shell: Page, name: string, panel: string): Promise<number> {
  await shell.keyboard.press('Control+k');
  const field = shell.getByRole('combobox', { name: 'Find apps, pages and commands' });
  await field.fill(name);
  await expect(shell.getByRole('dialog', { name: 'Launcher' }).getByRole('group', { name: 'Apps' }).getByRole('option', { name: new RegExp(`^${name}(,|$)`) }).first()).toBeVisible();
  // The listener is in place before Enter is pressed (an evaluate still on its way when the key arrives would miss it).
  await shell.evaluate(() => {
    const w = window as unknown as { speedPressed: number; speedListening?: boolean };
    w.speedPressed = -1;
    if (!w.speedListening) window.addEventListener('keydown', (event) => { if (event.key === 'Enter' && w.speedPressed < 0) w.speedPressed = event.timeStamp; }, { capture: true });
    w.speedListening = true;
  });
  await field.press('Enter');
  return shell.evaluate(
    ({ name, panel }) =>
      new Promise<number>((resolve, reject) => {
        const w = window as unknown as { speedPressed: number };
        const shown = () => {
          const side = document.querySelector<HTMLElement>(`aside[aria-label="${panel}"]`);
          const go = document.querySelector('.context-strip .go-button')?.getAttribute('aria-label') ?? '';
          return w.speedPressed >= 0 && !!side?.checkVisibility() && go.startsWith(`${name}.`);
        };
        const given = performance.now();
        const look = () => {
          if (shown()) requestAnimationFrame(() => resolve(performance.now() - w.speedPressed));
          else if (performance.now() - given > 15_000) reject(new Error(`${name} did not show its ${panel} panel (Enter seen: ${w.speedPressed >= 0})`));
          else requestAnimationFrame(look);
        };
        look();
      }),
    { name, panel },
  );
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const p90 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * 0.9))] ?? 0;

/** The core's memory, as the system counts it (its working set), in MB. */
function processMB(pid: number): number {
  if (process.platform === 'win32') {
    const line = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    const kb = Number((/"([\d,.\s]+) K"/.exec(line)?.[1] ?? '0').replace(/[^\d]/g, ''));
    return kb / 1024;
  }
  return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) / 1024;
}

/** The interface's own memory after a garbage collection: the JavaScript heap in MB, and how many DOM nodes it holds. */
async function pageMemory(shell: Page): Promise<{ heapMB: number; nodes: number }> {
  const cdp = await shell.context().newCDPSession(shell);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('Performance.enable');
  const { metrics } = await cdp.send('Performance.getMetrics');
  await cdp.detach();
  const metric = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0;
  return { heapMB: metric('JSHeapUsedSize') / 1024 / 1024, nodes: metric('Nodes') };
}

let userData: string;
let mobius: Launched | undefined;
test.beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-speed-'));
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  removeTestData(userData);
});

/** Starts Mobius and gives how long until it can be used: the window drawn with its Go button, shortcuts ready. */
async function start(): Promise<number> {
  const began = Date.now();
  mobius = await launch('about:blank', { userData });
  await expect(mobius.shell.locator('.context-strip .go-button')).toBeVisible({ timeout: 60_000 });
  await mobius.shell.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
  return Date.now() - began;
}

test('start, switching apps, a long list and memory after long use stay within their budgets', async () => {
  // A long notebook: 2,000 pages, as someone who has kept notes for years has.
  const big = path.join(userData, 'workspace', 'notes', 'Archive');
  fs.mkdirSync(big, { recursive: true });
  for (let i = 1; i <= 2000; i++) {
    const n = String(i).padStart(4, '0');
    fs.writeFileSync(path.join(big, `Page ${n}.md`), `# Page ${n}\n\nA note kept on day ${i}, with a #tag and a [link](https://example.com/${i}).\n`);
  }

  // Start. The first start on a new folder makes the web view's profile; the second is the start a person has every day.
  measured('first start', await start(), 'ms');
  await mobius!.close({ keepUserData: true });
  mobius = undefined;
  measured('start', await start(), 'ms');
  const shell = mobius!.shell;

  // A long list: Notes opens with the 2,000-page notebook in its panel.
  measured('open a long list', await switchTo(shell, 'Notes', 'Notebooks'), 'ms');
  // It draws the first pages, and more as the list is scrolled to its end.
  const archive = shell.getByRole('complementary', { name: 'Notebooks' }).getByRole('region', { name: 'Archive' });
  await expect(archive.getByRole('listitem')).toHaveCount(100);
  await archive.getByRole('listitem').last().scrollIntoViewIfNeeded();
  await expect.poll(() => archive.getByRole('listitem').count()).toBeGreaterThan(100);

  // Switching apps: the first visit to each, then visits to apps already open.
  const first: number[] = [];
  for (const [name, panel] of APPS.slice(1)) first.push(await switchTo(shell, name, panel));
  measured('switch to an app, first visit', median(first), 'ms');
  const before = await pageMemory(shell);
  const pid = await corePid(mobius!.app);
  const coreBefore = pid ? processMB(pid) : 0;

  // Long use, compressed: twenty rounds through six apps (120 switches), then memory again. What grows here and is
  // never given back is what an hour of use would pile up.
  const again: number[] = [];
  for (let round = 0; round < 20; round++) {
    for (const [name, panel] of APPS) again.push(await switchTo(shell, name, panel));
  }
  // Which app a slow switch goes to, in the log, so the slowest one is plain.
  for (const [i, [name]] of APPS.entries()) console.log(`[speed] switch to ${name}: median ${Math.round(median(again.filter((_, j) => j % APPS.length === i)))} ms`);
  measured('switch apps', median(again), 'ms');
  measured('switch apps, slowest tenth', p90(again), 'ms');

  const after = await pageMemory(shell);
  measured('interface memory after long use', after.heapMB, 'MB');
  measured('interface memory growth over long use', after.heapMB - before.heapMB, 'MB');
  measured('DOM nodes after long use', after.nodes, 'nodes');
  measured('DOM node growth over long use', after.nodes - before.nodes, 'nodes');
  if (pid) {
    const core = processMB(pid);
    measured('core memory after long use', core, 'MB');
    measured('core memory growth over long use', core - coreBefore, 'MB');
  }
});
