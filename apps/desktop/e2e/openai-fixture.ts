import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** A request the pretend OpenAI received. */
export interface SeenRequest { path: string; headers: http.IncomingHttpHeaders; body: string }

export interface OpenAiFixture {
  url: string;
  requests: SeenRequest[];
  /** The person entered the code on OpenAI's site. */
  approve(): void;
  close(): Promise<void>;
}

const b64url = (s: string) => Buffer.from(s).toString('base64url');
export const token = (claims: object) => `h.${b64url(JSON.stringify(claims))}.s`;

/** OpenAI's device sign-in and the ChatGPT plan's Responses endpoint, answering `replies` in order. */
export async function startOpenAi(replies: string[]): Promise<OpenAiFixture> {
  const requests: SeenRequest[] = [];
  let approved = false;
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      const path = req.url ?? '';
      requests.push({ path, headers: req.headers, body });
      const json = (status: number, value: object) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (path === '/api/accounts/deviceauth/usercode') return json(200, { device_auth_id: 'dev-1', user_code: 'MOBI-2026', interval: '1' });
      if (path === '/api/accounts/deviceauth/token') return approved ? json(200, { authorization_code: 'auth-code', code_verifier: 'verifier' }) : json(403, {});
      if (path === '/oauth/token') {
        return json(200, {
          access_token: token({ exp, 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-e2e' } }),
          refresh_token: 'refresh-e2e',
          id_token: token({ email: 'me@chatgpt.example' }),
        });
      }
      if (path === '/backend-api/codex/responses') {
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
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    approve: () => { approved = true; },
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
