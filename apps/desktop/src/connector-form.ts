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
