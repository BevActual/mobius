import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PadGrid, type Pad } from './Pads';

const noop = () => {};
const pads: Pad[] = [
  { id: 'k', name: 'Kick', key: 'Z', color: 'coral' },
  { id: 's', name: 'Snare', key: 'X' },
  { id: 'e', name: 'Pad 3', empty: true },
  { id: 'c', name: 'Clap', proposed: true },
];

describe('pad grid', () => {
  it('names each pad, marks the chosen one, and gives the grid one tab stop', () => {
    const html = renderToStaticMarkup(<PadGrid label="Drum kit" pads={pads} chosen={1} onChoose={noop} lit={[0]} />);
    expect(html).toContain('role="group" aria-label="Drum kit"');
    expect(html.match(/<button/g)).toHaveLength(4);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toMatch(/data-chosen="true"[^>]*aria-pressed="true"[^>]*aria-label="Snare"/);
    expect(html).toContain('aria-keyshortcuts="Z"');
    expect(html).toContain('title="Play Kick (Z)"');
    expect(html).toMatch(/data-lit="true"[^>]*aria-label="Kick"/);
    expect(html).toContain('aria-label="Pad 3, empty"');
    expect(html).toContain('>Empty<');
    expect(html).toContain('data-proposed="true"');
  });

  it('shows the chosen pad’s settings under the grid, named for it', () => {
    const html = renderToStaticMarkup(<PadGrid label="Drum kit" pads={pads} chosen={0} onChoose={noop}><p>tune</p></PadGrid>);
    expect(html).toContain('aria-label="Kick settings"');
    expect(html).toContain('<p>tune</p>');
    const none = renderToStaticMarkup(<PadGrid label="Drum kit" pads={pads} chosen={0} onChoose={noop} />);
    expect(none).not.toContain('settings');
  });
});
