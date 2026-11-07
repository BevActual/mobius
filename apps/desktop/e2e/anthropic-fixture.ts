import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** A stand-in for Anthropic's Messages endpoint: each request gets the next scripted reply as a stream. */
export type AnthropicReply = { text: string } | { tool: { name: string; input: object } };

export interface AnthropicFixture {
  url: string;
  requests: Array<{ headers: http.IncomingHttpHeaders; body: Record<string, unknown> }>;
  close(): Promise<void>;
}

const sse = (events: object[]) => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');

function stream(reply: AnthropicReply, n: number): string {
  const start = { type: 'message_start', message: { id: `msg_${n}`, role: 'assistant', model: 'x', content: [], usage: { input_tokens: 10, output_tokens: 0 } } };
  if ('text' in reply) {
    return sse([start,
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply.text } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
      { type: 'message_stop' }]);
  }
  return sse([start,
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${n}`, name: `mcp__mobius__${reply.tool.name}`, input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(reply.tool.input) } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } },
    { type: 'message_stop' }]);
}

export async function startAnthropic(replies: AnthropicReply[]): Promise<AnthropicFixture> {
  const requests: AnthropicFixture['requests'] = [];
  const queue = [...replies];
  const server = http.createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => parts.push(c));
    req.on('end', () => {
      if (req.method !== 'POST' || !(req.url ?? '').endsWith('/v1/messages')) { res.writeHead(404).end('{}'); return; }
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>; } catch { /* recorded as empty */ }
      requests.push({ headers: req.headers, body });
      const reply = queue.shift();
      if (!reply) { res.writeHead(500, { 'content-type': 'application/json' }).end('{"type":"error","error":{"message":"no more replies"}}'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' }).end(stream(reply, requests.length));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
