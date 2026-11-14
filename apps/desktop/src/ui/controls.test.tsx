import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, IconButton } from './Button';
import { Avatar, Chip, Count, StatusText, Swatches, initials } from './Bits';
import { ListRow } from './ListRow';
import { Segmented } from './Segmented';
import { Meter, ParamCell, ParamGrid, Slider, fromPosition, logNudge, toPosition } from './Slider';
import { Select, TextField } from './Field';

const noop = () => {};

describe('buttons', () => {
  it('names an icon button and puts its key in the tooltip', () => {
    const html = renderToStaticMarkup(<IconButton label="Delete" keys="Delete" icon={<svg />} />);
    expect(html).toContain('aria-label="Delete"');
    expect(html).toContain('title="Delete (Delete)"');
  });
  it('marks the kind and a pressed toggle', () => {
    const html = renderToStaticMarkup(<Button kind="primary" pressed>Keep</Button>);
    expect(html).toContain('data-kind="primary"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('type="button"');
  });
});

describe('sliders', () => {
  it('maps values to the track and back, on a log scale too', () => {
    expect(toPosition(50, 0, 100)).toBe(0.5);
    expect(toPosition(-20, 0, 100)).toBe(0);
    expect(toPosition(200, 20, 20000, 'log')).toBeCloseTo(1 / 3, 5);
    expect(fromPosition(1 / 3, 20, 20000, 'log')).toBeCloseTo(200, 5);
  });
  it('fills from zero when the range crosses it, and is unchanged at zero', () => {
    const at0 = renderToStaticMarkup(<Slider label="Exposure" min={-100} max={100} value={0} onChange={noop} />);
    expect(at0).not.toContain('data-changed');
    const moved = renderToStaticMarkup(<Slider label="Exposure" min={-100} max={100} value={20} onChange={noop} />);
    expect(moved).toContain('data-changed="true"');
    expect(moved).toContain('--from:0.5');
    expect(moved).toContain('--to:0.6');
    expect(moved).toContain('>+20</output>');
  });
  it('names both ends and marks a Remake control', () => {
    const html = renderToStaticMarkup(<Slider label="Length" value={40} onChange={noop} ends={['Shorter', 'Longer']} remake />);
    expect(html).toContain('Shorter');
    expect(html).toMatch(/aria-describedby="[^"]+-ends"/);
    expect(html).toContain('class="ui-remake"');
  });
  it('reads a parameter cell with its unit', () => {
    const html = renderToStaticMarkup(<ParamCell label="Tempo" unit="BPM" min={40} max={240} value={124} onChange={noop} />);
    expect(html).toContain('aria-valuetext="124 BPM"');
    expect(html).toContain('<span class="ui-param-unit">BPM</span>');
  });
  it('gives a meter its role and value', () => {
    const html = renderToStaticMarkup(<Meter label="Storage" value={0.62} />);
    expect(html).not.toContain('ui-meter-over');
    expect(renderToStaticMarkup(<Meter label="Level" value={0.94} threshold={0.85} />)).toMatch(/ui-meter-over" style="left:85%;width:(8\.99|9)\d*%/);
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuetext="62%"');
  });
});

describe('small pieces', () => {
  it('shows no count for zero, and caps a large one', () => {
    expect(renderToStaticMarkup(<Count n={0} />)).toBe('');
    expect(renderToStaticMarkup(<Count n={1500} />)).toContain('999+');
  });
  it('takes initials from a name or an address', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('maya.chen@northway.example')).toBe('MC');
    expect(initials('sam')).toBe('S');
    expect(renderToStaticMarkup(<Avatar name="Ada Lovelace" />)).toContain('aria-label="Ada Lovelace"');
  });
  it('draws a chip with a colour dot and a remove button', () => {
    const html = renderToStaticMarkup(<Chip color="teal" onRemove={noop}>Launch</Chip>);
    expect(html).toContain('data-tone="teal"');
    expect(html).toContain('aria-label="Remove Launch"');
  });
  it('gives calm status no dot and a problem a red one', () => {
    expect(renderToStaticMarkup(<StatusText>Connected</StatusText>)).not.toContain('ui-dot');
    expect(renderToStaticMarkup(<StatusText problem>Failed</StatusText>)).toContain('data-tone="red"');
  });
});

describe('fields, segments and rows', () => {
  it('ties an error sentence to its field', () => {
    const html = renderToStaticMarkup(<TextField label="Email" value="a@" onChange={noop} error="Add the part after @." />);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/aria-describedby="([^"]+)-error"/);
  });
  it('makes one segment tabbable, the chosen one', () => {
    const html = renderToStaticMarkup(<Segmented label="View" value="b" onChange={noop} choices={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-checked="true" tabindex="0"[^>]*>B</);
  });
  it('draws one line or two', () => {
    expect(renderToStaticMarkup(<ListRow title="A" onSelect={noop} />)).toContain('data-lines="1"');
    const two = renderToStaticMarkup(<ListRow title="A" meta="09:14" detail="First words" unread current onSelect={noop} />);
    expect(two).toContain('data-lines="2"');
    expect(two).toContain('data-unread="true"');
    expect(two).toContain('aria-current="true"');
  });
});

describe('Music gaps: inline and quiet pop-ups, swatches, one-column cells, log nudges', () => {
  it('puts a pop-up’s name beside it, or draws it quiet', () => {
    const inline = renderToStaticMarkup(<Select label="Grid" inline value="a" onChange={() => {}} choices={[{ value: 'a', label: 'A' }]} />);
    expect(inline).toContain('data-inline="true"');
    const fit = renderToStaticMarkup(<Select label="Note length" inline value="q" onChange={() => {}} choices={[{ value: 'q', label: '1/4' }, { value: 't', label: '1/16 triplet' }]} />);
    expect(fit).toContain('ui-select-fit');
    expect(fit).toMatch(/class="ui-select-size" aria-hidden="true">1\/16 triplet</);
    const quiet = renderToStaticMarkup(<Select label="Key" quiet value="a" onChange={() => {}} choices={[{ value: 'a', label: 'A' }]} />);
    expect(quiet).toContain('data-quiet="true"');
  });
  it('draws swatches as a radio group with names and one tab stop', () => {
    const html = renderToStaticMarkup(<Swatches label="Track colour" value="teal" onChange={() => {}} />);
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(9);
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="Teal"[^>]*title="Teal"[^>]*tabindex="0"/);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
  });
  it('lays a lone cell across a one-column grid', () => {
    const html = renderToStaticMarkup(<ParamGrid label="Track" columns={1}><ParamCell label="Volume" value={0} onChange={() => {}} min={-60} max={6} wide /></ParamGrid>);
    expect(html).toContain('data-columns="1"');
    expect(html).toContain('data-wide="true"');
  });
  it('nudges a log value by a twelfth of an octave, and by at least one step', () => {
    expect(logNudge(1000, 1, 1 / 12, 1)).toBeCloseTo(1059.46, 1);
    expect(logNudge(1000, -1, 1 / 2, 1)).toBeCloseTo(707.1, 1);
    expect(logNudge(2, 1, 1 / 12, 1)).toBe(3);
    expect(logNudge(2, -1, 1 / 12, 1)).toBe(1);
  });
});

describe('Music gaps, round 2', () => {
  it('draws a compact parameter cell for dense pro panels', async () => {
    const html = renderToStaticMarkup(<ParamCell label="Cutoff" size="compact" min={80} max={12000} value={1800} onChange={() => {}} />);
    expect(html).toContain('data-size="compact"');
    const plain = renderToStaticMarkup(<ParamCell label="Cutoff" min={80} max={12000} value={1800} onChange={() => {}} />);
    expect(plain).not.toContain('data-size');
  });
  it('lays a parameter grid four across', () => {
    expect(renderToStaticMarkup(<ParamGrid label="Drive" columns={4}><span /></ParamGrid>)).toContain('data-columns="4"');
  });
});
