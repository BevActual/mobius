import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** One scripted reply from a pretend model server: chunks to stream, each followed by a pause. */
export interface ModelReply { chunks: Array<{ data: unknown; pauseMs: number }>; status?: number; error?: string }

/** The server refuses the request with this status and message, like a provider does. */
export const refuses = (status: number, message: string): ModelReply => ({ chunks: [], status, error: message });

const delta = (value: object) => ({ choices: [{ index: 0, delta: value }] });
const finish = (reason: string) => ({ choices: [{ index: 0, delta: {}, finish_reason: reason }] });

export const says = (parts: string[], pauseMs = 0): ModelReply => ({
  chunks: [...parts.map((text) => ({ data: delta({ content: text }), pauseMs })), { data: finish('stop'), pauseMs: 0 }],
});

/** `wireName` is the tool name as the model sees it, with dashes instead of dots (clock-now). */
export const callsTool = (wireName: string, args: object = {}): ModelReply => ({
  chunks: [
    { data: delta({ tool_calls: [{ index: 0, id: 'call_1', function: { name: wireName, arguments: JSON.stringify(args) } }] }), pauseMs: 0 },
    { data: finish('tool_calls'), pauseMs: 0 },
  ],
});

export interface ModelOptions {
  /** What GET /models lists. */
  models?: string[];
  /** What the speech endpoint answers: the words, or a failing status. Without it the endpoint does not exist (404). */
  transcript?: string | { status: number };
}

export interface ModelFixture {
  url: string;
  /** What the speech endpoint received. */
  audio: Array<{ type: string | undefined; bytes: number; text: string }>;
  /** The JSON bodies of the requests received, oldest first. */
  requests: Array<Record<string, unknown>>;
  authorization: Array<string | undefined>;
  close(): Promise<void>;
}

export async function startModel(replies: ModelReply[], options: ModelOptions = {}): Promise<ModelFixture> {
  const audio: ModelFixture['audio'] = [];
  const requests: Array<Record<string, unknown>> = [];
  const authorization: Array<string | undefined> = [];
  const queue = [...replies];
  const server = http.createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on('data', (chunk: Buffer) => parts.push(chunk));
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0];
      if (req.method === 'GET' && path === '/v1/models') {
        authorization.push(req.headers.authorization);
        res.writeHead(options.models ? 200 : 404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: (options.models ?? []).map((id) => ({ id, object: 'model' })) }));
        return;
      }
      if (req.method === 'POST' && path === '/v1/audio/transcriptions') {
        const body = Buffer.concat(parts);
        audio.push({ type: req.headers['content-type'], bytes: body.length, text: body.toString('latin1') });
        const answer = options.transcript;
        if (answer === undefined) res.writeHead(404, { 'content-type': 'application/json' }).end('{}');
        else if (typeof answer === 'string') res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: answer }));
        else res.writeHead(answer.status, { 'content-type': 'application/json' }).end('{}');
        return;
      }
      try {
        requests.push(JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>);
      } catch {
        requests.push({});
      }
      authorization.push(req.headers.authorization);
      const reply = queue.shift();
      if (!reply) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'the script has no more replies' } }));
        return;
      }
      if (reply.status !== undefined) {
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: reply.error ?? 'refused' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      let closed = false;
      res.on('close', () => { closed = true; });
      const next = (index: number) => {
        if (closed) return;
        const chunk = reply.chunks[index];
        if (!chunk) {
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        res.write(`data: ${JSON.stringify(chunk.data)}\n\n`);
        setTimeout(() => next(index + 1), chunk.pauseMs);
      };
      next(0);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    audio,
    requests,
    authorization,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
