import { describe, expect, it } from 'vitest';
import { parseReplyChart } from './reply-chart';

describe('a chart in a reply', () => {
  it('reads a column chart', () => {
    const chart = parseReplyChart('{"title":"Parts by supplier","categories":["Veltro","Harlow Steel"],"series":[{"name":"Parts","values":[31,28]}]}');
    expect(chart).toEqual({ title: 'Parts by supplier', kind: 'column', categories: ['Veltro', 'Harlow Steel'], series: [{ name: 'Parts', values: [31, 28] }] });
  });

  it('keeps line and area, gaps, and names an untitled chart after its series', () => {
    const chart = parseReplyChart('{"kind":"line","categories":[2024,2025],"series":[{"name":"Spend","values":[4,null]}]}');
    expect(chart).toMatchObject({ title: 'Spend', kind: 'line', categories: ['2024', '2025'], series: [{ values: [4, null] }] });
  });

  it('leaves anything else as code', () => {
    expect(parseReplyChart('not json')).toBeNull();
    expect(parseReplyChart('{"categories":["a"],"series":[{"values":[1,2]}]}')).toBeNull();
    expect(parseReplyChart('{"categories":["a"],"series":[{"values":["1"]}]}')).toBeNull();
    expect(parseReplyChart('{"categories":[],"series":[]}')).toBeNull();
  });
});
