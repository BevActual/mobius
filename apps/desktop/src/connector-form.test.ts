import { describe, expect, it } from 'vitest';
import { isConnectorName, splitArgs, suggestName } from './connector-form';

describe('Add a Connector', () => {
  it('splits the arguments as a terminal would, keeping quoted spaces', () => {
    expect(splitArgs('-y @modelcontextprotocol/server-github')).toEqual(['-y', '@modelcontextprotocol/server-github']);
    expect(splitArgs('  --root "C:\\My Files"  x ')).toEqual(['--root', 'C:\\My Files', 'x']);
    expect(splitArgs("--name 'a b' \"\"")).toEqual(['--name', 'a b', '']);
    expect(splitArgs('')).toEqual([]);
  });

  it('accepts only names Mobius can use in tool names', () => {
    expect(isConnectorName('github')).toBe(true);
    expect(isConnectorName('my_server2')).toBe(true);
    expect(isConnectorName('GitHub')).toBe(false);
    expect(isConnectorName('2fast')).toBe(false);
    expect(isConnectorName('a'.repeat(25))).toBe(false);
  });

  it('suggests a name from the package or the command', () => {
    expect(suggestName('npx', ['-y', '@modelcontextprotocol/server-github'])).toBe('github');
    expect(suggestName('uvx', ['mcp-server-fetch'])).toBe('fetch');
    expect(suggestName('C:\\tools\\linear-mcp.exe', [])).toBe('linear');
    expect(suggestName('npx', ['-y', 'notion-mcp@1.2.0'])).toBe('notion');
    expect(suggestName('npx', ['-y', '@notionhq/notion-mcp-server'])).toBe('notion');
    expect(suggestName('npx', ['-y', 'brave-search-server'])).toBe('brave_search');
    expect(suggestName('', [])).toBe('');
  });
});
