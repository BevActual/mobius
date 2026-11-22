import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FilterBar, PreviewStrip, filterCount, pickTag } from './Browse';

const noop = () => {};

describe('browser pieces', () => {
  it('picks tags as Live does: one per group, Ctrl adds, a click on the only one clears it', () => {
    let v = pickTag({}, 'type', 'Bass', false);
    expect(v).toEqual({ type: ['Bass'] });
    v = pickTag(v, 'type', 'Pad', false);
    expect(v).toEqual({ type: ['Pad'] });
    v = pickTag(v, 'type', 'Bass', true);
    expect(v).toEqual({ type: ['Pad', 'Bass'] });
    v = pickTag(v, 'type', 'Pad', true);
    expect(v).toEqual({ type: ['Bass'] });
    v = pickTag(v, 'mood', 'Dark', false);
    expect(filterCount(v)).toBe(2);
    expect(pickTag(v, 'type', 'Bass', false)).toEqual({ mood: ['Dark'] });
  });

  it('draws groups of toggle chips and a results bar with Clear, with no per-tag counts', () => {
    const html = renderToStaticMarkup(
      <FilterBar groups={[{ id: 'type', name: 'Type', tags: ['Bass', 'Pad'] }]} value={{ type: ['Pad'] }} onChange={noop} />,
    );
    expect(html).toContain('aria-label="Type"');
    expect(html).toMatch(/aria-pressed="true"[^>]*><span class="ui-chip-text">Pad</);
    expect(html).toContain('1 filter');
    expect(html).toContain('>Clear<');
    const none = renderToStaticMarkup(<FilterBar groups={[]} value={{}} onChange={noop} />);
    expect(none).not.toContain('filter</span>');
    expect(none).not.toContain('>Clear<');
  });

  it('draws the preview strip: the toggle, the shape to scrub, Raw and the volume', () => {
    const html = renderToStaticMarkup(
      <PreviewStrip on raw={false} onToggle={noop} onRaw={noop} name="Warm keys" peaks={[0.2, 0.9, 0.4]} position={0.5} onScrub={noop} volume={-6} onVolume={noop} />,
    );
    expect(html).toMatch(/aria-pressed="true" aria-label="Preview"/);
    expect(html).toContain('aria-label="Play Warm keys from"');
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('>Raw<');
    expect(html).toContain('Preview volume');
    const empty = renderToStaticMarkup(<PreviewStrip on={false} raw onToggle={noop} onRaw={noop} volume={0} onVolume={noop} />);
    expect(empty).toContain('>Preview<');
    expect(empty).toContain('Shift+Enter previews the chosen item');
  });
});
