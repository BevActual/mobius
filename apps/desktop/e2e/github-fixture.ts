import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';

/** A zip that only stores (no compression): enough for the engine installer, which reads standard zips. */
export function storedZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

export interface GithubFixture { releasesUrl: string; downloads: string[]; close(): Promise<void> }

/** A pretend GitHub with one llama.cpp release whose every Windows build holds `program` as llama-server.exe. */
export async function startGithub(program: string, tag = 'b600', pauseMs = 0): Promise<GithubFixture> {
  const server = fs.readFileSync(program);
  const files = new Map<string, Buffer>();
  for (const kind of ['cpu', 'vulkan', 'cuda-12.4', 'cuda-13.5']) files.set(`llama-${tag}-bin-win-${kind}-x64.zip`, storedZip([{ name: 'llama-server.exe', data: server }]));
  for (const kind of ['cuda-12.4', 'cuda-13.5']) files.set(`cudart-llama-bin-win-${kind}-x64.zip`, storedZip([{ name: 'cudart.dll', data: Buffer.from('rt') }]));
  const downloads: string[] = [];
  let origin = '';
  const httpServer = http.createServer((req, res) => {
    const path = req.url ?? '';
    if (path === '/releases') {
      const assets = [...files].map(([name, data]) => ({ name, size: data.length, browser_download_url: `${origin}/download/${tag}/${name}`, digest: `sha256:${crypto.createHash('sha256').update(data).digest('hex')}` }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify([{ tag_name: tag, assets }]));
      return;
    }
    const name = path.split('/').pop() ?? '';
    const data = files.get(name);
    if (!data || !path.startsWith(`/download/${tag}/`)) { res.writeHead(404).end(); return; }
    downloads.push(name);
    res.writeHead(200, { 'content-length': data.length });
    // Send it in two halves so progress can be seen.
    const half = Math.floor(data.length / 2);
    res.write(data.subarray(0, half));
    setTimeout(() => res.end(data.subarray(half)), pauseMs);
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  return { releasesUrl: `${origin}/releases`, downloads, close: () => new Promise((resolve) => { httpServer.closeAllConnections(); httpServer.close(() => resolve()); }) };
}
