import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A small WebDAV server shaped like Nextcloud's: the account's files under /remote.php/dav/files/<user>/, Basic sign-in,
 * versions (ETags) that refuse a stale change with 412, and MOVE that never replaces. Enough for Files' drives.
 */
export interface WebDavFixture {
  origin: string;
  /** Files by path from the account's top, without a leading slash. Folders end in `/`. */
  files: Map<string, { body: Buffer; version: number }>;
  folders: Set<string>;
  /** Changes a file as someone else would on the server, so the version Files listed is stale. */
  touch(path: string, body: string): void;
  close(): Promise<void>;
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function startWebDav(user = 'ana', password = 'app-pass'): Promise<WebDavFixture> {
  const root = `/remote.php/dav/files/${user}/`;
  const files = new Map<string, { body: Buffer; version: number }>();
  const folders = new Set<string>(['']);
  let next = 100;
  const tag = (v: number) => `"v${v}"`;
  const parent = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const pathOf = (url: string): string | null => {
    const at = decodeURIComponent(new URL(url, 'http://x').pathname);
    if (!at.startsWith(root) && `${at}/` !== root) return null;
    return at.slice(root.length).replace(/\/$/, '');
  };
  const entry = (p: string) => {
    const href = root + p.split('/').filter(Boolean).map(encodeURIComponent).join('/') + (folders.has(p) && p ? '/' : '');
    const f = files.get(p);
    const props = f
      ? `<d:resourcetype/><d:getcontentlength>${f.body.length}</d:getcontentlength><d:getetag>${tag(f.version)}</d:getetag><d:getlastmodified>${new Date().toUTCString()}</d:getlastmodified><d:getcontenttype>application/octet-stream</d:getcontenttype>`
      : '<d:resourcetype><d:collection/></d:resourcetype>';
    return `<d:response><d:href>${xmlEscape(href)}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const send = (status: number, body: string | Buffer = '', headers: Record<string, string> = {}) => { res.writeHead(status, headers); res.end(body); };
      const auth = req.headers.authorization ?? '';
      if (auth !== `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`) return send(401, '', { 'WWW-Authenticate': 'Basic realm="drive"' });
      const p = pathOf(req.url ?? '/');
      if (p === null) return send(404);
      const ifMatch = req.headers['if-match'];
      const f = files.get(p);
      switch (req.method) {
        case 'PROPFIND': {
          if (!folders.has(p) && !f) return send(404);
          const inside = req.headers.depth === '0' || f ? [] : [...folders, ...files.keys()].filter((q) => q !== p && q !== '' && parent(q) === p);
          return send(207, `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${[p, ...inside].map(entry).join('')}</d:multistatus>`, { 'Content-Type': 'application/xml; charset=utf-8' });
        }
        case 'GET':
          return f ? send(200, f.body, { ETag: tag(f.version), 'Content-Type': 'application/octet-stream' }) : send(404);
        case 'PUT': {
          if (!folders.has(parent(p))) return send(409);
          if (req.headers['if-none-match'] === '*' && (f || folders.has(p))) return send(412);
          if (ifMatch && (!f || tag(f.version) !== ifMatch)) return send(412);
          const version = next++;
          files.set(p, { body: Buffer.concat(chunks), version });
          return send(f ? 204 : 201, '', { ETag: tag(version) });
        }
        case 'MKCOL':
          if (folders.has(p) || f) return send(405);
          if (!folders.has(parent(p))) return send(409);
          folders.add(p);
          return send(201);
        case 'MOVE': {
          const to = pathOf(String(req.headers.destination ?? ''));
          if (to === null) return send(502);
          if (!f && !folders.has(p)) return send(404);
          if (files.has(to) || folders.has(to)) return send(412);
          if (!folders.has(parent(to))) return send(409);
          for (const [q, v] of [...files]) if (q === p || q.startsWith(`${p}/`)) { files.delete(q); files.set(to + q.slice(p.length), v); }
          for (const q of [...folders]) if (q === p || q.startsWith(`${p}/`)) { folders.delete(q); folders.add(to + q.slice(p.length)); }
          return send(201);
        }
        case 'DELETE':
          if (!f && !folders.has(p)) return send(404);
          if (ifMatch && f && tag(f.version) !== ifMatch) return send(412);
          for (const q of [...files.keys()]) if (q === p || q.startsWith(`${p}/`)) files.delete(q);
          for (const q of [...folders]) if (q === p || q.startsWith(`${p}/`)) folders.delete(q);
          return send(204);
        default:
          return send(405);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    files,
    folders,
    touch: (path, body) => { files.set(path, { body: Buffer.from(body), version: next++ }); },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
