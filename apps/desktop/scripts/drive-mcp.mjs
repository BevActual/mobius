#!/usr/bin/env node
/**
 * Drive Mobius: a dev-only MCP server (stdio) that starts the real Mobius build from this clone and drives its window
 * through the web view's debugging port, as the end-to-end tests do. No screen capture or OS permission is needed:
 * screenshots come from the web view itself.
 *
 * It only starts target/debug or target/release from this clone, and always in test mode with a data folder of its
 * own (fresh, or kept by name under the temporary folder). Your real Mobius data is used only when `realData` is asked
 * for, and then without the test hooks.
 *
 * Registered for Claude Code in the repo's .mcp.json. By hand: node apps/desktop/scripts/drive-mcp.mjs
 */
import { chromium } from '@playwright/test';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const repo = path.resolve(import.meta.dirname, '../../..');
const exeName = process.platform === 'win32' ? 'mobius-shell.exe' : 'mobius-shell';
const keptRoot = path.join(os.tmpdir(), 'mobius-drive');

/** What is running now: one Mobius at a time. */
let run = null;

const log = (...parts) => process.stderr.write(`[drive] ${parts.join(' ')}\n`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function shell() {
  if (!run) throw new Error('Mobius is not running here. Call launch first.');
  return run.page;
}

/** A test hook of the shell (only in test mode): the same bridge the end-to-end tests use. */
async function hook(method, args) {
  if (run?.realData) throw new Error('The test hooks are off when driving your real data.');
  return shell().evaluate(async ({ method, args }) => window.__TAURI_INTERNALS__.invoke('bridge', { namespace: 'test', method, args }), { method, args });
}

/** An element by role and name, or by its text. */
function locate({ role, name, text, exact }) {
  const page = shell();
  if (role) return page.getByRole(role, name === undefined ? {} : { name, exact: exact ?? false }).first();
  if (text) return page.getByText(text, { exact: exact ?? false }).first();
  throw new Error('Say what to act on: a role (and name), or text.');
}

const tools = {
  launch: {
    description: 'Start the Mobius build from this clone (target/debug by default) in test mode with a data folder of its own, and connect to its window. data: "fresh" (default: a new empty folder, removed on close) or "kept" (a named folder under the temporary folder that stays between launches). modelUrl and model point the agent at a scripted model server. realData: true uses your real Mobius data instead, without the test hooks: only when asked for.',
    inputSchema: { type: 'object', properties: {
      build: { type: 'string', enum: ['debug', 'release'] },
      data: { type: 'string', enum: ['fresh', 'kept'] },
      name: { type: 'string', description: 'The kept folder\'s name (letters, digits, - and _).' },
      modelUrl: { type: 'string' }, model: { type: 'string' },
      visible: { type: 'boolean', description: 'Show the window on screen (hidden by default).' },
      width: { type: 'number' }, height: { type: 'number' },
      realData: { type: 'boolean' },
    } },
    run: async (a) => {
      if (run) throw new Error('Mobius is already running here. Close it first.');
      const exe = path.join(repo, 'target', a.build === 'release' ? 'release' : 'debug', exeName);
      if (!fs.existsSync(exe)) throw new Error(`No build at ${exe}. Build it first: npm run build -w @mobius/desktop, then cargo build --workspace --bins${a.build === 'release' ? ' --release' : ''}.`);
      let userData = null;
      let removeOnClose = false;
      if (!a.realData) {
        if (a.data === 'kept') {
          const name = String(a.name ?? 'default');
          if (!/^[\w-]{1,40}$/.test(name)) throw new Error('A kept folder\'s name is letters, digits, - and _.');
          userData = path.join(keptRoot, name);
          fs.mkdirSync(userData, { recursive: true });
        } else {
          userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-drive-'));
          removeOnClose = true;
        }
      }
      const port = await freePort();
      const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` };
      if (userData) Object.assign(env, { MOBIUS_TEST: '1', MOBIUS_USER_DATA: userData, WEBVIEW2_USER_DATA_FOLDER: path.join(userData, 'webview') });
      else { delete env.MOBIUS_TEST; delete env.MOBIUS_USER_DATA; }
      if (!a.visible) env.MOBIUS_HIDE_WINDOW = '1'; else delete env.MOBIUS_HIDE_WINDOW;
      if (a.modelUrl) Object.assign(env, { MOBIUS_AGENT_URL: a.modelUrl, MOBIUS_AGENT_MODEL: a.model ?? 'fake-model' });
      const child = spawn(exe, [], { env, stdio: ['ignore', 'ignore', 'ignore'] });
      let browser = null;
      for (const until = Date.now() + 30_000; Date.now() < until && !browser && child.exitCode === null;) {
        await wait(150);
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
      }
      if (!browser) { child.kill(); throw new Error('Mobius did not open its window.'); }
      let page = null;
      for (const until = Date.now() + 30_000; Date.now() < until && !page;) {
        page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('tauri.localhost')) ?? null;
        if (!page) await wait(100);
      }
      if (!page) { child.kill(); throw new Error('The Mobius window did not load.'); }
      await page.waitForLoadState('domcontentloaded');
      await page.waitForSelector('html[data-keys-ready]', { state: 'attached', timeout: 20_000 }).catch(() => undefined);
      run = { child, browser, page, exe, userData, removeOnClose, realData: Boolean(a.realData) };
      if (a.width && a.height && !a.realData) await hook('probe', ['setSize', { width: a.width, height: a.height }]);
      return `Mobius is running: ${exe}, data in ${userData ?? 'your real data folder'}.`;
    },
  },
  screenshot: {
    description: 'A picture of the Mobius window (PNG). path: also save it there.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    run: async (a) => {
      const png = await shell().screenshot({ type: 'png' });
      if (a.path) { fs.mkdirSync(path.dirname(path.resolve(a.path)), { recursive: true }); fs.writeFileSync(a.path, png); }
      return { image: png.toString('base64'), note: a.path ? `Saved to ${path.resolve(a.path)}.` : undefined };
    },
  },
  snapshot: {
    description: 'What the window shows, as its accessibility tree: roles, names and text (YAML).',
    inputSchema: { type: 'object', properties: {} },
    run: async () => shell().locator('body').ariaSnapshot(),
  },
  click: {
    description: 'Click an element, found by role and name (as a screen reader names it) or by its text.',
    inputSchema: { type: 'object', properties: { role: { type: 'string' }, name: { type: 'string' }, text: { type: 'string' }, exact: { type: 'boolean' } } },
    run: async (a) => { await locate(a).click({ timeout: 10_000 }); return 'Clicked.'; },
  },
  type: {
    description: 'Type text: into an element found by role and name (its contents are replaced), or wherever the focus is.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, role: { type: 'string' }, name: { type: 'string' }, exact: { type: 'boolean' } }, required: ['text'] },
    run: async (a) => {
      if (a.role) await locate(a).fill(a.text, { timeout: 10_000 });
      else await shell().keyboard.type(a.text);
      return 'Typed.';
    },
  },
  press: {
    description: 'Press a key or a combination, as Playwright names them: "Enter", "Escape", "Control+k".',
    inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    run: async (a) => { await shell().keyboard.press(a.key); return 'Pressed.'; },
  },
  open_app: {
    description: 'Open one of Mobius\'s apps by name ("Notes", "Tasks", "Sheets"...), through the app launcher as a person would.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    run: async (a) => {
      const page = shell();
      await page.keyboard.press('Control+k');
      await page.getByRole('combobox', { name: 'Find apps, pages and commands' }).fill(a.name);
      const option = page.getByRole('option', { name: new RegExp(`^${a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), selected: true });
      await option.waitFor({ timeout: 5_000 }).catch(() => { throw new Error(`No app called ${a.name} in the launcher.`); });
      await page.keyboard.press('Enter');
      await page.locator(`.app[data-app]`).first().waitFor({ timeout: 5_000 }).catch(() => undefined);
      return `Opened ${a.name}.`;
    },
  },
  hook: {
    description: 'The test hooks: resize (width, height) the window; theme ("light", "dark" or "system") as chosen in Settings; notices: the notices the app would have shown.',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['resize', 'theme', 'notices'] }, width: { type: 'number' }, height: { type: 'number' }, theme: { type: 'string', enum: ['light', 'dark', 'system'] } }, required: ['action'] },
    run: async (a) => {
      if (a.action === 'resize') { await hook('probe', ['setSize', { width: a.width ?? 1280, height: a.height ?? 800 }]); return 'Resized.'; }
      if (a.action === 'notices') return JSON.stringify(await hook('notices', []));
      if (run?.realData) throw new Error('Changing the theme would change your real settings; not while driving your real data.');
      const theme = a.theme ?? 'light';
      await shell().evaluate((t) => window.mobius.appearance.set({ theme: t }), theme);
      // A hidden window never repaints, so the page's colour-scheme query would keep the old colours: told directly too.
      await shell().emulateMedia({ colorScheme: theme === 'system' ? null : theme });
      await wait(300);
      return `Theme: ${a.theme ?? 'light'} (the window is ${await hook('probe', ['theme'])}).`;
    },
  },
  close: {
    description: 'Quit Mobius. A fresh data folder is removed; a kept one stays.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      if (!run) return 'Mobius is not running here.';
      const { child, browser, userData, removeOnClose, realData } = run;
      run = null;
      if (!realData) await Promise.race([hookOn(browser, 'quit').catch(() => undefined), wait(2000)]);
      for (let i = 0; i < 100 && child.exitCode === null; i++) await wait(50);
      await Promise.race([browser.close().catch(() => undefined), wait(1000)]);
      if (child.exitCode === null && child.pid) {
        try { execSync(process.platform === 'win32' ? `taskkill /pid ${child.pid} /T /F` : `kill ${child.pid}`, { stdio: 'ignore' }); } catch { child.kill(); }
      }
      if (removeOnClose && userData) {
        // The system web view lets go of its profile a few seconds after the app ends.
        for (let i = 0; i < 100 && fs.existsSync(userData); i++) {
          try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* still held */ }
          if (fs.existsSync(userData)) await wait(100);
        }
        if (fs.existsSync(userData)) return `Closed. Its data folder is still held and was left in the temporary folder: ${userData}`;
      }
      return 'Closed.';
    },
  },
};

/** The quit hook, through a page of the browser being closed (the window may already be gone from `run`). */
async function hookOn(browser, method) {
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('tauri.localhost'));
  if (!page) return;
  await page.evaluate(async (m) => window.__TAURI_INTERNALS__.invoke('bridge', { namespace: 'test', method: m, args: [] }), method);
}

// MCP over stdio: one JSON-RPC message per line.
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
async function answer(request) {
  const { id, method, params } = request;
  if (method === 'initialize') {
    return send({ id, result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'mobius-drive', version: '0.1.0' } } });
  }
  if (method === 'tools/list') {
    return send({ id, result: { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) } });
  }
  if (method === 'tools/call') {
    const tool = tools[params?.name];
    if (!tool) return send({ id, error: { code: -32602, message: `No tool called ${params?.name}.` } });
    try {
      const out = await tool.run(params.arguments ?? {});
      const content = typeof out === 'string' ? [{ type: 'text', text: out }]
        : [{ type: 'image', data: out.image, mimeType: 'image/png' }, ...(out.note ? [{ type: 'text', text: out.note }] : [])];
      return send({ id, result: { content } });
    } catch (error) {
      return send({ id, result: { content: [{ type: 'text', text: String(error?.message ?? error) }], isError: true } });
    }
  }
  if (method === 'ping') return send({ id, result: {} });
  if (id !== undefined) send({ id, error: { code: -32601, message: `Unknown method ${method}.` } });
}

// One request at a time, in order: a click must not overtake the launch before it.
let queue = Promise.resolve();
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); } catch { return log('not JSON:', line.slice(0, 80)); }
  queue = queue.then(() => answer(request)).catch((error) => log(String(error)));
});
process.stdin.on('end', () => { void queue.then(() => tools.close.run()).finally(() => process.exit(0)); });
