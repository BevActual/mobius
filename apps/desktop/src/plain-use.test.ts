import { describe, expect, it } from 'vitest';
import { plainUse } from './actions';

describe('an approval card says what a tool would do, never its code name', () => {
  it('in a sentence where there is one', () => {
    expect(plainUse('clock.now', {})).toBe('check the time');
  });
  it('a tool from an MCP server is named by what it is and where it comes from', () => {
    expect(plainUse('mcp.fake.echo', {})).toBe('use “echo” from the fake server');
  });
  it('any other tool is named without its dots', () => {
    expect(plainUse('demo.big_echo', {})).toBe('use the demo tool “big echo”');
    expect(plainUse('lookup', {})).toBe('use “lookup”');
  });
});
