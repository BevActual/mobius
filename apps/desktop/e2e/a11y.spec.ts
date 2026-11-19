import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { goTo, goToPlace, launch, removeTestData, resizeWindow, startFixture, type Fixture, type Launched } from './harness';
import { startModel, type ModelFixture } from './model-fixture';

// Accessibility, checked by axe (axe-core) on every pull request: the default apps, Home and Settings with Mobius open
// beside them, against WCAG 2.1 A and AA. Every rule runs in Light; colour contrast runs again in Mid grey, Dark and
// Cool dark, the only rule a theme changes. What axe finds is kept with the test (the run summary prints it, see
// scripts/e2e-summary.mjs). Findings already known are in a11y-baseline.json, to be fixed; a new one, or more of a
// known one, fails the test. See docs/developers/accessibility.md.
test.skip(process.env.MOBIUS_SHELL !== 'tauri', 'Checked on the Tauri shell');
test.describe.configure({ timeout: 420_000 });

const AXE = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const baseline = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'a11y-baseline.json'), 'utf8')) as { enforce: boolean; known: Record<string, Record<string, number>> };

const THEMES = ['light', 'mid', 'dark', 'cool'] as const;
type Theme = (typeof THEMES)[number];
/** Where axe looks: [the name the person knows, how to get there]. */
const PLACES: Array<[string, (shell: Page) => Promise<void>]> = [
  ['Home', (shell) => goToPlace(shell, 'Home')],
  ...['Notes', 'Tasks', 'Calendar', 'Mail', 'Docs', 'Files', 'Browser'].map((name): [string, (shell: Page) => Promise<void>] => [name, (shell) => goTo(shell, name)]),
  ['Settings', (shell) => goToPlace(shell, 'Settings')],
];

interface Finding { rule: string; impact: string; nodes: number; help: string; example: string; all: string }

/** Runs axe on the window as it is now. `contrastOnly` runs colour contrast alone. */
async function check(shell: Page, contrastOnly: boolean): Promise<Finding[]> {
  if (!(await shell.evaluate(() => 'axe' in window))) await shell.evaluate(AXE);
  return shell.evaluate(async (contrastOnly) => {
    const axe = (window as unknown as { axe: { run(context: Document, options: object): Promise<{ violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: unknown[]; any: Array<{ data?: { fgColor?: string; bgColor?: string; contrastRatio?: number } | null }> }> }> }> } }).axe;
    const options = contrastOnly
      ? { runOnly: { type: 'rule', values: ['color-contrast'] }, resultTypes: ['violations'] }
      : { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] };
    const { violations } = await axe.run(document, options);
    return violations.map((v) => ({ rule: v.id, impact: v.impact ?? '', nodes: v.nodes.length, help: v.help, example: JSON.stringify(v.nodes[0]?.target ?? '').slice(0, 120),
      // Every element, for fixing: its selector, and for contrast the colours and ratio axe measured.
      all: v.nodes.slice(0, 12).map((n) => { const d = n.any[0]?.data; return `${JSON.stringify(n.target)}${d?.contrastRatio ? ` ${d.fgColor} on ${d.bgColor} = ${d.contrastRatio}` : ''}`; }).join(' | ') }));
  }, contrastOnly);
}

async function settle(shell: Page): Promise<void> {
  await shell.evaluate(() => document.fonts.ready.then(() => undefined));
  await shell.waitForTimeout(300);
}

const setTheme = (shell: Page, theme: Theme) =>
  shell.evaluate(async (theme) => {
    await (window as unknown as { mobius: { appearance: { set(change: object): Promise<unknown> } } }).mobius.appearance.set({ theme });
  }, theme);

let fixture: Fixture;
let model: ModelFixture;
let mobius: Launched | undefined;
let userData: string;
test.beforeEach(async () => {
  fixture = await startFixture();
  model = await startModel([]);
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-a11y-'));
  const write = (rel: string, content: string) => { const f = path.join(userData, 'workspace', rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };
  write('notes/Home/Garden.md', '# Garden\n\nPlant the tulips before the frost.\n\n- Order bulbs\n');
  write('docs/Work/Quarterly review.md', '# Quarterly review\n\nRevenue grew 12% and churn fell.\n');
  write('tasks/Inbox.md', '# Inbox\n\n- [ ] Buy tulip bulbs\n- [x] Book the terrace\n');
});
test.afterEach(async () => {
  await mobius?.close();
  mobius = undefined;
  await model.close();
  await fixture.close();
  removeTestData(userData);
});

test('the default apps, Home and Settings have no new accessibility findings, in all four themes', async () => {
  mobius = await launch(fixture.origin + '/', { userData, openMobius: true, env: { MOBIUS_AGENT_URL: model.url, MOBIUS_AGENT_MODEL: 'chat-model' } });
  const shell = mobius.shell;
  await resizeWindow(mobius.app, 1440, 900);
  const found: Record<string, Record<string, number>> = {};
  for (const [name, open] of PLACES) {
    await open(shell);
    const here: Record<string, number> = (found[name] = {});
    for (const theme of THEMES) {
      await setTheme(shell, theme);
      await settle(shell);
      for (const f of await check(shell, theme !== 'light')) {
        const key = f.rule === 'color-contrast' ? `color-contrast@${theme}` : f.rule;
        here[key] = f.nodes;
        const { all, ...kept } = f;
        test.info().annotations.push({ type: 'a11y', description: JSON.stringify({ place: name, key, ...kept, known: baseline.known[name]?.[key] ?? 0 }) });
        console.log(`[a11y] ${name} ${key}: ${f.nodes} (${f.impact}) ${f.help}: ${all}`);
      }
    }
    await setTheme(shell, 'light');
  }
  // Paste-ready, for a11y-baseline.json once the findings are fixed or accepted.
  console.log(`[a11y] all findings: ${JSON.stringify(found)}`);
  if (!baseline.enforce) return;
  for (const [place, rules] of Object.entries(found)) {
    for (const [key, nodes] of Object.entries(rules)) {
      expect.soft(nodes, `${place}: ${key} found on more elements than a11y-baseline.json knows`).toBeLessThanOrEqual(baseline.known[place]?.[key] ?? 0);
    }
  }
});
