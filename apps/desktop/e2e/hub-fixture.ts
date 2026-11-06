import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

export interface FakeRepo {
  id: string;
  pipeline_tag?: string;
  downloads?: number;
  files: Array<{ path: string; bytes: Buffer }>;
}

export interface FakeHub {
  url: string;
  requests: string[];
  close(): Promise<void>;
}

export interface HubOptions {
  /** Pause between chunks of a download, so there is time to cancel it. */
  slowMs?: number;
  /** Answer every request with this status. */
  down?: number;
}

/** The fake llama-server the Rust crate builds for its own tests. */
export const fakeLlama = (): string => path.resolve(import.meta.dirname, '..', '..', '..', 'target', 'debug', process.platform === 'win32' ? 'mobius-fake-llama.exe' : 'mobius-fake-llama');

export const patterned = (size: number): Buffer => Buffer.from(Array.from({ length: size }, (_, i) => (i * 31) % 251));

export async function startHub(repos: FakeRepo[], options: HubOptions = {}): Promise<FakeHub> {
  const requests: string[] = [];
  const sha = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    requests.push(url);
    if (options.down) {
      res.writeHead(options.down).end('down');
      return;
    }
    const json = (body: unknown) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    if (url.startsWith('/api/models?')) {
      const search = new URL(url, 'http://x').searchParams.get('search')?.toLowerCase();
      const found = repos.filter((r) => !search || r.id.toLowerCase().includes(search));
      return json(found.map((r) => ({ id: r.id, downloads: r.downloads ?? 100, likes: 1, pipeline_tag: r.pipeline_tag ?? 'text-generation', gated: false })));
    }
    const tree = /^\/api\/models\/([^/]+\/[^/]+)\/tree\/main/.exec(url);
    if (tree) {
      const repo = repos.find((r) => r.id === tree[1]);
      if (!repo) return void res.writeHead(404).end('no');
      return json(repo.files.map((f) => ({ type: 'file', path: f.path, size: f.bytes.length, lfs: { oid: sha(f.bytes), size: f.bytes.length } })));
    }
    const resolve = /^\/([^/]+\/[^/]+)\/resolve\/main\/(.+)$/.exec(url);
    if (resolve) {
      const repo = repos.find((r) => r.id === resolve[1]);
      const file = repo?.files.find((f) => f.path === decodeURIComponent(resolve[2] ?? ''));
      if (!file) return void res.writeHead(404).end('no');
      res.writeHead(200, { 'Content-Length': file.bytes.length });
      let at = 0;
      const send = () => {
        if (at >= file.bytes.length || res.destroyed) return void res.end();
        const next = Math.min(file.bytes.length, at + 64 * 1024);
        res.write(file.bytes.subarray(at, next));
        at = next;
        setTimeout(send, options.slowMs ?? 0);
      };
      send();
      return;
    }
    res.writeHead(404).end('no');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}
