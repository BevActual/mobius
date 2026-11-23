import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { test } from '@playwright/test';

/**
 * `npm run e2e:local`: the real host, run by `mobius-dev-bridge` (crates/mobius-host/src/dev_bridge.rs) behind a web
 * server on 127.0.0.1, and the interface from the dev server in Chromium. The page gets a stand-in for Tauri's
 * internals (`tauriStandIn`) that sends the interface's one command, `bridge`, and its event listening to that server,
 * so the interface runs its real Tauri bridge (src/bridge/tauri.ts) against the real host. What only the shell does (the
 * window, the tray, the browser's pages) is not there; a test that needs it is skipped, and Windows CI runs it.
 */

export interface DevBridge { url: string; token: string; process: ChildProcess; stop(): Promise<void> }

const root = path.resolve(import.meta.dirname, '..');

export async function startDevBridge(userData: string, env: Record<string, string>): Promise<DevBridge> {
  const exe = path.resolve(root, '../../target/debug', process.platform === 'win32' ? 'mobius-dev-bridge.exe' : 'mobius-dev-bridge');
  // Its input stays open while the test runs: when it closes, the bridge and its core end.
  const child = spawn(exe, [], { env: { ...process.env, MOBIUS_TEST: '1', MOBIUS_USER_DATA: userData, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let heard = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    heard += chunk.toString();
    const lines = heard.split('\n');
    heard = lines.pop() ?? '';
    for (const line of lines) if (line.startsWith('[slow]') || process.env.MOBIUS_E2E_HOST_LOG) console.log(`[e2e host] ${test.info().titlePath.slice(1).join(' › ')}: ${line.trim()}`);
  });
  const [port, token] = await new Promise<[string, string]>((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error('the dev bridge did not start in 15 s (built? npm run e2e:local builds it)')), 15_000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the dev bridge ended at start (code ${code})`)); });
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      const found = /MOBIUS_DEV_BRIDGE (\d+) ([0-9a-f]+)/.exec(out);
      if (found) { clearTimeout(timer); resolve([found[1]!, found[2]!]); }
    });
  });
  return {
    url: `http://127.0.0.1:${port}`,
    token,
    process: child,
    stop: async () => {
      child.stdin?.end();
      for (let i = 0; i < 60 && child.exitCode === null && child.signalCode === null; i++) await new Promise((resolve) => setTimeout(resolve, 50));
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    },
  };
}

/** Put in the page before anything of its own runs: Tauri's internals, as far as the interface uses them. */
export function tauriStandIn({ url, token }: { url: string; token: string }): void {
  type Handler = (message: unknown) => void;
  let next = 1;
  const callbacks = new Map<number, Handler>();
  const listeners = new Map<string, Map<number, number>>();
  let opened: Promise<void> | null = null;
  // One stream of the host's events; listening waits until it is open, so nothing sent after `listen` is missed.
  const open = () => opened ??= new Promise<void>((resolve) => {
    const source = new EventSource(`${url}/events?t=${token}`);
    source.onopen = () => resolve();
    source.onmessage = (message) => {
      const { event, payload } = JSON.parse(message.data as string) as { event: string; payload: unknown };
      for (const [id, callback] of listeners.get(event) ?? []) callbacks.get(callback)?.({ event, id, payload });
    };
  });
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
    transformCallback(callback: Handler | undefined, once = false): number {
      const id = next++;
      callbacks.set(id, (message) => { if (once) callbacks.delete(id); callback?.(message); });
      return id;
    },
    unregisterCallback(id: number) { callbacks.delete(id); },
    convertFileSrc(file: string, protocol = 'asset') { return `${protocol}://localhost/${encodeURIComponent(file)}`; },
    async invoke(command: string, args: Record<string, unknown>): Promise<unknown> {
      if (command === 'plugin:event|listen') {
        await open();
        const id = next++;
        const event = args.event as string;
        if (!listeners.has(event)) listeners.set(event, new Map());
        listeners.get(event)!.set(id, args.handler as number);
        return id;
      }
      if (command === 'plugin:event|unlisten') { listeners.get(args.event as string)?.delete(args.eventId as number); return null; }
      if (command !== 'bridge') throw { kind: 'not_available', message: `${command} is the shell's own.` };
      // Plain text, so the browser asks nothing first (no preflight); the token rides in the address.
      const reply = (await (await fetch(`${url}/bridge?t=${token}`, { method: 'POST', body: JSON.stringify(args), headers: { 'content-type': 'text/plain' } })).json()) as { ok?: unknown; error?: unknown };
      if ('error' in reply) throw reply.error;
      return reply.ok;
    },
  };
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener(event: string, id: number) { listeners.get(event)?.delete(id); } };
}
