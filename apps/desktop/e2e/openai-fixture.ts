import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** A request the pretend OpenAI received. */
export interface SeenRequest { path: string; headers: http.IncomingHttpHeaders; body: string }

export interface OpenAiFixture {
  url: string;
  requests: SeenRequest[];
  /** The person signs in on ChatGPT's page: from now on it sends the browser straight back to Mobius. */
  approve(): void;
  close(): Promise<void>;
}

const b64url = (s: string) => Buffer.from(s).toString('base64url');
export const token = (claims: object) => `h.${b64url(JSON.stringify(claims))}.s`;

/** Sign in with ChatGPT and the public Responses API, answering `replies` in order. */
export async function startOpenAi(replies: string[]): Promise<OpenAiFixture> {
  const requests: SeenRequest[] = [];
  let approved = false;
  const exp = Math.floor(Date.now() / 1000) + 3600;
  let nonce = '';
  let origin = '';
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      const full = new URL(req.url ?? '/', 'http://x');
      const path = full.pathname;
      requests.push({ path: req.url ?? path, headers: req.headers, body });
      const json = (status: number, value: object) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (path === '/api/accounts/authorize') {
        nonce = full.searchParams.get('nonce') ?? '';
        if (!approved) { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>Sign in to ChatGPT</title><h1>Sign in to ChatGPT</h1>'); return; }
        const back = new URL(full.searchParams.get('redirect_uri') ?? '');
        back.searchParams.set('code', 'auth-code');
        back.searchParams.set('state', full.searchParams.get('state') ?? '');
        back.searchParams.set('client_id', 'oaiapp_e2e');
        res.writeHead(302, { location: back.toString() });
        res.end();
        return;
      }
      if (path === '/api/accounts/oauth/token') {
        return json(200, {
          access_token: token({ exp }),
          refresh_token: 'refresh-e2e',
          id_token: token({ iss: origin, aud: 'oaiapp_e2e', exp, nonce, email: 'me@chatgpt.example' }),
          scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
        });
      }
      if (path === '/v1/models') return json(200, { models: [{ slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list' }] });
      if (path === '/v1/responses') {
        const text = replies.shift() ?? 'No more replies.';
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\n`);
        res.end(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed' } })}\n\n`);
        return;
      }
      json(404, {});
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    approve: () => { approved = true; },
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
