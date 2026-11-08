import { describe, expect, it } from 'vitest';
import { claimKey, parseInline, parseMarkdown, plainText, safeHref, unsureClaims, withoutMarks } from './markdown';

describe('agent reply markdown', () => {
  it('reads bold, italic, code and links', () => {
    expect(parseInline('a **b** *c* `d` [e](https://x.test)')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'b' }] },
      { kind: 'text', text: ' ' },
      { kind: 'em', children: [{ kind: 'text', text: 'c' }] },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'd' },
      { kind: 'text', text: ' ' },
      { kind: 'link', href: 'https://x.test', children: [{ kind: 'text', text: 'e' }] },
    ]);
  });
  it('leaves snake_case and unsafe links alone', () => {
    expect(plainText(parseInline('my_var_name'))).toBe('my_var_name');
    expect(parseInline('my_var_name')).toEqual([{ kind: 'text', text: 'my_var_name' }]);
    expect(parseInline('[x](javascript:alert(1))').some((n) => n.kind === 'link')).toBe(false);
    expect(safeHref('file:///etc/passwd')).toBeNull();
  });
  it('reads lists, headings and code blocks', () => {
    const blocks = parseMarkdown('## Plan\n\n1. One\n2. Two\n\n- a\n- b\n\n```ts\nconst x = 1;\n```');
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'list', 'list', 'code']);
    expect(blocks[1]).toMatchObject({ ordered: true, start: 1 });
    expect(blocks[3]).toMatchObject({ lang: 'ts', text: 'const x = 1;', open: false });
  });
  it('shows a code block that is still streaming', () => {
    expect(parseMarkdown('```\npartial')).toEqual([{ kind: 'code', lang: '', text: 'partial', open: true }]);
  });
  it('turns bare addresses into links without the full stop after them', () => {
    const nodes = parseInline('See https://example.com/a.');
    expect(nodes[1]).toMatchObject({ kind: 'link', href: 'https://example.com/a' });
    expect(nodes[2]).toEqual({ kind: 'text', text: '.' });
  });
  it('reads to-do items as checks', () => {
    expect(parseMarkdown('- [ ] Buy stamps\n- [x] Call the plumber\n- Plain')).toEqual([{
      kind: 'list', ordered: false, start: 1,
      items: [[{ kind: 'text', text: 'Buy stamps' }], [{ kind: 'text', text: 'Call the plumber' }], [{ kind: 'text', text: 'Plain' }]],
      checks: [false, true, null],
    }]);
    expect(parseMarkdown('- one')[0]).not.toHaveProperty('checks');
  });

  it('reads facts marked with where they came from, and takes the marks out for copying', () => {
    const md = 'Confirming [8 people](trust:yours "Calendar · Offsite crew") arriving [around 12:30](trust:unsure "two flights unknown") on [Thursday](trust:web).';
    const inl = parseInline(md);
    expect(inl[1]).toEqual({ kind: 'claim', tier: 'yours', source: 'Calendar · Offsite crew', children: [{ kind: 'text', text: '8 people' }] });
    expect(inl[3]).toMatchObject({ kind: 'claim', tier: 'unsure', source: 'two flights unknown' });
    expect(inl[5]).toMatchObject({ kind: 'claim', tier: 'web', source: '' });
    expect(withoutMarks(md)).toBe('Confirming 8 people arriving around 12:30 on Thursday.');
    expect(unsureClaims(md)).toEqual([claimKey('around 12:30', 'two flights unknown')]);
  });
});
