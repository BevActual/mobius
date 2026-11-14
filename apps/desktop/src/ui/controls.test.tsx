import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, IconButton } from './Button';
import { Avatar, Chip, Count, StatusText, initials } from './Bits';
import { ListRow } from './ListRow';
import { Segmented } from './Segmented';
import { Meter, ParamCell, Slider, fromPosition, toPosition } from './Slider';
import { TextField } from './Field';

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
    expect(moved).toContain('--from:50%');
    expect(moved).toContain('--to:60%');
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
