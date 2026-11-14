/**
 * Abilities › Add a Connector: turning what was typed into the server's entry in mcp.json. The arguments are one line,
 * split at spaces as a terminal would, with quotes keeping a space inside one argument.
 */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  let word = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else word += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) { out.push(word); word = ''; started = false; }
    } else {
      word += ch;
      started = true;
    }
  }
  if (started) out.push(word);
  return out;
}

/** A name Mobius can use for a server: lowercase letters, digits and _, starting with a letter, at most 24. */
export const isConnectorName = (name: string): boolean => /^[a-z][a-z0-9_]{0,23}$/.test(name);

/** A suggested name from the command or package: "@modelcontextprotocol/server-github" gives "github". */
export function suggestName(command: string, args: readonly string[]): string {
  const source = [...args].reverse().find((a) => !a.startsWith('-')) ?? command;
  const last = source.split(/[\\/]/).pop() ?? '';
  const plain = last.replace(/@[^@]*$/, '').replace(/\.(cmd|exe|js|mjs|py)$/i, '').replace(/^(mcp[-_]?server[-_]|server[-_]|mcp[-_])/i, '').replace(/([-_]mcp)?([-_]server)?$/i, '').replace(/[-_]mcp$/i, '');
  const name = plain.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+/, '').replace(/_+$/, '').slice(0, 24);
  return isConnectorName(name) ? name : '';
}

/** Names people know a connector by, for ids that are well-known services; any other id is shown as it is. */
const KNOWN_NAMES: Record<string, string> = {
  github: 'GitHub', gitlab: 'GitLab', linear: 'Linear', slack: 'Slack', notion: 'Notion', jira: 'Jira', figma: 'Figma',
  sentry: 'Sentry', stripe: 'Stripe', postgres: 'Postgres', sqlite: 'SQLite', filesystem: 'Filesystem', fetch: 'Fetch',
  puppeteer: 'Puppeteer', playwright: 'Playwright', google_drive: 'Google Drive', gdrive: 'Google Drive', brave_search: 'Brave Search',
};
export const connectorDisplayName = (id: string): string => KNOWN_NAMES[id] ?? id;

/**
 * Why a connector could not start, as the end of one sentence after "Couldn’t start: ". The host's "could not start
 * <command>: " is dropped (the row says that already), a missing program says so plainly with where to fix it, and
 * the first letter is lower case.
 */
export function connectorProblem(error: string | undefined): string {
  let text = (error ?? '').trim().replace(/^could not start [^:]*:\s*/i, '');
  if (/not found|no such file|cannot find the file|os error 2\b/i.test(text)) return 'the command wasn’t found. Check it in mcp.json';
  if (text === '') text = 'unknown problem';
  return text.charAt(0).toLowerCase() + text.slice(1);
}
