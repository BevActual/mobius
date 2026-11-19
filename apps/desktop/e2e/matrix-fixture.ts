import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** A stand-in Matrix homeserver: one account (`ana`, password `pw`) in one room, `!ops:x` ("Ops"), whose messages are given. */
export interface MatrixFixture {
  origin: string;
  /** Every message sent into a room, as its body. */
  sent: string[];
  close(): Promise<void>;
}

export interface FakeChatMessage {
  id: string;
  sender: string;
  name: string;
  body: string;
  at: number;
}

export async function startMatrix(messages: FakeChatMessage[]): Promise<MatrixFixture> {
  const sent: string[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x');
      const path = decodeURIComponent(url.pathname);
      const signed = (req.headers.authorization ?? '') === 'Bearer access-1';
      const answer = (status: number, json: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      const key = `${req.method} ${path}`;
      if (key === 'GET /_matrix/client/versions') return answer(200, { versions: ['v1.11'] });
      if (key === 'GET /_matrix/client/v3/login') return answer(200, { flows: [{ type: 'm.login.password' }] });
      if (key === 'POST /_matrix/client/v3/login') {
        const asked = JSON.parse(body || '{}') as { password?: string; identifier?: { user?: string } };
        return asked.password === 'pw' && asked.identifier?.user === 'ana'
          ? answer(200, { user_id: '@ana:x', device_id: 'DEV1', access_token: 'access-1', refresh_token: 'refresh-1', expires_in_ms: 3_600_000 })
          : answer(403, { errcode: 'M_FORBIDDEN', error: 'Invalid username or password' });
      }
      if (!signed) return answer(401, { errcode: 'M_UNKNOWN_TOKEN', error: 'Unknown token' });
      if (key === 'GET /_matrix/client/v3/account/whoami') return answer(200, { user_id: '@ana:x', device_id: 'DEV1' });
      if (key === 'GET /_matrix/client/v3/sync') {
        const last = messages.at(-1)?.at ?? 1;
        return answer(200, url.searchParams.has('since') ? { next_batch: 's2' } : {
          next_batch: 's1',
          rooms: { join: { '!ops:x': {
            summary: { 'm.joined_member_count': 5 },
            state: { events: [{ type: 'm.room.name', state_key: '', content: { name: 'Ops' } }] },
            timeline: { events: [{ type: 'm.room.message', origin_server_ts: last, content: {} }] },
            unread_notifications: { notification_count: messages.length, highlight_count: 0 },
          } } },
        });
      }
      if (key === 'GET /_matrix/client/v3/rooms/!ops:x/messages') {
        return answer(200, {
          chunk: [...messages].reverse().map((m) => ({ type: 'm.room.message', event_id: m.id, sender: m.sender, origin_server_ts: m.at, content: { msgtype: 'm.text', body: m.body } })),
          state: messages.map((m) => ({ type: 'm.room.member', state_key: m.sender, content: { membership: 'join', displayname: m.name } })),
          start: 't0',
        });
      }
      if (req.method === 'PUT' && path.startsWith('/_matrix/client/v3/rooms/!ops:x/send/m.room.message/')) {
        sent.push((JSON.parse(body || '{}') as { body?: string }).body ?? '');
        return answer(200, { event_id: `$sent${sent.length}` });
      }
      return answer(404, { errcode: 'M_UNRECOGNIZED', error: 'Unrecognized request' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    sent,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
