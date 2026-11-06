/**
 * The address field takes both addresses and questions. This is the single place that decides which.
 * It is deliberately conservative: only http(s) pages can ever be loaded into a browser surface.
 */
export type AddressResult =
  | { kind: 'url'; url: string }
  | { kind: 'ask'; text: string }
  | { kind: 'blocked'; reason: string }
  | { kind: 'empty' };

const MAX_INPUT = 2048;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const HOST_LIKE = /^(localhost|\d{1,3}(\.\d{1,3}){3}|[a-z0-9-]+(\.[a-z0-9-]+)+)(:\d{1,5})?([/?#].*)?$/i;
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])(:|$|\/)/i;

export function resolveAddress(raw: string): AddressResult {
  const input = typeof raw === 'string' ? raw.trim() : '';
  if (!input) return { kind: 'empty' };
  if (input.length > MAX_INPUT) return { kind: 'blocked', reason: 'too-long' };

  const scheme = SCHEME.exec(input)?.[1]?.toLowerCase();
  // "localhost:5173" parses as a scheme, so treat host:port as a host, not a scheme.
  const looksLikeHostPort = /^[a-z0-9.-]+:\d{1,5}([/?#]|$)/i.test(input);
  if (scheme && !looksLikeHostPort) {
    if (scheme !== 'http' && scheme !== 'https') return { kind: 'blocked', reason: 'scheme' };
    return finish(input);
  }
  if (/\s/.test(input) || !HOST_LIKE.test(input)) return { kind: 'ask', text: input };
  return finish((LOOPBACK.test(input) ? 'http://' : 'https://') + input);
}

function finish(candidate: string): AddressResult {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { kind: 'blocked', reason: 'invalid' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { kind: 'blocked', reason: 'scheme' };
  if (url.username || url.password) return { kind: 'blocked', reason: 'credentials' };
  return { kind: 'url', url: url.href };
}
